"""Progreso y cancelación del motor (`progreso=` de `analizar_estatico` y `analizar_modal`).

Lo que se promete (`covillaf.sim.solver.progreso`): fracción en [0, 1] que no retrocede y acaba en 1; texto fijo dentro de
cada fase; los mismos resultados, bit a bit, con informe o sin él; y si el informe lanza, la excepción sale tal cual en
cualquier punto y no queda ninguna factorización abierta (ni aunque la traza de la excepción siga viva).
"""
from __future__ import annotations

import gc

import numpy as np
import pytest

from covillaf.sim.modelo import Apoyo, MasaNodal, Material, Modelo, Seccion
from covillaf.sim.solver import analizar_estatico, analizar_modal
from covillaf.sim.solver import modal as modulo_modal
from covillaf.sim.solver.lineal import Factorizacion, Pardiso, pardiso_disponible
from covillaf.sim.solver.progreso import AVISOS_POR_FASE, Avance
from covillaf.sim.solver.verificacion import _viga

RESOLVEDORES = ["superlu", pytest.param("pardiso", marks=pytest.mark.skipif(not pardiso_disponible(), reason="sin MKL"))]


class Cancelado(BaseException):
    """Como `TareaCancelada` del kernel: hereda de BaseException."""


class Informe:
    def __init__(self, cancelar_en: int | None = None) -> None:
        self.avisos: list[tuple[float, str]] = []
        self.cancelar_en = cancelar_en

    def __call__(self, fraccion: float, texto: str) -> None:
        self.avisos.append((fraccion, texto))
        if self.cancelar_en is not None and len(self.avisos) > self.cancelar_en:
            raise Cancelado()


def _factorizaciones_abiertas() -> list[str]:
    """Factorizaciones **alcanzables** con el factor vivo (la basura se recoge antes: solo cuenta lo retenido)."""
    gc.collect()
    abiertas = []
    for objeto in gc.get_objects():
        if isinstance(objeto, Pardiso) and objeto._final.alive:
            abiertas.append("pardiso")
        elif isinstance(objeto, Factorizacion) and objeto.resolvedor == "superlu" and getattr(objeto, "_lu", None) is not None:
            abiertas.append("superlu")
    return abiertas


def _comprobar_avisos(avisos: list[tuple[float, str]], n_fases: int) -> None:
    fracciones = [f for f, _ in avisos]
    assert all(0.0 <= f <= 1.0 for f in fracciones)
    assert all(b >= a for a, b in zip(fracciones, fracciones[1:], strict=False)), "la fracción retrocede"
    assert fracciones[-1] == 1.0
    # El texto no cambia dentro de una fase: cada texto aparece en un solo tramo seguido.
    tramos = [t for k, (_, t) in enumerate(avisos) if k == 0 or t != avisos[k - 1][1]]
    assert len(tramos) == len(set(tramos)) and len(tramos) <= n_fases + 1


def _puntos_de_corte(n: int, muestras: int = 25) -> list[int]:
    return sorted({int(round(x)) for x in np.linspace(0, n - 1, min(n, muestras))})


def test_avance_reparte_y_regula() -> None:
    vistos: list[tuple[float, str]] = []
    a = Avance(lambda f, t: vistos.append((f, t)), {"a": 1, "b": 3})
    a.fase("a", "fase a")
    for k in range(10_000):
        a.paso(k, 10_000)
    a.fase("b", "fase b")
    a.pulso()
    a.fin("fin")
    assert vistos[0] == (0.0, "fase a")
    assert len(vistos) <= AVISOS_POR_FASE + 4
    assert (0.25, "fase b") in vistos and vistos[-1] == (1.0, "fin")
    with pytest.raises(ValueError):
        Avance(None, {"a": -1})


@pytest.mark.parametrize("resolvedor", RESOLVEDORES)
def test_estatico_informa_y_da_lo_mismo(porticos, resolvedor) -> None:
    m = porticos.nave(vanos_x=3, vanos_y=2, niveles=3, complicada=True)
    informe = Informe()
    con = analizar_estatico(m, resolvedor=resolvedor, progreso=informe)
    sin = analizar_estatico(m, resolvedor=resolvedor)
    _comprobar_avisos(informe.avisos, 6)
    assert len(informe.avisos) > 20  # también dentro de los bucles, no solo al cambiar de fase
    for campo in ("desplazamientos", "reacciones", "fuerzas_extremo"):
        assert np.array_equal(getattr(con, campo), getattr(sin, campo)), campo


@pytest.mark.parametrize("resolvedor", RESOLVEDORES)
def test_estatico_se_cancela_en_cualquier_punto_y_libera(porticos, resolvedor) -> None:
    m = porticos.nave(vanos_x=3, vanos_y=2, niveles=3, complicada=True)
    total = Informe()
    analizar_estatico(m, resolvedor=resolvedor, progreso=total)
    for corte in _puntos_de_corte(len(total.avisos)):
        with pytest.raises(Cancelado) as info:
            analizar_estatico(m, resolvedor=resolvedor, progreso=Informe(corte))
        assert info.value.__traceback__ is not None  # la traza (con los marcos del motor) sigue viva…
        assert _factorizaciones_abiertas() == [], f"factorización abierta al cancelar en el aviso {corte}"  # …y nada abierto


def _modal_por_camino(porticos, monkeypatch, camino: str):
    """Modelo y opciones que llevan `analizar_modal` por el camino pedido."""
    if camino == "reduccion":  # como en test_modal: viga sin masa propia con tres masas nodales
        m = Modelo()
        m.agregar(Material("acero", 2e5, 0.3, rho=0.0), Seccion("s", 5000.0, 8e7, 2e7, 5e5))
        nodos = _viga(m, 6000.0, 40)
        m.agregar(Apoyo.empotrado(nodos[0]), Apoyo.empotrado(nodos[-1]))
        for nid in (nodos[10], nodos[20], nodos[30]):
            m.agregar(MasaNodal(nid, 0.5))
        monkeypatch.setattr(modulo_modal, "LIMITE_DENSO", 100)
        return m, {}
    m = porticos.nave(vanos_x=3, vanos_y=2, niveles=3, complicada=True)
    monkeypatch.setattr(modulo_modal, "LIMITE_DENSO", 10**9 if camino == "denso" else 0)
    return m, {}


@pytest.mark.parametrize("camino,metodo", [("denso", "denso"), ("reduccion", "reducción"), ("lanczos", "Lanczos")])
@pytest.mark.parametrize("resolvedor", RESOLVEDORES)
def test_modal_informa_y_da_lo_mismo(porticos, monkeypatch, camino, metodo, resolvedor) -> None:
    m, opciones = _modal_por_camino(porticos, monkeypatch, camino)
    informe = Informe()
    con = analizar_modal(m, 8, resolvedor=resolvedor, progreso=informe, **opciones)
    sin = analizar_modal(m, 8, resolvedor=resolvedor, **opciones)
    assert metodo in con.metadatos["metodo"]
    _comprobar_avisos(informe.avisos, len(modulo_modal.FASES_MODAL))
    assert np.array_equal(con.valores_propios, sin.valores_propios)
    assert np.array_equal(con.formas, sin.formas)
    assert con.sturm.valido and sin.sturm.valido
    if camino == "lanczos":
        assert any("Lanczos" in t for _, t in informe.avisos)


@pytest.mark.parametrize("camino", ["denso", "reduccion", "lanczos"])
@pytest.mark.parametrize("resolvedor", RESOLVEDORES)
def test_modal_se_cancela_en_cualquier_punto_y_libera(porticos, monkeypatch, camino, resolvedor) -> None:
    m, opciones = _modal_por_camino(porticos, monkeypatch, camino)
    total = Informe()
    analizar_modal(m, 8, resolvedor=resolvedor, progreso=total, **opciones)
    for corte in _puntos_de_corte(len(total.avisos)):
        with pytest.raises(Cancelado) as info:
            analizar_modal(m, 8, resolvedor=resolvedor, progreso=Informe(corte), **opciones)
        assert info.value.__traceback__ is not None
        assert _factorizaciones_abiertas() == [], f"factorización abierta al cancelar en el aviso {corte}"


def test_sin_informe_no_hay_factorizaciones_abiertas(porticos, monkeypatch) -> None:
    """Al terminar bien tampoco queda nada abierto (antes el factor esperaba al recolector)."""
    m, _ = _modal_por_camino(porticos, monkeypatch, "lanczos")
    r = analizar_modal(m, 8)
    e = analizar_estatico(m)
    assert r.n_modos == 8 and e.casos
    assert _factorizaciones_abiertas() == []
