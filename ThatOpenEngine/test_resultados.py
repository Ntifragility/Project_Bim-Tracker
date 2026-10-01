"""Capa de resultados del kernel: geometría analítica, campos por estación (`campos`), tramas VYBF (`vybf`) y métodos
``resultados.*`` por RPC, con el PR-01 sintético.

Tolerancias fijadas antes de ejecutar (referencias independientes del código que se prueba):
- Deformada estática en los extremos = desplazamientos de extremo del motor (`desplazamientos_extremo`, locales)
  girados a globales: ≤ 1e-9 × máx |u| (la integración de `diagramas` es exacta).
- Esfuerzos en los extremos = fuerzas de extremo del motor (x = 0: −f_i; x = L: f_j): ≤ 1e-9 × máx |f|.
- Forma modal en los extremos de barras sin desfase = traslaciones nodales del modo: ≤ 1e-12 × máx |φ|.
- Interpolación de `forma_modal` aplicada a un estado estático en barras sin carga de tramo = deformada exacta de
  `diagramas`: ≤ 1e-9 × máx |u| (las funciones de forma son exactas sin carga de tramo).
- Valores recibidos por RPC (float32) frente a los de `campos` (doble): ≤ 1e-6 × máx |valor|.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import numpy as np
import pytest
from ayudas_sim_kernel import asincrona, conectar, servidor_en_marcha

from covillaf.sim.io import leer_vybs
from covillaf.sim.modelo import cargas_por_barra
from covillaf.sim.solver import analizar_estatico, analizar_modal
from covillaf_sim_kernel import campos, vybf

PLAZO = 60.0


@pytest.fixture(scope="module")
def pr01(archivos):
    m = leer_vybs(archivos.vybs_pr01).modelo
    return SimpleNamespace(modelo=m, g=campos.geometria(m), e=analizar_estatico(m), md=analizar_modal(m, 6))


def test_geometria(pr01):
    g, m = pr01.g, pr01.modelo
    assert (len(g.nodos), len(g.barras), len(g.apoyos)) == (len(m.nodos), len(m.barras), len(m.apoyos))
    assert g.revision == int(g.huella[:8], 16) and g.n_estaciones == sum(e.size for e in g.estaciones)
    assert all(e[0] == 0.0 and np.isclose(e[-1], np.linalg.norm(x[1] - x[0])) for e, x in zip(g.estaciones, g.extremos, strict=True))
    assert all(np.all(np.diff(e) >= 0.0) for e in g.estaciones)
    j = g.como_json()
    assert j["revision"] == g.revision and len(j["barras"]) == len(g.barras) and j["unidad"] == "mm"
    assert campos.geometria(m).huella == g.huella  # determinista


def test_deformada_y_esfuerzos_en_los_extremos(pr01):
    g, r = pr01.g, pr01.e
    for estado in (*r.casos, *(k for k, c in r.combinaciones.items() if c.tipo == "lineal")):
        deformada, esfuerzos = campos.estado_estatico(pr01.modelo, g, r, estado)
        e = r.estado(estado)
        u_max = np.abs(e.desplazamientos[:, :3]).max()
        f_max = np.abs(e.fuerzas_extremo).max()
        for k in range(len(g.barras)):
            ue, fe, R = e.desplazamientos_extremo[k], e.fuerzas_extremo[k], g.ejes[k]
            ini, fin = g.inicio[k], g.inicio[k + 1] - 1
            np.testing.assert_allclose(deformada[ini], ue[0:3] @ R, rtol=0, atol=1e-9 * u_max)
            np.testing.assert_allclose(deformada[fin], ue[6:9] @ R, rtol=0, atol=1e-9 * u_max)
            np.testing.assert_allclose(esfuerzos[ini], -fe[0:6], rtol=0, atol=1e-9 * f_max)
            np.testing.assert_allclose(esfuerzos[fin], fe[6:12], rtol=0, atol=1e-9 * f_max)


def test_forma_modal_en_los_nudos(pr01):
    g, md, m = pr01.g, pr01.md, pr01.modelo
    sin_desfase = [k for k, b in enumerate(m.barras.values()) if not any(b.desfase_i) and not any(b.desfase_j)]
    assert sin_desfase
    for modo in range(md.n_modos):
        forma = campos.forma_modal(m, g, md, modo)
        phi = md.formas[modo]
        escala = np.abs(phi[:, :3]).max()
        for k in sin_desfase:
            i, j = g.nudos_barra[k]
            np.testing.assert_allclose(forma[g.inicio[k]], phi[i, :3], rtol=0, atol=1e-12 * escala)
            np.testing.assert_allclose(forma[g.inicio[k + 1] - 1], phi[j, :3], rtol=0, atol=1e-12 * escala)


def test_interpolacion_exacta_sin_carga_de_tramo(pr01):
    """La interpolación de `forma_modal` con los desplazamientos nodales de un estado estático reproduce la deformada
    exacta de las barras sin carga de tramo en ese estado: valida las funciones de forma, desfases y liberaciones."""
    g, r, m = pr01.g, pr01.e, pr01.modelo
    comprobadas = 0
    for caso in r.casos:
        exacta, _ = campos.estado_estatico(m, g, r, caso)
        falso = SimpleNamespace(nodos=r.nodos, n_modos=1, formas=r.desplazamientos[[r.indice_caso(caso)]])
        interpolada = campos.forma_modal(m, g, falso, 0, r.metadatos["deformacion_cortante"])
        cargadas = set(cargas_por_barra(m, caso))
        libres = [k for k, b in enumerate(g.barras) if b not in cargadas]
        u_max = np.abs(exacta).max()
        for k in libres:
            tramo = slice(g.inicio[k], g.inicio[k + 1])
            np.testing.assert_allclose(interpolada[tramo], exacta[tramo], rtol=0, atol=1e-9 * u_max, err_msg=f"{caso} {g.barras[k]}")
        assert libres or m.casos[caso].peso_propio  # con peso propio todas las barras llevan carga de tramo
        comprobadas += len(libres)
    assert comprobadas > 0


# --- VYBF ------------------------------------------------------------------------------------------------------------

GUID = "2Pc61mKOzJ4uF_OilAct2b"


def test_vybf_ida_y_vuelta():
    v = np.random.default_rng(1).standard_normal((2, 5, 6)) * 1e6
    t = vybf.decodificar(vybf.codificar(7, GUID, 123, vybf.ESTACION, vybf.ESFUERZOS, v, [0.5, 1.5]))
    assert (t.lote, t.guid, t.referencia, t.ubicacion, t.magnitud, t.unidad) == (7, GUID, 123, 3, 16, "N;N.mm")
    np.testing.assert_array_equal(t.valores, v.astype(np.float32))
    np.testing.assert_array_equal(t.valores_paso, [0.5, 1.5])
    np.testing.assert_array_equal(t.rango[..., 0], v.astype(np.float32).min(axis=1))


def _cabecera(datos: bytes, desplazamiento: int, formato: str, valor) -> bytes:
    import struct

    b = bytearray(datos)
    struct.pack_into(formato, b, desplazamiento, valor)
    return bytes(b)


@pytest.mark.parametrize(
    ("cambio", "mensaje"),
    [
        (lambda d: b"VYBR" + d[4:], "no es VYBF"),
        (lambda d: _cabecera(d, 4, "<H", 2), "no es VYBF"),
        (lambda d: _cabecera(d, 6, "<H", 1 | 2), "banderas"),
        (lambda d: _cabecera(d, 6, "<H", 1 | 8), "banderas"),
        (lambda d: _cabecera(d, 6, "<H", 0), "rango"),
        (lambda d: _cabecera(d, 8, "<I", 0), "lote 0"),
        (lambda d: _cabecera(d, 34, "<H", 1), "relleno"),
        (lambda d: d[:12] + b"#" + d[13:], "alfabeto"),
        (lambda d: _cabecera(d, 40, "<B", 9), "ubicación"),
        (lambda d: _cabecera(d, 42, "<H", 99), "magnitud"),
        (lambda d: _cabecera(d, 41, "<B", 1), "componentes"),
        (lambda d: d[:56] + b"MPa\0\0\0\0\0" + d[64:], "unidad"),
        (lambda d: _cabecera(d, 48, "<I", 0), "n_pasos"),
        (lambda d: _cabecera(d, 52, "<I", 1), "reservado"),
        (lambda d: d[:-4], "longitud"),
        (lambda d: d + b"\0\0\0\0", "longitud"),
        (lambda d: d[:-4] + np.float32(np.nan).tobytes(), "no finitos"),
        (lambda d: d[:64] + np.array([5.0, 1.0] * 3, "<f4").tobytes() + d[88:], "mínimo mayor"),
    ],
)
def test_vybf_rechazos(cambio, mensaje):
    buena = vybf.codificar(1, GUID, 0, vybf.ESTACION, vybf.DESPLAZAMIENTO, np.arange(12.0).reshape(4, 3))
    vybf.decodificar(buena)
    with pytest.raises(vybf.ErrorVybf, match=mensaje):
        vybf.decodificar(cambio(buena))


def test_vybf_no_codifica_valores_no_finitos_ni_formas_malas():
    with pytest.raises(vybf.ErrorVybf):
        vybf.codificar(1, GUID, 0, vybf.ESTACION, vybf.DESPLAZAMIENTO, np.array([[np.inf, 0, 0]]))
    with pytest.raises(vybf.ErrorVybf):
        vybf.codificar(1, GUID, 0, vybf.ESTACION, vybf.DESPLAZAMIENTO, np.zeros((3, 6)))
    with pytest.raises(vybf.ErrorVybf):
        vybf.codificar(1, "corto", 0, vybf.ESTACION, vybf.DESPLAZAMIENTO, np.zeros((3, 3)))


# --- RPC ---------------------------------------------------------------------------------------------------------------


async def _campo(c, params):
    """Respuesta de ``resultados.campo`` y la trama binaria que llega **detrás**."""
    r = await c.solicitar("resultados.campo", params, plazo=PLAZO)
    assert "result" in r, r
    datos = await c.recibir(PLAZO)
    assert isinstance(datos, bytes)
    return r["result"], vybf.decodificar(datos)


@asincrona()
async def test_resultados_por_rpc(archivos, pr01):
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        r = await c.solicitar("resultados.geometria")
        assert r["error"]["code"] == -32002 and r["error"]["data"]["clave"] == "sin_modelo"
        await c.comando("modelo.abrir_vybs", {"ruta": str(archivos.vybs_pr01)})
        geo = (await c.solicitar("resultados.geometria"))["result"]
        assert geo["revision"] == pr01.g.revision and geo["estados"] == {"estatico": None, "modal": None}
        sin = await c.solicitar("resultados.campo", {"tipo": "estatico", "magnitud": "desplazamiento", "estado": "D"})
        assert sin["error"]["data"]["clave"] == "sin_resultados"

        await c.tarea("analisis.estatico", plazo=PLAZO)
        await c.tarea("analisis.modal", {"n_modos": 6}, plazo=PLAZO)
        geo = (await c.solicitar("resultados.geometria"))["result"]
        assert geo["estados"]["estatico"]["casos"] == list(pr01.e.casos) and len(geo["estados"]["modal"]["modos"]) == 6

        for magnitud, indice in (("desplazamiento", 0), ("esfuerzos", 1)):
            meta, trama = await _campo(c, {"tipo": "estatico", "magnitud": magnitud, "estado": "D"})
            esperado = campos.estado_estatico(pr01.modelo, pr01.g, pr01.e, "D")[indice]
            assert trama.lote == meta["lote"] and trama.referencia == meta["revision"] == pr01.g.revision
            assert trama.guid == meta["guid"] and trama.ubicacion == vybf.ESTACION and meta["n_valores"] == pr01.g.n_estaciones
            np.testing.assert_allclose(trama.valores[0], esperado, rtol=0, atol=1e-6 * np.abs(esperado).max())
            maximos = meta["maximo"] if isinstance(meta["maximo"], list) else [meta["maximo"]]
            assert len(maximos) == (6 if magnitud == "esfuerzos" else 1) and all(m["barra"] in pr01.g.barras for m in maximos)
            for k, m in enumerate(maximos):  # el máximo es el de |valor| de su componente (o de la norma)
                ref = np.abs(esperado[:, k]).max() if magnitud == "esfuerzos" else np.linalg.norm(esperado, axis=1).max()
                assert abs(m["valor"] - ref) <= 1e-12 * max(ref, 1.0)

        meta, trama = await _campo(c, {"tipo": "modal", "magnitud": "forma", "modo": 2})
        np.testing.assert_allclose(trama.valores_paso, [pr01.md.frecuencias[1]], rtol=1e-12)
        esperado = campos.forma_modal(pr01.modelo, pr01.g, pr01.md, 1)
        np.testing.assert_allclose(trama.valores[0], esperado, rtol=0, atol=1e-6 * np.abs(esperado).max())

        errores = {
            "estado_inexistente": {"tipo": "estatico", "magnitud": "desplazamiento", "estado": "NO"},
            "modo_inexistente": {"tipo": "modal", "magnitud": "forma", "modo": 7},
            "parametros": {"tipo": "modal", "magnitud": "esfuerzos", "modo": 1},
        }
        for clave, params in errores.items():
            r = await c.solicitar("resultados.campo", params)
            assert r["error"]["code"] == -32002 and r["error"]["data"]["clave"] == clave, r

        reacciones = (await c.solicitar("resultados.tabla", {"tabla": "reacciones", "estado": "D"}))["result"]
        assert len(reacciones["filas"]) == len(pr01.modelo.apoyos) and [x["id"] for x in reacciones["columnas"]][:2] == ["nodo", "Fx"]
        total = np.sum([f[1:4] for f in reacciones["filas"]], axis=0)
        np.testing.assert_allclose(total, pr01.e.estado("D").reacciones[:, :3].sum(axis=0), rtol=1e-12)
        modos = (await c.solicitar("resultados.tabla", {"tabla": "modos"}))["result"]
        assert len(modos["filas"]) == 6 and modos["filas"][0][0] == 1
        esf = (await c.solicitar("resultados.tabla", {"tabla": "esfuerzos", "estado": "D"}))["result"]
        assert len(esf["filas"]) == 2 * len(pr01.modelo.barras)
        desp = (await c.solicitar("resultados.tabla", {"tabla": "desplazamientos", "estado": "D"}))["result"]
        assert len(desp["filas"]) == len(pr01.modelo.nodos)

        # otro modelo: los resultados quedan desactualizados y ya no se sirven
        await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_pr01)})
        r = await c.solicitar("resultados.campo", {"tipo": "modal", "magnitud": "forma", "modo": 1})
        assert r["error"]["data"]["clave"] == "sin_resultados" and "desactualizados" in r["error"]["data"]["detalle"]
        assert (await c.solicitar("resultados.geometria"))["result"]["estados"] == {"estatico": None, "modal": None}


@asincrona()
async def test_ping_responde_mientras_se_calcula_un_campo(archivos):
    """El campo se calcula en un hilo: el bucle sigue atendiendo."""
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c, conectar(puerto) as otro:
        await c.comando("modelo.abrir_vybs", {"ruta": str(archivos.vybs_pr01)})
        await c.tarea("analisis.estatico", plazo=PLAZO)
        pedido = asyncio.create_task(_campo(c, {"tipo": "estatico", "magnitud": "esfuerzos", "estado": "D"}))
        assert (await otro.solicitar("sistema.ping", {"eco": 1}))["result"]["eco"] == 1
        meta, _ = await pedido
        assert meta["componentes"] == 6
