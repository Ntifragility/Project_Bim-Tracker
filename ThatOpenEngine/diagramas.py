"""Esfuerzos internos y deformada a lo largo de una barra: post-proceso exacto por equilibrio e integración.

Esfuerzos: resultantes sobre la cara de normal +x local (convención en `covillaf.sim.modelo.geometria`), por
equilibrio del tramo [0, x] con las fuerzas del extremo i y las cargas de tramo. Deformada: integración exacta
(Gauss por intervalo entre estaciones) de las deformaciones generalizadas desde el extremo i:

    u' = N/EA + αΔT        θx' = T/GJ
    θz' = Mz/EIz           v' = θz + Vy/(G·Asy)
    θy' = My/EIy           w' = −θy + Vz/(G·Asz)

Sin área a cortante (o sin deformación por cortante en el análisis) los términos de cortante son nulos. En x = L
la deformada coincide con los desplazamientos del extremo j (las pruebas lo comprueban).
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np

from covillaf.sim.modelo import CargasBarra, Modelo, cargas_por_barra, longitud
from covillaf.sim.resultados.estatico import ResultadosEstaticos

_XG2, _WG2 = np.polynomial.legendre.leggauss(2)
_XG2, _WG2 = (_XG2 + 1.0) / 2.0, _WG2 / 2.0
_XG3, _WG3 = np.polynomial.legendre.leggauss(3)
_XG3, _WG3 = (_XG3 + 1.0) / 2.0, _WG3 / 2.0


@dataclass(frozen=True, eq=False)
class Diagrama:
    """Esfuerzos (N, N·mm) y deformada local (mm, rad) en las estaciones `x` (mm desde el extremo i).

    Donde hay una carga puntual la abscisa aparece dos veces: valor a la izquierda y a la derecha.
    """

    barra: str
    estado: str
    x: np.ndarray
    N: np.ndarray
    Vy: np.ndarray
    Vz: np.ndarray
    T: np.ndarray
    My: np.ndarray
    Mz: np.ndarray
    u: np.ndarray  # (n, 3): ux, uy, uz locales
    giros: np.ndarray  # (n, 3): rx, ry, rz locales


def _estaciones(largo: float, n: int, cargas: list[CargasBarra], tol: float) -> tuple[np.ndarray, np.ndarray]:
    puntuales = sorted({p.a for cb in cargas for p in cb.puntuales})
    cortes = {v for cb in cargas for t in cb.tramos for v in (t.a, t.b)} | set(puntuales)
    candidatos = sorted(set(np.linspace(0.0, largo, max(n, 2)).tolist()) | {c for c in cortes if -tol <= c <= largo + tol})
    # Se conservan exactas las abscisas de carga y se descartan las estaciones regulares a menos de `tol`.
    xs: list[float] = []
    for x in candidatos:
        if xs and abs(x - xs[-1]) <= tol:
            if x in cortes:
                xs[-1] = x
            continue
        xs.append(x)
    x_final, incluye = [], []
    for x in xs:
        interior = tol < x < largo - tol
        if interior and any(abs(x - a) <= tol for a in puntuales):
            x_final += [x, x]
            incluye += [False, True]
        else:
            x_final.append(x)
            incluye.append(True)
    return np.array(x_final), np.array(incluye)


def _resultantes(x, incluye, f_i, cb: CargasBarra, tol: float) -> tuple[np.ndarray, np.ndarray]:
    """Fuerza (n, 3) y momento (n, 3) internos sobre la cara +x en cada abscisa."""
    x = np.asarray(x, dtype=float)
    F = np.tile(f_i[:3], (x.size, 1))
    M = np.tile(f_i[3:6], (x.size, 1))
    # Momento respecto al punto x de una fuerza Q aplicada en s: (0, −(s − x)·Qz, (s − x)·Qy)
    M[:, 1] += x * f_i[2]
    M[:, 2] -= x * f_i[1]
    for t in cb.tramos:
        if t.b <= t.a:
            continue
        h = np.clip(x, t.a, t.b) - t.a
        s = t.a + h[:, None] * _XG2[None, :]
        q = t.q(s)
        I0 = h[:, None] * np.einsum("g,ngk->nk", _WG2, q)
        I1 = h[:, None] * np.einsum("g,ng,ngk->nk", _WG2, s, q)
        F += I0
        M[:, 1] -= I1[:, 2] - x * I0[:, 2]
        M[:, 2] += I1[:, 1] - x * I0[:, 1]
    for p in cb.puntuales:
        dentro = (p.a < x - tol) | ((np.abs(p.a - x) <= tol) & incluye)
        F[dentro] += p.P
        M[dentro, 1] -= (p.a - x[dentro]) * p.P[2]
        M[dentro, 2] += (p.a - x[dentro]) * p.P[1]
    return -F, -M


def _deformada(x, f_i, u_i, cb: CargasBarra, pr: dict, tol: float) -> tuple[np.ndarray, np.ndarray]:
    n = x.size
    u = np.zeros((n, 3))
    giros = np.zeros((n, 3))
    acumulado = np.zeros(8)  # ∫ε, ∫T/GJ, Az, Bz, Ay, By, ∫γy, ∫γz
    salida = np.zeros((n, 8))
    for k in range(n - 1):
        a, b = x[k], x[k + 1]
        h = b - a
        if h > 0.0:
            t = a + h * _XG3
            F, M = _resultantes(t, np.ones(3, dtype=bool), f_i, cb, tol)
            eps = F[:, 0] / (pr["E"] * pr["A"]) + pr["alfa"] * cb.incremento_temperatura
            kt = M[:, 0] / (pr["G"] * pr["J"])
            kz = M[:, 2] / (pr["E"] * pr["Iz"])
            ky = M[:, 1] / (pr["E"] * pr["Iy"])
            gy = F[:, 1] / (pr["G"] * pr["Asy"]) if pr["Asy"] else np.zeros(3)
            gz = F[:, 2] / (pr["G"] * pr["Asz"]) if pr["Asz"] else np.zeros(3)
            az, ay = acumulado[2], acumulado[4]
            acumulado = acumulado + h * np.array(
                [
                    _WG3 @ eps,
                    _WG3 @ kt,
                    _WG3 @ kz,
                    az + _WG3 @ ((b - t) * kz),
                    _WG3 @ ky,
                    ay + _WG3 @ ((b - t) * ky),
                    _WG3 @ gy,
                    _WG3 @ gz,
                ]
            )
        salida[k + 1] = acumulado
    e, tx, az, bz, ay, by, gy, gz = salida.T
    u[:, 0] = u_i[0] + e
    giros[:, 0] = u_i[3] + tx
    giros[:, 2] = u_i[5] + az
    u[:, 1] = u_i[1] + x * u_i[5] + bz + gy
    giros[:, 1] = u_i[4] + ay
    u[:, 2] = u_i[2] - x * u_i[4] - by + gz
    return u, giros


def estaciones(modelo: Modelo, casos: list[str] | tuple[str, ...] = (), n: int = 21) -> dict[str, np.ndarray]:
    """Abscisas (mm desde el extremo i) de cada barra, comunes a varios `casos`: `n` equiespaciadas más los bordes de
    los tramos de carga y, **dos veces**, las cargas puntuales interiores (valor a la izquierda y a la derecha;
    `diagrama` las acepta como `x`). Sirven para dibujar todos los estados de una barra sobre las mismas estaciones."""
    por_caso = [cargas_por_barra(modelo, caso) for caso in casos]
    resultado = {}
    for bid, barra in modelo.barras.items():
        largo = longitud(modelo, barra)
        cargas = [cb for c in por_caso if (cb := c.get(bid)) is not None]
        resultado[bid] = _estaciones(largo, n, cargas, 1e-9 * largo)[0]
    return resultado


def propiedades(modelo: Modelo, barra: str, deformacion_cortante: bool = True) -> dict:
    b = modelo.barras[barra]
    mat, sec = modelo.materiales[b.material], modelo.secciones[b.seccion]
    return {
        "L": longitud(modelo, b),
        "E": mat.E,
        "G": mat.modulo_cortante,
        "alfa": mat.alfa,
        "A": sec.A,
        "Iy": sec.Iy,
        "Iz": sec.Iz,
        "J": sec.J,
        "Asy": sec.Asy if deformacion_cortante else None,
        "Asz": sec.Asz if deformacion_cortante else None,
    }


def diagrama(
    modelo: Modelo, resultados: ResultadosEstaticos, barra: str, estado: str, n: int = 21, x: np.ndarray | None = None
) -> Diagrama:
    """Diagrama de esfuerzos y deformada de `barra` para un caso o una combinación lineal.

    Estaciones: `n` equiespaciadas más las abscisas de las cargas, o las abscisas `x` dadas (una abscisa repetida
    dos veces seguidas da el valor a la izquierda y a la derecha).
    """
    factores = resultados.factores(estado)
    cargas = {caso: cargas_por_barra(modelo, caso).get(barra, CargasBarra()) for caso in factores}
    return _diagrama(modelo, resultados, barra, estado, factores, cargas, n, x)


def diagramas(
    modelo: Modelo, resultados: ResultadosEstaticos, estado: str, x: Mapping[str, np.ndarray] | None = None, n: int = 21
) -> dict[str, Diagrama]:
    """`diagrama` de todas las barras de `resultados` (o solo de las de `x`, con sus abscisas) para un estado: agrupa
    las cargas de cada caso una sola vez (llamar a `diagrama` barra a barra las agrupa en cada llamada)."""
    factores = resultados.factores(estado)
    por_caso = {caso: cargas_por_barra(modelo, caso) for caso in factores}
    barras = resultados.barras if x is None else tuple(x)
    return {
        b: _diagrama(modelo, resultados, b, estado, factores, {c: por_caso[c].get(b, CargasBarra()) for c in factores}, n,
                     None if x is None else x[b])
        for b in barras
    }  # fmt: skip


def _diagrama(
    modelo: Modelo, resultados: ResultadosEstaticos, barra: str, estado: str, factores: Mapping[str, float],
    cargas: Mapping[str, CargasBarra], n: int, x: np.ndarray | None,
) -> Diagrama:  # fmt: skip
    pr = propiedades(modelo, barra, resultados.metadatos.get("deformacion_cortante", True))
    largo = pr["L"]
    tol = 1e-9 * largo
    if x is None:
        x, incluye = _estaciones(largo, n, list(cargas.values()), tol)
    else:
        x = np.asarray(x, dtype=float)
        incluye = np.ones(x.size, dtype=bool)
        incluye[:-1] = ~np.isclose(x[:-1], x[1:], rtol=0.0, atol=tol)
    ib = resultados.indice_barra(barra)
    F = np.zeros((x.size, 3))
    M = np.zeros((x.size, 3))
    u = np.zeros((x.size, 3))
    giros = np.zeros((x.size, 3))
    for caso, f in factores.items():
        ic = resultados.indice_caso(caso)
        fe = resultados.fuerzas_extremo[ic, ib]
        ue = resultados.desplazamientos_extremo[ic, ib]
        Fc, Mc = _resultantes(x, incluye, fe[:6], cargas[caso], tol)
        uc, gc = _deformada(x, fe[:6], ue[:6], cargas[caso], pr, tol)
        F += f * Fc
        M += f * Mc
        u += f * uc
        giros += f * gc
    return Diagrama(barra, estado, x, F[:, 0], F[:, 1], F[:, 2], M[:, 0], M[:, 1], M[:, 2], u, giros)
