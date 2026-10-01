"""Métodos RPC de la capa de resultados de la interfaz (aditivos: no suben ``protocolo``): ``resultados.geometria``,
``resultados.campo`` (JSON + una trama VYBF) y ``resultados.tabla``. Son **lecturas** de datos derivados, como
``modelo.mallas`` en DESIGN: no pasan por el bus (ni transacción ni historial) y se calculan en un hilo para no parar el
bucle. Solo sirven resultados **al día** del documento actual (los de otro modelo darían dibujos falsos).

Errores: ``-32002`` con ``data: {metodo, detalle, clave}``; claves ``sin_modelo``, ``sin_resultados`` (no hay o están
desactualizados), ``estado_inexistente``, ``modo_inexistente``; ``-32003`` si un comando está cambiando el modelo.
"""
from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from typing import Any

import numpy as np

from covillaf_sim_kernel import campos, vybf
from covillaf_sim_kernel.bus import BusComandos, ConflictoTransaccion, instantanea
from covillaf_sim_kernel.estado import DocumentoSimulacion, EstadoKernel, Resultado, documento_de
from covillaf_sim_kernel.servidor import (
    CONFLICTO_TRANSACCION,
    FALLO_COMANDO,
    ErrorRpc,
    Metodo,
    Respuesta,
    ServidorKernel,
    Sesion,
    esquema_objeto,
)

#: Campos estáticos calculados que se recuerdan (deformada y esfuerzos de un estado salen del mismo diagrama).
CACHE_ESTADOS = 8
MAGNITUDES = {"desplazamiento": vybf.DESPLAZAMIENTO, "esfuerzos": vybf.ESFUERZOS, "forma": vybf.FORMA_MODAL}
TABLAS = ("reacciones", "desplazamientos", "esfuerzos", "modos")


class _Cache:
    """Geometría del documento actual y los últimos estados estáticos calculados (seguro entre hilos)."""

    def __init__(self) -> None:
        self._candado = threading.Lock()
        self._documento: DocumentoSimulacion | None = None
        self._geometria: campos.Geometria | None = None
        self._estados: OrderedDict[tuple[int, str], tuple[Any, np.ndarray, np.ndarray]] = OrderedDict()
        #: cálculos en curso: clave → (resultados, hecho, [valor o None si falló])
        self._en_curso: dict[tuple[int, str], tuple[Any, threading.Event, list]] = {}

    def geometria(self, documento: DocumentoSimulacion) -> campos.Geometria:
        with self._candado:
            if self._documento is documento and self._geometria is not None:
                return self._geometria
        g = campos.geometria(documento.modelo)
        with self._candado:
            self._documento, self._geometria = documento, g
            self._estados.clear()
        return g

    def estado_estatico(self, documento: DocumentoSimulacion, g: campos.Geometria, r: Resultado, estado: str) -> tuple[np.ndarray, np.ndarray]:
        """Deformada y esfuerzos de un estado: de la caché, del cálculo igual que ya está en curso en otro hilo (se
        espera a ese: auditoría 6fc4e37, M5) o calculados aquí."""
        clave = (id(r.resultados), estado)
        with self._candado:
            guardado = self._estados.get(clave)
            if guardado is not None and guardado[0] is r.resultados:
                self._estados.move_to_end(clave)
                return guardado[1], guardado[2]
            en_curso = self._en_curso.get(clave)
            propio = en_curso is None
            if propio:
                en_curso = self._en_curso[clave] = (r.resultados, threading.Event(), [])
        resultados, listo, salida = en_curso
        if not propio:
            listo.wait()
            if salida and salida[0] is not None and resultados is r.resultados:
                return salida[0]
            return self.estado_estatico(documento, g, r, estado)  # el otro falló o era de otros resultados: repetir
        valor = None
        try:
            valor = campos.estado_estatico(documento.modelo, g, r.resultados, estado)
            with self._candado:
                self._estados[clave] = (r.resultados, *valor)  # la referencia evita reutilizar un id()
                while len(self._estados) > CACHE_ESTADOS:
                    self._estados.popitem(last=False)
            return valor
        finally:
            with self._candado:
                self._en_curso.pop(clave, None)
            salida.append(valor)
            listo.set()


def _error(metodo: str, clave: str, detalle: str) -> ErrorRpc:
    return ErrorRpc(FALLO_COMANDO, f"{metodo}: {detalle}", {"metodo": metodo, "detalle": detalle, "clave": clave})


def _documento(bus: BusComandos, metodo: str) -> DocumentoSimulacion:
    try:
        documento = documento_de(instantanea(bus))
    except ConflictoTransaccion as error:
        raise ErrorRpc(CONFLICTO_TRANSACCION, str(error)) from error
    if documento is None:
        raise _error(metodo, "sin_modelo", "no hay modelo: importe un .vyba o abra un .vybs")
    return documento


def _resultado(estado: EstadoKernel, documento: DocumentoSimulacion, tipo: str, metodo: str) -> Resultado:
    r = estado.resultado(tipo, documento)
    if r is None:
        causa = "están desactualizados (son de otro modelo)" if estado.resultado(tipo) is not None else "no hay"
        raise _error(metodo, "sin_resultados", f"resultados {tipo}: {causa}; ejecute analisis.{tipo}")
    return r


def _comprobar_estado(r: Any, id_estado: str, metodo: str) -> None:
    """Un caso o una combinación **lineal** de los resultados (las envolventes aún no se dibujan ni se tabulan)."""
    try:
        r.factores(id_estado)
    except KeyError as error:
        raise _error(metodo, "estado_inexistente", f"no hay caso ni combinación «{id_estado}» en los resultados") from error
    except ValueError as error:
        raise _error(metodo, "estado_envolvente", f"«{id_estado}»: {error}") from error


def _estados_disponibles(estado: EstadoKernel, documento: DocumentoSimulacion) -> dict[str, Any]:
    salida: dict[str, Any] = {"estatico": None, "modal": None}
    e = estado.resultado("estatico", documento)
    if e is not None:
        combinaciones = [{"id": k, "tipo": c.tipo} for k, c in e.resultados.combinaciones.items()]
        salida["estatico"] = {"casos": list(e.resultados.casos), "combinaciones": combinaciones, "fecha": e.fecha}
    m = estado.resultado("modal", documento)
    if m is not None:
        rm = m.resultados
        salida["modal"] = {
            "modos": [{"modo": k + 1, "frecuencia": float(rm.frecuencias[k]),
                       "periodo": float(rm.periodos[k]) if np.isfinite(rm.periodos[k]) else None} for k in range(rm.n_modos)],
            "fecha": m.fecha,
        }  # fmt: skip
    return salida


def _maximo(g: campos.Geometria, valores: np.ndarray, magnitud: int) -> dict[str, Any] | list[dict[str, Any]]:
    """Valor de mayor módulo con su barra y abscisa: la norma para los vectores de una sola unidad (desplazamiento,
    forma modal); para los esfuerzos (N y N·mm mezclados, una norma no tendría sentido) uno por componente."""
    if magnitud == vybf.ESFUERZOS:
        return [_maximo_de(g, np.abs(valores[:, k])) for k in range(valores.shape[1])]
    return _maximo_de(g, np.linalg.norm(valores, axis=1))


def _maximo_de(g: campos.Geometria, modulo: np.ndarray) -> dict[str, Any]:
    if modulo.size == 0:
        return {"valor": 0.0, "barra": None, "x": None}
    k = int(np.argmax(modulo))
    barra = int(np.searchsorted(g.inicio, k, side="right") - 1)
    return {"valor": float(modulo[k]), "barra": g.barras[barra], "x": float(g.estaciones[barra][k - g.inicio[barra]])}


def metodos_resultados(bus: BusComandos, estado: EstadoKernel) -> dict[str, Metodo]:
    """Tabla de métodos ``resultados.*`` para `ServidorKernel` (se suman a `metodos_basicos`)."""
    cache = _Cache()

    def geometria_json(documento: DocumentoSimulacion) -> dict[str, Any]:
        g = cache.geometria(documento)
        return {"guid": documento.guid, "nombre": documento.nombre, **g.como_json(), "estados": _estados_disponibles(estado, documento)}

    async def m_geometria(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
        documento = _documento(bus, "resultados.geometria")
        return Respuesta(await asyncio.to_thread(geometria_json, documento))

    def campo(documento: DocumentoSimulacion, params: dict[str, Any], lote: int) -> tuple[dict[str, Any], bytes]:
        metodo = "resultados.campo"
        g = cache.geometria(documento)
        magnitud = MAGNITUDES[params["magnitud"]]
        meta: dict[str, Any] = {"tipo": params["tipo"], "magnitud": params["magnitud"]}
        valores_paso = None
        if params["tipo"] == "estatico":
            if magnitud == vybf.FORMA_MODAL or "estado" not in params:
                raise _error(metodo, "parametros", "estático: magnitud desplazamiento o esfuerzos y un «estado» (caso o combinación)")
            r = _resultado(estado, documento, "estatico", metodo)
            _comprobar_estado(r.resultados, params["estado"], metodo)
            deformada, esfuerzos = cache.estado_estatico(documento, g, r, params["estado"])
            valores = deformada if magnitud == vybf.DESPLAZAMIENTO else esfuerzos
            meta["estado"] = params["estado"]
        else:
            if magnitud != vybf.FORMA_MODAL or "modo" not in params:
                raise _error(metodo, "parametros", "modal: magnitud forma y un «modo» (1…n)")
            r = _resultado(estado, documento, "modal", metodo)
            modo = params["modo"]
            if modo > r.resultados.n_modos:
                raise _error(metodo, "modo_inexistente", f"modo {modo}: hay {r.resultados.n_modos}")
            corte = r.resultados.metadatos.get("deformacion_cortante", True)
            valores = campos.forma_modal(documento.modelo, g, r.resultados, modo - 1, corte)
            valores_paso = [float(r.resultados.frecuencias[modo - 1])]
            meta |= {"modo": modo, "frecuencia": valores_paso[0]}
        trama = vybf.codificar(lote, documento.guid, g.revision, vybf.ESTACION, magnitud, valores, valores_paso)
        componentes, unidad = vybf.MAGNITUDES[magnitud]
        rango = np.stack([valores.min(axis=0), valores.max(axis=0)], axis=-1) if len(valores) else np.zeros((componentes, 2))
        meta |= {"lote": lote, "guid": documento.guid, "revision": g.revision, "codigo": magnitud, "componentes": componentes,
                 "unidad": unidad, "n_valores": int(valores.shape[0]), "rango": rango.tolist(), "maximo": _maximo(g, valores, magnitud)}  # fmt: skip
        return meta, trama

    async def m_campo(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
        documento = _documento(bus, "resultados.campo")
        meta, trama = await asyncio.to_thread(campo, documento, params, servidor.nuevo_lote())
        return Respuesta(meta, binarios=(trama,))

    def tabla(documento: DocumentoSimulacion, params: dict[str, Any]) -> dict[str, Any]:
        metodo, nombre = "resultados.tabla", params["tabla"]
        if nombre == "modos":
            rm = _resultado(estado, documento, "modal", metodo).resultados
            filas = [[k + 1, float(rm.frecuencias[k]), float(rm.periodos[k]) if np.isfinite(rm.periodos[k]) else None,
                      *(float(x) for x in rm.ratios_masa[k][:3]), *(float(x) for x in rm.ratios_acumulados[k][:3])]
                     for k in range(rm.n_modos)]  # fmt: skip
            columnas = [("modo", "Modo", ""), ("f", "Frecuencia", "Hz"), ("T", "Periodo", "s"),
                        ("mx", "Masa X", "1"), ("my", "Masa Y", "1"), ("mz", "Masa Z", "1"),
                        ("sx", "Σ X", "1"), ("sy", "Σ Y", "1"), ("sz", "Σ Z", "1")]  # fmt: skip
            return {"tabla": nombre, "columnas": [{"id": i, "titulo": t, "unidad": u} for i, t, u in columnas], "filas": filas}
        if "estado" not in params:
            raise _error(metodo, "parametros", f"la tabla {nombre} necesita un «estado» (caso o combinación)")
        r = _resultado(estado, documento, "estatico", metodo).resultados
        _comprobar_estado(r, params["estado"], metodo)
        e = r.estado(params["estado"])
        g6 = [("ux", "mm"), ("uy", "mm"), ("uz", "mm"), ("rx", "rad"), ("ry", "rad"), ("rz", "rad")]
        if nombre == "desplazamientos":
            columnas = [("nodo", "Nudo", "")] + [(c, c.upper(), u) for c, u in g6]
            filas = [[n, *(float(x) for x in e.desplazamientos[k])] for k, n in enumerate(r.nodos)]
        elif nombre == "reacciones":
            columnas = [("nodo", "Nudo", ""), ("Fx", "Fx", "N"), ("Fy", "Fy", "N"), ("Fz", "Fz", "N"),
                        ("Mx", "Mx", "N·mm"), ("My", "My", "N·mm"), ("Mz", "Mz", "N·mm")]  # fmt: skip
            apoyos = {a.nodo for a in documento.modelo.apoyos.values()}
            filas = [[n, *(float(x) for x in e.reacciones[k])] for k, n in enumerate(r.nodos) if n in apoyos]
        else:  # esfuerzos en los extremos (fuerzas sobre la barra en ejes locales, convenio de `fuerzas_extremo`)
            f6 = [("N", "N"), ("Vy", "N"), ("Vz", "N"), ("T", "N·mm"), ("My", "N·mm"), ("Mz", "N·mm")]
            columnas = [("barra", "Barra", ""), ("extremo", "Extremo", "")] + [(c, c, u) for c, u in f6]
            filas = [[b, extremo, *(float(x) for x in e.fuerzas_extremo[k][6 * j : 6 * j + 6])]
                     for k, b in enumerate(r.barras) for j, extremo in enumerate(("i", "j"))]  # fmt: skip
        return {"tabla": nombre, "estado": params["estado"], "columnas": [{"id": i, "titulo": t, "unidad": u} for i, t, u in columnas],
                "filas": filas}  # fmt: skip

    async def m_tabla(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
        documento = _documento(bus, "resultados.tabla")
        return Respuesta(await asyncio.to_thread(tabla, documento, params))

    texto = {"type": "string", "minLength": 1, "maxLength": 200}
    return {
        "resultados.geometria": Metodo(m_geometria, esquema_objeto()),
        "resultados.campo": Metodo(m_campo, esquema_objeto({
            "tipo": {"enum": ["estatico", "modal"]}, "magnitud": {"enum": list(MAGNITUDES)}, "estado": texto,
            "modo": {"type": "integer", "minimum": 1, "maximum": 1000},
        }, ["tipo", "magnitud"])),
        "resultados.tabla": Metodo(m_tabla, esquema_objeto({"tabla": {"enum": list(TABLAS)}, "estado": texto}, ["tabla"])),
    }  # fmt: skip
