"""Campos de resultados para el visor (capa de resultados de la interfaz): geometría analítica y valores por estación
de barra, listos para las tramas VYBF (`covillaf_sim_kernel.vybf`, ``docs/formatos/trama_vybf.md``).

El visor solo dibuja: todo lo que necesita interpolar lo interpola el kernel, en doble, sobre las **estaciones** de
cada barra (abscisas en mm desde el extremo i, comunes a todos los estados: `covillaf.sim.resultados.estaciones`, con las
cargas puntuales repetidas para el salto a izquierda y derecha). Posición de una estación: ``extremo_i + x · eje_x``.

- **Deformada estática** (caso o combinación lineal): la integración exacta de `covillaf.sim.resultados.diagramas`
  (con las cargas de tramo), girada a ejes globales. En x = L coincide con el extremo j.
- **Esfuerzos** (N, Vy, Vz, T, My, Mz en ejes locales; N y N·mm): los mismos diagramas.
- **Forma modal**: los desplazamientos de los extremos de la barra (con desfases y liberaciones: la condensación del
  motor, `ElementoBarra.extremos`) interpolados con las funciones de forma de la barra (Hermite o Timoshenko, exactas
  sin carga de tramo; axial lineal), en ejes globales. Normalizada a masa unidad (φᵀMφ = 1): la escala la pone el visor.

La geometría es la del **documento** (inmutable): se calcula una vez por documento y su `revision` (u32 de su huella)
va en cada trama para que el visor rechace un campo de otra geometría.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

import numpy as np

from covillaf.sim.modelo import Modelo, ejes_barra, extremos
from covillaf.sim.resultados import ResultadosEstaticos, ResultadosModales, diagramas, estaciones
from covillaf.sim.solver.barra import funciones_forma
from covillaf.sim.solver.ensamblado import numerar, preparar_barras

#: Estaciones equiespaciadas por barra (más las abscisas de las cargas): bastan para dibujar deformadas cúbicas y
#: diagramas de momento parabólicos sin quiebros visibles.
N_ESTACIONES = 11


@dataclass(frozen=True, eq=False)
class Geometria:
    """Modelo analítico para el visor. Estaciones concatenadas por barra en el orden de `barras`: las de la barra k
    son ``inicio[k]:inicio[k + 1]``."""

    nodos: tuple[str, ...]
    puntos: np.ndarray  # (n_nodos, 3) mm
    barras: tuple[str, ...]
    nudos_barra: np.ndarray  # (n_barras, 2) índices en `nodos`
    extremos: np.ndarray  # (n_barras, 2, 3) mm: nodo + desfase rígido
    ejes: np.ndarray  # (n_barras, 3, 3): filas x, y, z locales en ejes globales
    estaciones: tuple[np.ndarray, ...]  # por barra, mm desde el extremo i
    inicio: np.ndarray  # (n_barras + 1,)
    apoyos: tuple[tuple[int, tuple[bool, ...]], ...]  # (índice del nodo, 6 restricciones)
    huella: str  # sha256 del JSON de la geometría
    revision: int  # u32: primeros 4 bytes de la huella (big-endian)

    @property
    def n_estaciones(self) -> int:
        return int(self.inicio[-1])

    def como_json(self) -> dict[str, Any]:
        """Lo que recibe el visor en ``resultados.geometria`` (mm; ejes como filas x, y, z)."""
        return _json(self.nodos, self.puntos, self.barras, self.nudos_barra, self.extremos, self.ejes, self.estaciones,
                     self.apoyos) | {"huella": self.huella, "revision": self.revision, "n_estaciones": self.n_estaciones}  # fmt: skip


def _json(nodos, puntos, barras, nudos_barra, ext, ejes, est, apoyos) -> dict[str, Any]:
    caja = [puntos.min(axis=0).tolist(), puntos.max(axis=0).tolist()] if len(nodos) else [[0.0] * 3, [0.0] * 3]
    return {
        "unidad": "mm",
        "caja": caja,
        "nodos": [{"id": n, "punto": p.tolist()} for n, p in zip(nodos, puntos, strict=True)],
        "barras": [
            {"id": b, "nodos": [int(i), int(j)], "extremos": e.tolist(), "ejes": r.tolist(), "estaciones": x.tolist()}
            for b, (i, j), e, r, x in zip(barras, nudos_barra, ext, ejes, est, strict=True)
        ],
        "apoyos": [{"nodo": int(k), "restricciones": list(r)} for k, r in apoyos],
    }


def geometria(modelo: Modelo, n: int = N_ESTACIONES) -> Geometria:
    """Geometría analítica de `modelo` con las estaciones comunes a todos sus casos."""
    nodos = tuple(modelo.nodos)
    indice = {nid: k for k, nid in enumerate(nodos)}
    puntos = np.array([modelo.nodos[nid].punto for nid in nodos], dtype=float).reshape(-1, 3)
    barras = tuple(modelo.barras)
    nudos = np.array([[indice[b.nodo_i], indice[b.nodo_j]] for b in modelo.barras.values()], dtype=np.int64).reshape(-1, 2)
    ext = np.array([np.stack(extremos(modelo, b)) for b in modelo.barras.values()], dtype=float).reshape(-1, 2, 3)
    ejes = np.array([ejes_barra(modelo, b) for b in modelo.barras.values()], dtype=float).reshape(-1, 3, 3)
    x = estaciones(modelo, tuple(modelo.casos), n)
    est = tuple(x[b] for b in barras)
    inicio = np.concatenate([[0], np.cumsum([e.size for e in est])]).astype(np.int64)
    apoyos = tuple((indice[a.nodo], tuple(bool(v) for v in a.restricciones)) for a in modelo.apoyos.values())
    texto = json.dumps(_json(nodos, puntos, barras, nudos, ext, ejes, est, apoyos), ensure_ascii=False, separators=(",", ":"))
    huella = hashlib.sha256(texto.encode("utf-8")).hexdigest()
    return Geometria(nodos, puntos, barras, nudos, ext, ejes, est, inicio, apoyos, huella, int(huella[:8], 16))


def _comprobar(g: Geometria, nodos: tuple[str, ...], barras: tuple[str, ...] | None = None) -> None:
    if tuple(nodos) != g.nodos or (barras is not None and tuple(barras) != g.barras):
        raise ValueError("los resultados no son de esta geometría (nudos o barras distintos)")


def estado_estatico(modelo: Modelo, g: Geometria, r: ResultadosEstaticos, estado: str) -> tuple[np.ndarray, np.ndarray]:
    """(deformada (n_estaciones, 3) mm en ejes globales, esfuerzos (n_estaciones, 6) N y N·mm en ejes locales) de un
    caso o una combinación lineal."""
    _comprobar(g, r.nodos, r.barras)
    d = diagramas(modelo, r, estado, dict(zip(g.barras, g.estaciones, strict=True)))
    deformada = np.empty((g.n_estaciones, 3))
    esfuerzos = np.empty((g.n_estaciones, 6))
    for k, b in enumerate(g.barras):
        tramo = slice(g.inicio[k], g.inicio[k + 1])
        dk = d[b]
        deformada[tramo] = dk.u @ g.ejes[k]  # u_local = R·u_global ⇒ u_global (filas) = u_local (filas)·R
        esfuerzos[tramo] = np.column_stack([dk.N, dk.Vy, dk.Vz, dk.T, dk.My, dk.Mz])
    return deformada, esfuerzos


def forma_modal(modelo: Modelo, g: Geometria, r: ResultadosModales, modo: int, deformacion_cortante: bool = True) -> np.ndarray:
    """Forma del modo `modo` (0 = el primero) en las estaciones: (n_estaciones, 3), ejes globales, φᵀMφ = 1."""
    _comprobar(g, r.nodos)
    if not 0 <= modo < r.n_modos:
        raise IndexError(f"modo {modo + 1} fuera de 1…{r.n_modos}")
    num = numerar(modelo)
    elementos = preparar_barras(modelo, num, deformacion_cortante)
    phi = r.formas[modo].reshape(-1)
    forma = np.empty((g.n_estaciones, 3))
    for k, e in enumerate(elementos):
        u_local, _ = e.extremos(phi[e.gdl])
        N = funciones_forma(g.estaciones[k], e.largo, e.phi_y, e.phi_z)  # (n, 3, 12)
        forma[g.inicio[k] : g.inicio[k + 1]] = (N @ u_local) @ e.R
    return forma


def reacciones(g: Geometria, r: ResultadosEstaticos, estado: str) -> list[dict[str, Any]]:
    """Reacciones (N, N·mm) de los nudos con apoyo para un caso o una combinación lineal."""
    _comprobar(g, r.nodos)
    e = r.estado(estado)
    return [{"nodo": g.nodos[k], "valores": e.reacciones[k].tolist()} for k, _ in g.apoyos]
