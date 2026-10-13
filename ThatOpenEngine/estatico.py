"""Análisis estático lineal con el motor propio: todos los casos a la vez sobre una sola factorización."""
from __future__ import annotations

import time

import numpy as np
import scipy.sparse as sp

from covillaf.sim.modelo import Modelo
from covillaf.sim.resultados import ResultadosEstaticos
from covillaf.sim.solver.ensamblado import (
    apoyos,
    asentamientos_caso,
    cargas_caso,
    ensamblar,
    estabilizar,
    numerar,
    preparar_barras,
)
from covillaf.sim.solver.lineal import ErrorInestabilidad, Factorizacion, residuo_relativo
from covillaf.sim.solver.progreso import Avance, InformeProgreso

NOMBRE_SOLVER = "covillaf.sim.solver"
VERSION_SOLVER = "0.1.0"

#: Pesos nominales de las fases del estático (`progreso`): estimados en pórticos de 10³–10⁴ barras, no medidos por
#: modelo.
FASES_ESTATICO = {"barras": 15, "ensamblar": 15, "cargas": 5, "factorizar": 35, "resolver": 10, "recuperar": 20}


def resultante(puntos: np.ndarray, vector: np.ndarray) -> np.ndarray:
    """Fuerza y momento resultantes (6,) respecto al origen de un vector nodal (n_nodos·6,)."""
    v = vector.reshape(-1, 6)
    fuerza = v[:, :3].sum(axis=0)
    momento = (v[:, 3:] + np.cross(puntos, v[:, :3])).sum(axis=0)
    return np.concatenate([fuerza, momento])


def desequilibrio(puntos: np.ndarray, cargas: np.ndarray, reacciones: np.ndarray) -> float:
    """Resultante de cargas + reacciones relativa a la suma de sus módulos (fuerzas y momentos por separado).

    Robusto en casos autoequilibrados (temperatura), donde la resultante de las cargas es nula.
    """
    total = resultante(puntos, cargas + reacciones)
    escala_f = escala_m = 0.0
    for v in (cargas.reshape(-1, 6), reacciones.reshape(-1, 6)):
        escala_f += np.linalg.norm(v[:, :3], axis=1).sum()
        escala_m += np.linalg.norm(v[:, 3:], axis=1).sum() + np.linalg.norm(np.cross(puntos, v[:, :3]), axis=1).sum()
    return max(
        float(np.linalg.norm(total[:3])) / escala_f if escala_f > 0.0 else 0.0,
        float(np.linalg.norm(total[3:])) / escala_m if escala_m > 0.0 else 0.0,
    )


def analizar_estatico(
    modelo: Modelo,
    casos: list[str] | None = None,
    *,
    deformacion_cortante: bool = True,
    resolvedor: str | None = None,
    progreso: InformeProgreso | None = None,
) -> ResultadosEstaticos:
    """Resuelve K u = F para los `casos` (todos si None) y recupera reacciones y fuerzas de extremo de barra.

    `resolvedor`: «auto», «superlu» o «pardiso» (None: el del contexto, `lineal.usar_resolvedor`).
    `progreso`: ``progreso(fraccion, texto)`` al empezar cada fase y dentro de los bucles; si lanza, el análisis se
    interrumpe y la excepción sale tal cual (cancelación, `covillaf.sim.solver.progreso`).
    """
    inicio = time.perf_counter()
    avance = Avance(progreso, FASES_ESTATICO)
    avance.fase("barras", "preparar las barras")
    avisos = [str(p) for p in modelo.comprobar()]
    casos = list(modelo.casos) if casos is None else list(casos)
    faltan = [c for c in casos if c not in modelo.casos]
    if faltan:
        raise KeyError(f"casos inexistentes: {faltan}")

    num = numerar(modelo)
    n = num.n
    elementos = preparar_barras(modelo, num, deformacion_cortante, avance)
    por_id = {e.id: e for e in elementos}
    avance.fase("ensamblar", "ensamblar la rigidez")
    K = ensamblar(elementos, n, lambda e: e.rigidez_global(), avance)
    restringido, resortes = apoyos(modelo, num)
    Kt = (K + sp.diags(resortes)).tocsr()
    libres = np.flatnonzero(~restringido)

    avance.fase("cargas", "montar las cargas")
    F = np.zeros((n, len(casos)))
    U = np.zeros((n, len(casos)))  # con los asentamientos ya impuestos en los GDL restringidos
    locales: list[dict[str, np.ndarray]] = []
    for j, caso in enumerate(casos):
        avance.paso(j, len(casos))
        F[:, j], fl = cargas_caso(modelo, num, por_id, caso)
        U[:, j] = asentamientos_caso(modelo, num, caso)
        locales.append(fl)
    restringidos = np.flatnonzero(restringido)
    # Sistema reducido: K_ff u_f = F_f − K_fr u_r (u_r = asentamientos).
    F_libres = F[libres] - Kt[libres][:, restringidos] @ U[restringidos] if libres.size else F[libres]

    residuos = np.zeros(len(casos))
    pivote_minimo = 1.0
    usado, pasos = "ninguno", 0
    if libres.size:
        Kff = Kt[libres][:, libres]
        est = estabilizar(Kff, libres, num)
        avisos += est.avisos
        est.comprobar_cargas(F_libres, libres, num, casos)
        Kff_e = (Kff + est.matriz).tocsc()
        avance.fase("factorizar", f"factorizar la rigidez ({libres.size} GDL libres)")
        try:
            fact = Factorizacion(Kff_e, resolvedor=resolvedor)
        except ErrorInestabilidad as exc:
            if exc.gdl is not None:
                raise ErrorInestabilidad(f"{exc} ({num.nombre(int(libres[exc.gdl]))})", exc.gdl) from exc
            raise
        try:
            pivote_minimo = fact.pivote_minimo
            if fact.mal_condicionada:
                avisos.append(
                    f"aviso condicionamiento: pivote mínimo {fact.pivote_minimo:.2e} en "
                    f"{num.nombre(int(libres[fact.gdl_pivote_minimo]))}"
                )
            avance.fase("resolver", f"resolver {len(casos)} casos ({fact.resolvedor})")
            U[libres] = fact.resolver(F_libres)
            usado, pasos = fact.resolvedor, fact.pasos_refinamiento
        finally:
            fact.liberar()  # también si `progreso` cancela: el factor de PARDISO no espera al recolector
        residuos = residuo_relativo(Kff_e, U[libres], F_libres)

    # Reacciones: K_estructura·u − F en los GDL restringidos o con resorte (en estos, −k·u).
    avance.fase("recuperar", "recuperar reacciones y esfuerzos")
    con_reaccion = restringido | (resortes != 0.0)
    R = np.where(con_reaccion[:, None], K @ U - F, 0.0)

    puntos = np.array([modelo.nodos[nid].punto for nid in num.nodos])
    desequilibrios = np.array([desequilibrio(puntos, F[:, j], R[:, j]) for j in range(len(casos))])

    nb = len(elementos)
    fuerzas = np.zeros((len(casos), nb, 12))
    u_extremos = np.zeros((len(casos), nb, 12))
    for j in range(len(casos)):
        for k, e in enumerate(elementos):
            avance.paso(j * nb + k, len(casos) * nb)
            u_extremos[j, k], fuerzas[j, k] = e.extremos(U[e.gdl, j], locales[j].get(e.id))

    avance.fin("cálculo estático terminado")
    nodos_apoyo = tuple(a.nodo for a in modelo.apoyos.values())
    return ResultadosEstaticos(
        nodos=num.nodos,
        barras=tuple(e.id for e in elementos),
        casos=tuple(casos),
        desplazamientos=U.T.reshape(len(casos), -1, 6),
        reacciones=R.T.reshape(len(casos), -1, 6),
        fuerzas_extremo=fuerzas,
        desplazamientos_extremo=u_extremos,
        nodos_apoyo=nodos_apoyo,
        combinaciones=dict(modelo.combinaciones),
        residuos=residuos,
        desequilibrios=desequilibrios,
        avisos=tuple(avisos),
        metadatos={
            "solver": NOMBRE_SOLVER,
            "version": VERSION_SOLVER,
            "analisis": "estatico-lineal",
            "gdl": n,
            "gdl_libres": int(libres.size),
            "deformacion_cortante": deformacion_cortante,
            "pivote_minimo": pivote_minimo,
            "resolvedor": usado,
            "pasos_refinamiento": pasos,
            "segundos": time.perf_counter() - inicio,
        },
    )
