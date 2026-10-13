"""Estado del kernel de SIMULATE: el **documento de simulación** (el elemento del modelo del bus) y lo que no es modelo
(archivo ``.vybs`` abierto o guardado y resultados de los análisis, datos derivados).

Modelo del bus: un solo elemento, `DocumentoSimulacion`, con el GUID del documento (el ``manifest.guid`` del ``.vybs``
al abrirlo; uno nuevo al importar un ``.vyba``). Es **inmutable por convención** (regla del bus de DESIGN: modificar =
sustituir): nadie modifica su ``modelo`` (``covillaf.sim.modelo.Modelo``, que en sí es mutable); un comando que cambie el
modelo analítico creará un documento nuevo con una copia. Así deshacer/rehacer son exactos y las tareas pueden leer la
instantánea sin copiar nada.

Resultados: se guardan con el documento que se analizó y solo valen para **ese** objeto (identidad): si el modelo
cambia (importar otro, deshacer…), quedan «desactualizados» hasta repetir el análisis. No entran en deshacer ni en el
historial (datos derivados, ficha D-8 §2 punto 8).
"""
from __future__ import annotations

import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any

from covillaf.sim.io import Derivacion
from covillaf.sim.modelo import Modelo

TIPOS_RESULTADO = ("estatico", "modal")


@dataclass(frozen=True, eq=False, slots=True)
class DocumentoSimulacion:
    """El modelo de simulación tal como lo guarda el bus. `origen`: documento del que se derivó (``enlaces.json``:
    ``{guid, formato, hash, ruta}``); `fisicos`: GUID físico → (clase IFC, nombre) para las copias de referencia del
    ``analysis.ifc``; `derivacion`: trazas, apoyos sugeridos, cruces y avisos (solo si viene de un ``.vyba``)."""

    guid: str
    nombre: str
    modelo: Modelo
    origen: Mapping[str, str] | None = None
    fisicos: Mapping[str, tuple[str, str]] = field(default_factory=lambda: MappingProxyType({}))
    derivacion: Derivacion | None = None


@dataclass(frozen=True, eq=False, slots=True)
class ArchivoVybs:
    """El ``.vybs`` del que salió (al abrir) o al que se escribió (al guardar) `documento`."""

    ruta: Path
    guid: str
    hash_contenido: str
    documento: DocumentoSimulacion
    fecha: str
    solo_lectura: bool = False
    #: Sello ``creado`` del manifest (se conserva al volver a guardar el mismo documento).
    creado: Mapping[str, str] | None = None


@dataclass(frozen=True, eq=False, slots=True)
class Resultado:
    """Resultado de un análisis: `tipo` (``estatico`` | ``modal``), el `documento` analizado, el objeto de
    ``covillaf.sim.resultados`` y su resumen JSON (lo que devolvió la tarea)."""

    tipo: str
    documento: DocumentoSimulacion
    resultados: Any
    resumen: Mapping[str, Any]
    fecha: str
    tarea: str


def documento_de(elementos: Mapping[str, Any] | Any) -> DocumentoSimulacion | None:
    """El `DocumentoSimulacion` de una instantánea (GUID → elemento) o del ``Modelo`` del bus; None si no hay."""
    if isinstance(elementos, Mapping):
        candidatos = elementos.values()
    else:
        candidatos = (elementos.obtener(g) for g in elementos.guids())
    return next((e for e in candidatos if isinstance(e, DocumentoSimulacion)), None)


class EstadoKernel:
    """Lo que el kernel recuerda fuera del modelo del bus. Seguro entre hilos (las tareas escriben resultados)."""

    def __init__(self) -> None:
        self._candado = threading.Lock()
        self._archivo: ArchivoVybs | None = None
        self._resultados: dict[str, Resultado] = {}

    @property
    def archivo(self) -> ArchivoVybs | None:
        with self._candado:
            return self._archivo

    def poner_archivo(self, archivo: ArchivoVybs | None) -> None:
        with self._candado:
            self._archivo = archivo

    def vybs_de(self, documento: DocumentoSimulacion) -> ArchivoVybs | None:
        """El ``.vybs`` que contiene exactamente `documento` (abierto o guardado y sin cambios desde entonces)."""
        with self._candado:
            archivo = self._archivo
        return archivo if archivo is not None and archivo.documento is documento else None

    def guardar_resultado(self, resultado: Resultado) -> None:
        if resultado.tipo not in TIPOS_RESULTADO:
            raise ValueError(f"tipo de resultado desconocido: {resultado.tipo!r}")
        with self._candado:
            self._resultados[resultado.tipo] = resultado

    def resultado(self, tipo: str, documento: DocumentoSimulacion | None = None) -> Resultado | None:
        """El último resultado de `tipo`; si se da `documento`, solo si es de ese mismo documento (al día)."""
        with self._candado:
            r = self._resultados.get(tipo)
        if r is None or (documento is not None and r.documento is not documento):
            return None
        return r

    def estado_resultados(self, documento: DocumentoSimulacion | None) -> dict[str, dict[str, Any]]:
        """Por tipo: ``{estado: "al_dia" | "desactualizado", fecha, tarea}`` (los tipos sin resultado no aparecen)."""
        with self._candado:
            resultados = dict(self._resultados)
        return {
            tipo: {"estado": "al_dia" if r.documento is documento else "desactualizado", "fecha": r.fecha, "tarea": r.tarea}
            for tipo, r in sorted(resultados.items())
        }
