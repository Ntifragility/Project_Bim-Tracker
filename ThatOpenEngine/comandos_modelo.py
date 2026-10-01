"""Comandos del modelo (H-04: el mismo nombre en RPC ``comando.ejecutar``, en la API Python ``bus.ejecutar`` y en el
historial del bus): ``modelo.importar_vyba``, ``modelo.abrir_vybs``, ``modelo.guardar_vybs`` y ``modelo.resumen``.

- ``modelo.importar_vyba``: deriva el modelo analítico de un ``.vyba`` de DESIGN (`covillaf.sim.io.leer_vyba`, F0-32) con
  las opciones declaradas (tolerancia de fusión, cruces, excentricidades, materiales, condiciones de conexión,
  liberaciones por GUID) y **sustituye** el documento en una transacción normal: se puede deshacer (vuelve el anterior).
- ``modelo.abrir_vybs``: lee un ``.vybs`` (`leer_vybs`) y **sustituye el modelo entero** (`Transaccion.reemplazar_modelo`:
  ``modelo.cambios`` con ``reemplazado``, deshacer y rehacer vacíos, ``modificado`` False), como ``proyecto.abrir``.
- ``modelo.guardar_vybs``: escribe el documento como ``.vybs`` (`construir_vybs` + escritura atómica) y deja
  ``modificado`` en False (`BusComandos.marcar_guardado`). Sin cambios en el modelo: ``transaccion`` null.
- ``modelo.resumen``: nodos, barras, casos, avisos de la derivación, problemas del modelo, archivo y estado de los
  resultados. Solo lectura.

Rutas: absolutas y locales (`_ruta_local`); el historial guarda solo el **nombre** del archivo (nunca la ruta completa,
como DESIGN). Errores con ``clave`` estable (``data.clave`` de ``-32002``): ``ruta_relativa``, ``ruta_red``,
``ruta_invalida``, ``extension``, ``no_existe``, ``carpeta_inexistente``, ``lectura``, ``derivacion``, ``sin_modelo``,
``sin_ruta``, ``solo_lectura``, ``escritura``.

Sellos: al volver a guardar el mismo documento (mismo GUID) se conserva el ``creado`` del archivo y el guardado va en
``modificado``; un documento nuevo o importado se sella como ``creado``.
"""
from __future__ import annotations

import json
import os
import zipfile
from pathlib import Path
from types import MappingProxyType
from typing import Any

import ifcopenshell

from covillaf.core import guid as guid_ifc
from covillaf.core.tiempo import ahora_utc
from covillaf.sim.io import CondicionConexion, ErrorDerivacion, OpcionesDerivacion, construir_vybs, leer_vyba, leer_vybs
from covillaf.sim.io import contenedor as contenedor_sim
from covillaf.sim.io.vybs import FORMATO_VYBS
from covillaf.sim.modelo import Liberaciones, Material
from covillaf_sim_kernel import __version__
from covillaf_sim_kernel.bus import BusComandos, ErrorComando, Transaccion
from covillaf_sim_kernel.estado import ArchivoVybs, DocumentoSimulacion, EstadoKernel, documento_de

APLICACION = f"COVILLAF SIMULATE {__version__}"
#: Autor del sello de los archivos si no se da otro (como DESIGN: ningún dato personal por defecto).
AUTOR = "COVILLAF SIMULATE"

# --- esquemas ----------------------------------------------------------------------------------------------------------

_RUTA = {"type": "string", "minLength": 1, "maxLength": 1024, "description": "ruta del archivo en esta máquina"}
_NOMBRE = {"type": "string", "minLength": 1, "maxLength": 200}
_COMPONENTES = {"type": "array", "items": {"enum": ["ux", "uy", "uz", "rx", "ry", "rz"]}, "uniqueItems": True}
_GUID = {"type": "string", "pattern": "^[0-3][0-9A-Za-z_$]{21}$"}
_MATERIAL = {
    "type": "object",
    "description": "Material elástico lineal isótropo (N·mm·s·t): E y G en MPa, rho en t/mm³, alfa en 1/°C",
    "properties": {
        "E": {"type": "number", "exclusiveMinimum": 0},
        "nu": {"type": "number", "exclusiveMinimum": -1, "exclusiveMaximum": 0.5},
        "rho": {"type": "number", "minimum": 0},
        "alfa": {"type": "number"},
        "G": {"type": "number", "exclusiveMinimum": 0},
        "nombre": {"type": "string", "maxLength": 200},
        "fuente": {"type": "string", "maxLength": 200},
    },
    "required": ["E", "nu"],
    "additionalProperties": False,
}
_CONDICION = {
    "type": "object",
    "properties": {
        "tipo": {"enum": ["rigida", "articulada", "apoyo"]},
        "descripcion": {"type": "string", "maxLength": 200},
        "restricciones": {"type": "array", "items": {"type": "boolean"}, "minItems": 6, "maxItems": 6},
    },
    "required": ["tipo"],
    "additionalProperties": False,
}
#: Opciones de derivación (F0-32; `covillaf.sim.io.OpcionesDerivacion`).
ESQUEMA_OPCIONES = {
    "type": "object",
    "properties": {
        "tol_nodo": {"type": "number", "exclusiveMinimum": 0, "maximum": 1000, "description": "fusión de nodos (mm)"},
        "unir_cruces": {"type": "boolean", "description": "unir los cruces entre interiores aunque no los declare una conexión"},
        "excentricidades": {"enum": ["desfase", "ignorar"]},
        "materiales": {
            "type": "object",
            "description": "biblioteca del usuario por nombre de IfcMaterial",
            "propertyNames": {"minLength": 1, "maxLength": 200},
            "additionalProperties": _MATERIAL,
        },
        "condiciones": {
            "type": "object",
            "description": "condición analítica por componente de conexión, sin versión (p. ej. covillaf.placa_base)",
            "propertyNames": {"minLength": 1, "maxLength": 200},
            "additionalProperties": _CONDICION,
        },
        "liberaciones": {
            "type": "object",
            "description": "liberaciones de extremo por GUID del miembro físico (ejes locales)",
            "propertyNames": _GUID,
            "additionalProperties": {
                "type": "object", "properties": {"i": _COMPONENTES, "j": _COMPONENTES}, "additionalProperties": False,
            },
        },
    },
    "additionalProperties": False,
}


def _esquema(propiedades: dict[str, Any], requeridos: tuple[str, ...] = ()) -> dict[str, Any]:
    return {"type": "object", "properties": propiedades, "required": list(requeridos), "additionalProperties": False}


# --- ayudas ------------------------------------------------------------------------------------------------------------


def sello(autor: str | None = None) -> dict[str, str]:
    """``{fecha, autor, aplicacion}`` de ``creado`` en el manifest (esquema común ``sello``)."""
    return {"fecha": ahora_utc(), "autor": autor or AUTOR, "aplicacion": APLICACION}


def _ruta_local(texto: str) -> Path:
    """Ruta absoluta de esta máquina, normalizada (sin «..»). Se rechazan las relativas (dependerían de la carpeta desde
    la que se lanzó el kernel), las de red (``\\\\equipo\\recurso``: solo comprobarlas ya abre una conexión SMB), las
    que llevan caracteres de control y los nombres reservados de Windows (``NUL``, ``CON``…)."""
    if any(ord(c) < 32 for c in texto):
        raise ErrorComando("ruta_invalida", "la ruta contiene caracteres de control")
    # Rutas de formato extendido de Windows: «\\?\C:\…» y «\\.\C:\…» son locales; «\\?\UNC\…», de red.
    normal = texto.replace("/", "\\")
    if normal[:8].upper() in ("\\\\?\\UNC\\", "\\\\.\\UNC\\"):
        raise ErrorComando("ruta_red", f"«{Path(texto).name}» está en una carpeta de red: copie el archivo a un disco local")
    if normal[:4] in ("\\\\?\\", "\\\\.\\"):
        texto = normal[4:]
    ruta = Path(texto)
    if not ruta.is_absolute():
        raise ErrorComando("ruta_relativa", f"«{texto}» no es una ruta absoluta")
    if ruta.drive.startswith(("\\\\", "//")):
        raise ErrorComando("ruta_red", f"«{ruta.name}» está en una carpeta de red: copie el archivo a un disco local")
    ruta = Path(os.path.normpath(ruta))
    if os.name == "nt" and os.path.isreserved(ruta):
        raise ErrorComando("ruta_invalida", f"«{ruta.name}» no vale como nombre en Windows (nombre reservado como NUL o CON, "
                                            "espacio o punto al final, o «:»)")  # fmt: skip
    return ruta


def ruta_entrada(texto: str, extension: str) -> Path:
    ruta = _ruta_local(texto)
    if ruta.suffix.lower() != extension:
        raise ErrorComando("extension", f"«{ruta.name}» no es un archivo {extension}")
    if not ruta.is_file():
        raise ErrorComando("no_existe", f"no existe el archivo «{ruta.name}»")
    return ruta


def ruta_salida(texto: str, extension: str) -> Path:
    ruta = _ruta_local(texto)
    if ruta.suffix.lower() != extension:
        raise ErrorComando("extension", f"«{ruta.name}» debe tener la extensión {extension}")
    if not ruta.parent.is_dir():
        raise ErrorComando("carpeta_inexistente", f"no existe la carpeta de «{ruta.name}»")
    return ruta


def version_mas_nueva(ruta: Path) -> str | None:
    """``version_formato`` del ``.vybs`` que ya hay en `ruta` si es de una versión más nueva que la que escribe este
    código (menor o mayor distinta más alta); None si no existe, no es un ``.vybs`` legible o no es más nuevo. Así el
    solo lectura protege el **archivo**, no solo el que está abierto (auditoría del commit a32e22f, B-MEDIA-2)."""
    if not ruta.is_file():
        return None
    try:
        with zipfile.ZipFile(ruta) as zf:
            info = zf.getinfo("manifest.json")
            if info.file_size > 1 << 20:
                return None
            manifest = json.loads(zf.read(info))
        texto = manifest["version_formato"] if manifest.get("formato") == FORMATO_VYBS.nombre else None
        suya = tuple(int(x) for x in str(texto).split(".")[:2])
    except (NotImplementedError, RuntimeError):
        # ZIP con compresión que esta Python no lee (zstd…) o cifrado: no se sabe su versión ⇒ no se reescribe (B3)
        return "desconocida"
    except (OSError, KeyError, ValueError, TypeError, zipfile.BadZipFile, AttributeError):
        return None
    propia = tuple(int(x) for x in FORMATO_VYBS.version.split(".")[:2])
    return str(texto) if suya > propia else None


def _liberaciones(componentes: list[str] | None) -> Liberaciones:
    return Liberaciones(**{c: True for c in componentes or ()})


def opciones_derivacion(datos: dict[str, Any]) -> OpcionesDerivacion:
    """`OpcionesDerivacion` desde el JSON de ``opciones`` (ya validado con `ESQUEMA_OPCIONES`)."""
    materiales = {
        nombre: Material(
            nombre, m["E"], m["nu"], rho=m.get("rho", 0.0), alfa=m.get("alfa", 0.0), G=m.get("G"),
            nombre=m.get("nombre", nombre), fuente=m.get("fuente", "biblioteca del usuario"),
        )  # fmt: skip
        for nombre, m in datos.get("materiales", {}).items()
    }
    condiciones = {
        componente: CondicionConexion(c["tipo"], c.get("descripcion", ""), tuple(c.get("restricciones", (True,) * 6)))
        for componente, c in datos.get("condiciones", {}).items()
    }
    liberaciones = {g: (_liberaciones(e.get("i")), _liberaciones(e.get("j"))) for g, e in datos.get("liberaciones", {}).items()}
    try:
        return OpcionesDerivacion(
            tol_nodo=datos.get("tol_nodo", 1.0), unir_cruces=datos.get("unir_cruces", False),
            excentricidades=datos.get("excentricidades", "desfase"), materiales=materiales, condiciones=condiciones,
            liberaciones=liberaciones,
        )  # fmt: skip
    except ValueError as error:
        raise ErrorComando("opciones", str(error)) from error


def fisicos_de_ifc(verdad: bytes) -> dict[str, tuple[str, str]]:
    """GUID físico → (clase IFC, nombre) de las copias de referencia de un ``analysis.ifc`` (``IfcRelAssignsToProduct``
    con un producto no estructural): lo que `construir_vybs` necesita para volver a escribirlas igual."""
    ifc = ifcopenshell.file.from_string(verdad.decode("utf-8"))
    fisicos: dict[str, tuple[str, str]] = {}
    for rel in ifc.by_type("IfcRelAssignsToProduct"):
        producto = rel.RelatingProduct
        if producto is not None and not producto.is_a("IfcStructuralItem"):
            fisicos[producto.GlobalId] = (producto.is_a(), producto.Name or "")
    return fisicos


def documento_actual(tx: Transaccion) -> DocumentoSimulacion:
    documento = documento_de(tx.modelo)
    if documento is None:
        raise ErrorComando("sin_modelo", "no hay modelo: importe un .vyba (modelo.importar_vyba) o abra un .vybs (modelo.abrir_vybs)")
    return documento


def resumen_documento(documento: DocumentoSimulacion) -> dict[str, Any]:
    """Resumen JSON de un documento: recuentos, casos, origen, derivación y problemas del modelo (`Modelo.validar`)."""
    m = documento.modelo
    resumen: dict[str, Any] = {
        "guid": documento.guid,
        "nombre": documento.nombre,
        "nodos": len(m.nodos),
        "barras": len(m.barras),
        "apoyos": len(m.apoyos),
        "materiales": len(m.materiales),
        "secciones": len(m.secciones),
        "masas": len(m.masas),
        "casos": list(m.casos),
        "combinaciones": list(m.combinaciones),
        "cargas": len(m.cargas),
        "origen": dict(documento.origen) if documento.origen is not None else None,
        "problemas": [str(p) for p in m.validar()],
    }
    d = documento.derivacion
    resumen["derivacion"] = None if d is None else {
        "avisos": list(d.avisos),
        "apoyos_sugeridos": dict(d.apoyos),
        "cruces": [{"miembros": [a, b], "unido": unido} for a, b, unido in d.cruces],
        "trazas": len(d.trazas),
        "opciones": {"tol_nodo": d.opciones.tol_nodo, "unir_cruces": d.opciones.unir_cruces, "excentricidades": d.opciones.excentricidades},
    }  # fmt: skip
    resumen["avisos"] = list(d.avisos) if d is not None else []
    return resumen


def _info_archivo(archivo: ArchivoVybs | None, documento: DocumentoSimulacion | None) -> dict[str, Any] | None:
    if archivo is None:
        return None
    return {
        "ruta": str(archivo.ruta), "guid": archivo.guid, "hash_contenido": archivo.hash_contenido, "fecha": archivo.fecha,
        "al_dia": archivo.documento is documento, "solo_lectura": archivo.solo_lectura,
    }  # fmt: skip


# --- registro ------------------------------------------------------------------------------------------------------


def registrar_comandos_modelo(bus: BusComandos, estado: EstadoKernel) -> BusComandos:
    """Registra los comandos ``modelo.*`` en `bus`; `estado` guarda el archivo abierto o guardado."""

    @bus.registrar(
        "modelo.importar_vyba",
        "Deriva el modelo analítico de un ensamble .vyba de COVILLAF DESIGN y sustituye el modelo (se puede deshacer).",
        _esquema({"ruta": _RUTA, "nombre": _NOMBRE, "opciones": ESQUEMA_OPCIONES}, ("ruta",)),
        historial=lambda args: {"archivo": Path(args["ruta"]).name, "opciones": args.get("opciones", {})},
    )
    def importar_vyba(tx: Transaccion, args: dict[str, Any]) -> dict[str, Any]:
        ruta = ruta_entrada(args["ruta"], ".vyba")
        opciones = opciones_derivacion(args.get("opciones", {}))
        try:
            derivacion = leer_vyba(ruta, opciones)
        except ErrorDerivacion as error:
            raise ErrorComando("derivacion", f"«{ruta.name}»: {error}") from error
        except Exception as error:
            raise ErrorComando("lectura", f"«{ruta.name}» no se pudo leer: {error}") from error
        fisicos = {t.guid: (t.clase_ifc, t.miembro) for t in derivacion.trazas.values() if t.guid}
        documento = DocumentoSimulacion(
            guid=guid_ifc.nuevo(), nombre=args.get("nombre") or derivacion.modelo.nombre, modelo=derivacion.modelo,
            origen=MappingProxyType(dict(derivacion.origen)) if derivacion.origen else None,
            fisicos=MappingProxyType(fisicos), derivacion=derivacion,
        )  # fmt: skip
        for guid in tx.modelo.guids():
            tx.borrar(guid)
        tx.anadir(documento.guid, documento)
        return resumen_documento(documento)

    @bus.registrar(
        "modelo.abrir_vybs",
        "Abre un modelo de simulación .vybs y sustituye el modelo entero (no se puede deshacer hacia antes).",
        _esquema({"ruta": _RUTA}, ("ruta",)),
        historial=lambda args: {"archivo": Path(args["ruta"]).name},
    )
    def abrir_vybs(tx: Transaccion, args: dict[str, Any]) -> dict[str, Any]:
        ruta = ruta_entrada(args["ruta"], ".vybs")
        try:
            leido = leer_vybs(ruta)
            fisicos = fisicos_de_ifc(leido.contenedor.verdad)
        except Exception as error:
            raise ErrorComando("lectura", f"«{ruta.name}» no se pudo abrir: {error}") from error
        manifest = leido.contenedor.manifest
        documentos = (leido.enlaces or {}).get("documentos") or []
        documento = DocumentoSimulacion(
            guid=manifest["guid"], nombre=manifest.get("nombre") or leido.modelo.nombre, modelo=leido.modelo,
            origen=MappingProxyType(dict(documentos[0])) if documentos else None, fisicos=MappingProxyType(fisicos),
        )  # fmt: skip
        tx.reemplazar_modelo([documento])
        creado = manifest.get("creado")
        archivo = ArchivoVybs(ruta.resolve(), documento.guid, leido.hash_contenido, documento, ahora_utc(), leido.contenedor.solo_lectura,
                              MappingProxyType(dict(creado)) if isinstance(creado, dict) else None)  # fmt: skip
        estado.poner_archivo(archivo)  # al final: nada puede fallar ya dentro del comando
        return {
            **resumen_documento(documento), "ruta": str(archivo.ruta), "hash_contenido": archivo.hash_contenido,
            "modificado": False, "solo_lectura": archivo.solo_lectura, "avisos_archivo": list(leido.contenedor.avisos),
        }  # fmt: skip

    @bus.registrar(
        "modelo.guardar_vybs",
        "Guarda el modelo de simulación como .vybs (analysis.ifc + analisis.json + enlaces.json). Sin «ruta», en la actual.",
        _esquema({"ruta": _RUTA, "nombre": _NOMBRE, "autor": _NOMBRE}),
    )
    def guardar_vybs(tx: Transaccion, args: dict[str, Any]) -> dict[str, Any]:
        documento = documento_actual(tx)
        anterior = estado.archivo
        if "ruta" in args:
            ruta = ruta_salida(args["ruta"], ".vybs")
        elif anterior is not None:
            ruta = anterior.ruta
        else:
            raise ErrorComando("sin_ruta", "el modelo nunca se ha guardado: indique dónde guardarlo («ruta»)")
        # Por ruta, no por documento: un .vybs de una versión más nueva no se reescribe aunque el modelo haya cambiado.
        if anterior is not None and anterior.solo_lectura and ruta.resolve() == anterior.ruta:
            raise ErrorComando("solo_lectura", "el .vybs es de una versión más nueva de COVILLAF SIMULATE: guárdelo con otro nombre")
        # …y cualquier otro .vybs más nuevo que ya esté en el destino, esté abierto o no.
        if (nueva := version_mas_nueva(ruta)) is not None:
            raise ErrorComando("solo_lectura", f"«{ruta.name}» es un .vybs de una versión más nueva o que no se puede leer (versión {nueva}): guárdelo con otro nombre")
        nombre = args.get("nombre") or documento.nombre
        if anterior is not None and anterior.guid == documento.guid and anterior.creado is not None:
            creado, modificado = dict(anterior.creado), sello(args.get("autor"))
        else:
            creado, modificado = sello(args.get("autor")), None
        try:
            k = construir_vybs(
                documento.modelo, guid=documento.guid, nombre=nombre, creado=creado, modificado=modificado,
                origen=dict(documento.origen) if documento.origen else None, fisicos=dict(documento.fisicos) or None,
                kernel={"nombre": "covillaf_sim_kernel", "version": __version__},
            )  # fmt: skip
            escrito = contenedor_sim.escribir(k, ruta)
        except OSError as error:
            raise ErrorComando("escritura", f"«{ruta.name}» no se pudo escribir: {error}") from error
        pendiente = bus.historial_pendiente()
        bus.marcar_guardado(len(pendiente))
        sello_final = k.manifest.get("modificado") or k.manifest["creado"]
        archivo = ArchivoVybs(escrito.resolve(), documento.guid, k.manifest["hash_contenido"], documento, sello_final["fecha"],
                              creado=MappingProxyType(dict(k.manifest["creado"])))  # fmt: skip
        estado.poner_archivo(archivo)
        return {
            "ruta": str(archivo.ruta), "guid": archivo.guid, "nombre": nombre, "hash_contenido": archivo.hash_contenido,
            "bytes": escrito.stat().st_size, "modificado": False, "avisos": list(k.avisos),
        }  # fmt: skip

    @bus.registrar(
        "modelo.resumen",
        "Resumen del modelo: nodos, barras, casos, avisos de la derivación, archivo y estado de los resultados.",
        _esquema({}),
    )
    def resumen(tx: Transaccion, args: dict[str, Any]) -> dict[str, Any]:
        documento = documento_de(tx.modelo)
        base: dict[str, Any] = {"cargado": documento is not None, "modificado": bus.modificado}
        if documento is not None:
            base |= resumen_documento(documento)
        base["archivo"] = _info_archivo(estado.archivo, documento)
        base["resultados"] = estado.estado_resultados(documento)
        return base

    return bus
