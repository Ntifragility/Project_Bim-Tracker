"""Tareas del kernel (fuera del candado del bus, con progreso y cancelación cooperativa): ``analisis.estatico``,
``analisis.modal``, ``resultados.guardar_vybres`` y ``verificacion.ejecutar``. Mismo nombre en RPC (``tarea.iniciar``)
y en la API Python (``GestorTareas.iniciar``), H-04.

**Progreso y cancelación dentro del motor.** `analizar_estatico` y `analizar_modal` reciben ``progreso`` (ver
`covillaf.sim.solver.progreso`): el motor lo llama al empezar cada fase (preparar barras, ensamblar, factorizar, resolver
o extraer modos, Sturm, recuperar…), dentro de sus bucles y en cada producto del Lanczos. El informe de la tarea
traduce la fracción del motor a [`INICIO_MOTOR`, `FIN_MOTOR`], reenvía el texto de la fase y llama a
``contexto.comprobar()``: una cancelación sale del motor como `TareaCancelada` en el siguiente aviso, con las
factorizaciones ya liberadas, y el resultado no se guarda. Lo único que no se interrumpe es una llamada compilada (la
factorización o una inercia de Sturm): se atiende al volver de ella.

**Resolvedor lineal.** Se respeta el de quien lanza la tarea (``with usar_resolvedor(...)`` alrededor de
``GestorTareas.iniciar``: la tarea corre en una copia de su contexto) y el argumento ``resolvedor`` lo fija para esa
tarea (dentro de su hilo). El que se usó sale en el resultado (``metadatos.resolvedor`` del motor).

Los resultados completos quedan en el `EstadoKernel`, ligados al documento analizado; la tarea devuelve un resumen JSON.
Errores con ``clave`` estable (``error.clave`` de ``tarea.terminada``): ``sin_modelo``, ``sin_casos``,
``modelo_no_valido``, ``inestable``, ``elemento``, ``pardiso``, ``casos_inexistentes``, ``analisis``,
``sin_resultados``, ``extension``, ``carpeta_inexistente``, ``escritura``, ``caso_desconocido``.
"""
from __future__ import annotations

import contextlib
import math
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Any

import numpy as np

from covillaf.core import guid as guid_ifc
from covillaf.core.tiempo import ahora_utc
from covillaf.sim.io import construir_vybres
from covillaf.sim.io import contenedor as contenedor_sim
from covillaf.sim.modelo import ErrorModelo
from covillaf.sim.resultados import ResultadosEstaticos, ResultadosModales
from covillaf.sim.solver import (
    ErrorElemento,
    ErrorInestabilidad,
    ErrorPardiso,
    analizar_estatico,
    analizar_modal,
    usar_resolvedor,
)
from covillaf.sim.solver.lineal import RESOLVEDORES
from covillaf.sim.solver.verificacion import CASOS
from covillaf_sim_kernel.bus import ErrorComando
from covillaf_sim_kernel.comandos_modelo import ruta_salida, sello
from covillaf_sim_kernel.estado import TIPOS_RESULTADO, DocumentoSimulacion, EstadoKernel, Resultado, documento_de
from covillaf_sim_kernel.tareas import ContextoTarea, GestorTareas

# --- esquemas ----------------------------------------------------------------------------------------------------------

_RESOLVEDOR = {"enum": list(RESOLVEDORES), "description": "sistema lineal: auto (por tamaño), superlu o pardiso"}
_ID = {"type": "string", "minLength": 1, "maxLength": 200}
#: Elementos como mucho en las listas de argumentos (= `tareas.LIMITE_LISTA`, que lo comprueba antes del esquema).
MAXIMO_LISTA = 1000
_RUTA = {"type": "string", "minLength": 1, "maxLength": 1024}


def _esquema(propiedades: dict[str, Any], requeridos: tuple[str, ...] = ()) -> dict[str, Any]:
    return {"type": "object", "properties": propiedades, "required": list(requeridos), "additionalProperties": False}


ESQUEMA_ESTATICO = _esquema({
    "casos": {"type": "array", "items": _ID, "uniqueItems": True, "maxItems": MAXIMO_LISTA, "description": "casos a resolver (todos si falta)"},
    "deformacion_cortante": {"type": "boolean"},
    "resolvedor": _RESOLVEDOR,
})
ESQUEMA_MODAL = _esquema({
    "n_modos": {"type": "integer", "minimum": 1, "maximum": 1000},
    "masa": {"enum": ["consistente", "concentrada"]},
    "desplazamiento": {"type": "number", "minimum": 0, "description": "σ (rad²/s²): modos más próximos a σ si > 0"},
    "deformacion_cortante": {"type": "boolean"},
    "sturm": {"type": "boolean", "description": "certificado de Sturm (una factorización más)"},
    "resolvedor": _RESOLVEDOR,
})
ESQUEMA_VYBRES = _esquema(
    {"ruta": _RUTA, "nombre": {"type": "string", "minLength": 1, "maxLength": 200}, "autor": {"type": "string", "minLength": 1, "maxLength": 200},
     "exportar_vtu": {"type": "boolean", "description": "incluir la exportación VTU/PVD como cache"}},
    ("ruta",),
)  # fmt: skip
ESQUEMA_VERIFICACION = _esquema({
    "casos": {"type": "array", "items": _ID, "uniqueItems": True, "maxItems": MAXIMO_LISTA, "description": "ids del registro (todos si falta)"},
    "resolvedor": _RESOLVEDOR,
})


# --- ayudas ------------------------------------------------------------------------------------------------------------


def _numero(valor: Any) -> float | None:
    """Número JSON (None si no es finito: JSON no admite NaN ni infinitos)."""
    x = float(valor)
    return x if math.isfinite(x) else None


def _documento(contexto: ContextoTarea) -> DocumentoSimulacion:
    documento = documento_de(contexto.instantanea)
    if documento is None:
        raise ErrorComando("sin_modelo", "no hay modelo: importe un .vyba (modelo.importar_vyba) o abra un .vybs (modelo.abrir_vybs)")
    return documento


@contextlib.contextmanager
def _resolvedor(args: Mapping[str, Any]) -> Iterator[None]:
    """El resolvedor de ``args`` para lo que corra dentro; sin él, el del contexto de quien lanzó la tarea."""
    if "resolvedor" in args:
        with usar_resolvedor(args["resolvedor"]):
            yield
    else:
        yield


#: Tramo de la barra de progreso de la tarea que ocupa el motor (antes: comprobar; después: resumir y guardar).
INICIO_MOTOR, FIN_MOTOR = 0.02, 0.95


def _informe(contexto: ContextoTarea) -> Callable[[float, str], None]:
    """``progreso`` para el motor: avisa en la escala de la tarea y atiende la cancelación (lanza `TareaCancelada`)."""

    def informe(fraccion: float, texto: str) -> None:
        contexto.progreso(INICIO_MOTOR + (FIN_MOTOR - INICIO_MOTOR) * fraccion, texto)
        contexto.comprobar()

    return informe


def _motor(funcion: Callable[..., Any], *args: Any, **opciones: Any) -> Any:
    """Llama al motor y traduce sus errores a `ErrorComando` con clave estable."""
    try:
        return funcion(*args, **opciones)
    except ErrorModelo as error:
        raise ErrorComando("modelo_no_valido", str(error)) from error
    except ErrorInestabilidad as error:
        raise ErrorComando("inestable", str(error)) from error
    except ErrorElemento as error:
        raise ErrorComando("elemento", str(error)) from error
    except ErrorPardiso as error:
        raise ErrorComando("pardiso", str(error)) from error
    except KeyError as error:
        detalle = str(error.args[0] if error.args else error)
        if detalle.startswith("casos inexistentes"):  # el único KeyError que el motor lanza a propósito
            raise ErrorComando("casos_inexistentes", detalle) from error
        raise ErrorComando("analisis", f"error interno del motor (clave {detalle})") from error
    except ValueError as error:
        raise ErrorComando("analisis", str(error)) from error


def resumen_estatico(r: ResultadosEstaticos) -> dict[str, Any]:
    """Resumen JSON: por caso, desplazamiento máximo (mm, nodo), reacción total (N), residuo y desequilibrio."""
    casos = []
    for j, caso in enumerate(r.casos):
        normas = np.linalg.norm(r.desplazamientos[j][:, :3], axis=1)
        k = int(np.argmax(normas)) if normas.size else 0
        casos.append({
            "caso": caso,
            "desplazamiento_maximo": {"valor": _numero(normas[k]) if normas.size else 0.0, "nodo": r.nodos[k] if normas.size else None, "unidad": "mm"},
            "reaccion_total": {"valor": [_numero(x) for x in r.reacciones[j][:, :3].sum(axis=0)], "unidad": "N"},
            "residuo": _numero(r.residuos[j]) if r.residuos is not None else None,
            "desequilibrio": _numero(r.desequilibrios[j]) if r.desequilibrios is not None else None,
        })  # fmt: skip
    m = r.metadatos
    return {
        "casos": casos, "combinaciones": list(r.combinaciones), "nodos": len(r.nodos), "barras": len(r.barras),
        "metadatos": {c: m.get(c) for c in ("solver", "version", "analisis", "gdl", "gdl_libres", "resolvedor", "pasos_refinamiento", "deformacion_cortante")}
        | {"pivote_minimo": _numero(m.get("pivote_minimo", 0.0)), "segundos": _numero(m.get("segundos", 0.0))},
        "avisos": list(r.avisos),
    }  # fmt: skip


def resumen_modal(r: ResultadosModales) -> dict[str, Any]:
    """Resumen JSON: frecuencias (Hz), periodos (s; null si infinito), ratios de masa en X, Y, Z, calidad y Sturm."""
    s = r.sturm
    m = r.metadatos
    return {
        "n_modos": r.n_modos,
        "frecuencias": [_numero(f) for f in r.frecuencias],
        "periodos": [_numero(t) for t in r.periodos],
        "ratios_masa": [[_numero(x) for x in fila[:3]] for fila in r.ratios_masa],
        "ratios_acumulados": [_numero(x) for x in r.ratios_acumulados[-1][:3]] if r.n_modos else [0.0, 0.0, 0.0],
        "certificado": bool(r.certificado),
        "residuo_maximo": _numero(r.residuos.max()) if r.residuos is not None and r.residuos.size else None,
        "sturm": None if s is None else {
            "valido": s.valido, "concluyente": s.concluyente, "perdidos": s.perdidos, "por_debajo": s.por_debajo,
            "calculados": s.calculados, "repetidos_cortados": s.repetidos_cortados, "desplazamiento": _numero(s.desplazamiento),
        },
        "tipo_masa": r.tipo_masa,
        "metadatos": {c: m.get(c) for c in ("solver", "version", "analisis", "metodo", "resolvedor", "gdl", "gdl_libres", "modos")}
        | {"desplazamiento": _numero(m.get("desplazamiento", 0.0)), "segundos": _numero(m.get("segundos", 0.0))},
        "avisos": list(r.avisos),
    }  # fmt: skip


def _ruta_proyecto(archivo: Path, carpeta: Path) -> tuple[str, str | None]:
    """Ruta del ``.vybs`` relativa a la carpeta del ``.vybres`` (``ruta_proyecto`` del esquema común: sin «..»); si no
    está dentro, solo su nombre y un aviso."""
    try:
        return archivo.resolve().relative_to(carpeta.resolve()).as_posix(), None
    except ValueError:
        return archivo.name, f"el .vybs no está en la carpeta del .vybres: se enlaza solo por su nombre ({archivo.name})"


def _cifra(valor: float | None, formato: str) -> str:
    return format(valor, formato) if valor is not None else "no finito"


def _tabla_verificacion(filas: list[dict[str, Any]]) -> str:
    """La misma tabla que ``python -m covillaf.sim.solver.verificacion``."""
    lineas = [f"{'caso':<7} {'estado':<6} {'magnitud':<44} {'calculado':>16} {'referencia':>16} error"]
    for f in filas:
        estado = "OK" if f["cumple"] else "FALLA"
        if f.get("detalle"):
            lineas.append(f"{f['caso']:<7} {estado:<6} {f['detalle'][:120]}")
            continue
        lineas.append(
            f"{f['caso']:<7} {estado:<6} {f['magnitud'][:44]:<44} {_cifra(f['calculado'], ' .9e')} {_cifra(f['referencia'], ' .9e')} "
            f"{_cifra(f['error'], '.2e')} ≤ {f['tolerancia']:.0e} {f['unidad']}"
        )
    return "\n".join(lineas)


# --- registro ------------------------------------------------------------------------------------------------------


def registrar_tareas_analisis(tareas: GestorTareas, estado: EstadoKernel) -> GestorTareas:
    """Registra las tareas en `tareas`; los resultados se guardan en `estado`."""

    @tareas.registrar(
        "analisis.estatico",
        "Análisis estático lineal con el motor propio (todos los casos, o los pedidos, sobre una factorización).",
        ESQUEMA_ESTATICO,
    )
    def estatico(contexto: ContextoTarea, args: dict[str, Any]) -> dict[str, Any]:
        documento = _documento(contexto)
        casos = args.get("casos")
        if not (documento.modelo.casos if casos is None else casos):
            raise ErrorComando("sin_casos", "el modelo no tiene casos de carga: nada que resolver")
        contexto.progreso(0.0, "preparar el análisis estático")
        contexto.comprobar()
        with _resolvedor(args):
            r = _motor(analizar_estatico, documento.modelo, casos, deformacion_cortante=args.get("deformacion_cortante", True),
                       progreso=_informe(contexto))  # fmt: skip
        contexto.comprobar()
        contexto.progreso(FIN_MOTOR, "resumir los resultados")
        resumen = resumen_estatico(r)
        estado.guardar_resultado(Resultado("estatico", documento, r, resumen, ahora_utc(), contexto.id))
        contexto.progreso(1.0, "análisis estático terminado")
        return resumen

    @tareas.registrar(
        "analisis.modal",
        "Análisis modal con el motor propio: frecuencias, formas, masas participativas, error regresivo y certificado de Sturm.",
        ESQUEMA_MODAL,
    )
    def modal(contexto: ContextoTarea, args: dict[str, Any]) -> dict[str, Any]:
        documento = _documento(contexto)
        contexto.progreso(0.0, "preparar el análisis modal")
        contexto.comprobar()
        opciones = {
            "masa": args.get("masa", "consistente"), "desplazamiento": args.get("desplazamiento"),
            "deformacion_cortante": args.get("deformacion_cortante", True), "sturm": args.get("sturm", True),
        }  # fmt: skip
        with _resolvedor(args):
            r = _motor(analizar_modal, documento.modelo, args.get("n_modos", 12), **opciones, progreso=_informe(contexto))
        contexto.comprobar()
        contexto.progreso(FIN_MOTOR, "resumir los resultados")
        resumen = resumen_modal(r)
        estado.guardar_resultado(Resultado("modal", documento, r, resumen, ahora_utc(), contexto.id))
        contexto.progreso(1.0, "análisis modal terminado")
        return resumen

    @tareas.registrar(
        "resultados.guardar_vybres",
        "Guarda los resultados al día del modelo (estático y modal) como .vybres (VTKHDF 2.2 + /covillaf, VTU como cache).",
        ESQUEMA_VYBRES,
    )
    def guardar_vybres(contexto: ContextoTarea, args: dict[str, Any]) -> dict[str, Any]:
        documento = _documento(contexto)
        ruta = ruta_salida(args["ruta"], ".vybres")
        al_dia = {tipo: estado.resultado(tipo, documento) for tipo in TIPOS_RESULTADO}
        if not any(al_dia.values()):
            raise ErrorComando("sin_resultados", "no hay resultados al día de este modelo: ejecute analisis.estatico o analisis.modal")
        avisos = [f"resultado {tipo} desactualizado (de otro modelo): no se incluye"
                  for tipo in TIPOS_RESULTADO if al_dia[tipo] is None and estado.resultado(tipo) is not None]  # fmt: skip
        archivo = estado.vybs_de(documento)
        modelo_vybs = None
        if archivo is None:
            avisos.append("el modelo no está guardado como .vybs (o cambió desde entonces): el .vybres queda sin enlace")
        else:
            relativa, aviso = _ruta_proyecto(archivo.ruta, ruta.parent)
            modelo_vybs = {"guid": archivo.guid, "hash_contenido": archivo.hash_contenido, "ruta": relativa}
            avisos += [aviso] if aviso else []
        contexto.progreso(0.1, "preparar la malla y los pasos (VTKHDF)")
        contexto.comprobar()
        k = construir_vybres(
            documento.modelo,
            estatico=al_dia["estatico"].resultados if al_dia["estatico"] else None,
            modal=al_dia["modal"].resultados if al_dia["modal"] else None,
            modelo_vybs=modelo_vybs, creado=sello(args.get("autor")), guid=guid_ifc.nuevo(),
            nombre=args.get("nombre") or documento.nombre, exportar_vtu=args.get("exportar_vtu", True),
        )  # fmt: skip
        contexto.comprobar()
        contexto.progreso(0.8, "escribir el archivo")
        try:
            escrito = contenedor_sim.escribir(k, ruta)
        except OSError as error:
            raise ErrorComando("escritura", f"«{ruta.name}» no se pudo escribir: {error}") from error
        contexto.progreso(1.0, "resultados guardados")
        return {
            "ruta": str(escrito.resolve()), "bytes": escrito.stat().st_size, "hash_contenido": k.manifest["hash_contenido"],
            "analisis": list(k.manifest["analisis"]), "modelo": dict(k.manifest["modelo"]), "avisos": avisos + list(k.avisos),
        }  # fmt: skip

    @tareas.registrar(
        "verificacion.ejecutar",
        "Ejecuta los casos de verificación del motor (solución de referencia y tolerancia declaradas) y devuelve su tabla.",
        ESQUEMA_VERIFICACION,
    )
    def verificacion(contexto: ContextoTarea, args: dict[str, Any]) -> dict[str, Any]:
        ids = list(args.get("casos") or CASOS)
        desconocidos = [i for i in ids if i not in CASOS]
        if desconocidos:
            raise ErrorComando("caso_desconocido", f"casos de verificación desconocidos: {desconocidos}", desconocidos[0])
        filas: list[dict[str, Any]] = []
        with _resolvedor(args):
            for k, id_caso in enumerate(ids):
                contexto.comprobar()
                caso = CASOS[id_caso]
                contexto.progreso(k / len(ids), f"{caso.id} · {caso.titulo}")
                try:
                    comprobaciones = caso.ejecutar()
                except Exception as error:  # un caso que falla no para los demás: cuenta como FALLA
                    filas.append({"caso": caso.id, "titulo": caso.titulo, "analisis": caso.analisis, "cumple": False,
                                  "detalle": f"el caso falló: {type(error).__name__}: {error}"})  # fmt: skip
                    continue
                for c in comprobaciones:
                    filas.append({
                        "caso": caso.id, "titulo": caso.titulo, "analisis": caso.analisis, "magnitud": c.magnitud,
                        "calculado": _numero(c.calculado), "referencia": _numero(c.referencia), "error": _numero(c.error),
                        "tolerancia": c.tolerancia, "unidad": c.unidad, "cumple": c.cumple,
                    })  # fmt: skip
        contexto.progreso(1.0, "verificación terminada")
        fallos = sum(not f["cumple"] for f in filas)
        return {
            "casos": len(ids), "comprobaciones": len(filas), "fallos": fallos, "valido": fallos == 0,
            "resolvedor": args.get("resolvedor"), "filas": filas, "tabla": _tabla_verificacion(filas),
        }  # fmt: skip

    return tareas
