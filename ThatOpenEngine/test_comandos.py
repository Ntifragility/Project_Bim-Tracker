"""Comandos y tareas de SIMULATE por RPC (servidor en proceso) con archivos sintéticos: ``.vyba`` del PR-01 y del
pórtico de DESIGN escritos con el exportador de DESIGN, ``.vybs`` del PR-01 con sus cargas.

Tolerancias fijadas antes de ejecutar: el kernel llama al mismo motor con el mismo modelo que la referencia directa
(`analizar_estatico`/`analizar_modal` sobre `leer_vybs`), así que se exige igualdad a redondeo: desplazamientos y
reacciones ≤ 1e-12 relativo al máximo, frecuencias ≤ 1e-12 relativo."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
import zipfile

import numpy as np
import pytest
from ayudas_sim_kernel import asincrona, con_modelo_en_memoria, conectar, rejilla, servidor_en_marcha

from covillaf.sim.io import leer_vybres, leer_vybs
from covillaf.sim.solver import analizar_estatico, analizar_modal
from covillaf.sim.solver.lineal import pardiso_disponible, usar_resolvedor
from covillaf_sim_kernel.kernel import crear_kernel

VACIOS = {"anadidos": [], "modificados": [], "borrados": []}
PLAZO = 30.0


# --- modelo.* --------------------------------------------------------------------------------------------------------


@asincrona()
async def test_importar_vyba_resumen_deshacer_y_rehacer(archivos):
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        r = await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_pr01)})
        guid = r["resultado"]["guid"]
        assert r["cambios"] == {"anadidos": [guid], "modificados": [], "borrados": []} and r["transaccion"]
        (aviso,) = c.notificaciones("modelo.cambios")  # llegó antes que la respuesta
        assert aviso["params"] == {"transaccion": r["transaccion"], "anadidos": [guid], "modificados": [], "borrados": [], "modificado": True}
        res = r["resultado"]
        # A1 (F0-32): el PR-01 leído del .vyba tiene 36 nodos y 64 barras; el .vyba no trae cargas
        assert (res["nodos"], res["barras"], res["casos"], res["origen"]["formato"], res["origen"]["ruta"]) == (36, 64, [], "vyba", "pr01a.vyba")
        assert res["derivacion"]["trazas"] == 64 and res["derivacion"]["opciones"]["unir_cruces"] is False
        assert all(not c_["unido"] for c_ in res["derivacion"]["cruces"])  # diagonales sin unión en el cruce
        assert isinstance(res["avisos"], list) and res["problemas"] == []

        resumen = (await c.comando("modelo.resumen"))["resultado"]
        assert resumen["cargado"] is True and resumen["modificado"] is True and resumen["guid"] == guid
        assert resumen["archivo"] is None and resumen["resultados"] == {}

        # otra importación con opciones: sustituye el documento (se puede deshacer)
        r2 = await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_pr01), "opciones": {"unir_cruces": True, "tol_nodo": 2.0}})
        guid2 = r2["resultado"]["guid"]
        assert r2["cambios"] == {"anadidos": [guid2], "modificados": [], "borrados": [guid]}
        assert any(c_["unido"] for c_ in r2["resultado"]["derivacion"]["cruces"]) and r2["resultado"]["nodos"] > 36

        d = (await c.solicitar("transaccion.deshacer"))["result"]
        assert d == {"transaccion": r2["transaccion"], "cambios": {"anadidos": [guid], "modificados": [], "borrados": [guid2]}}
        assert (await c.comando("modelo.resumen"))["resultado"]["guid"] == guid
        h = (await c.solicitar("transaccion.rehacer"))["result"]
        assert h["cambios"]["anadidos"] == [guid2]


@asincrona()
async def test_importar_el_portico_de_design_con_materiales_y_liberaciones(archivos):
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        base = (await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_portico)}))["resultado"]
        assert (base["nodos"], base["barras"], base["apoyos"]) == (8, 10, 4)  # pórtico de DESIGN (A-1 del informe 03)
        opciones = {
            "excentricidades": "ignorar",
            "materiales": {"S275": {"E": 210000.0, "nu": 0.3, "rho": 7.85e-9, "fuente": "prueba"}},
            "condiciones": {"covillaf.placa_base": {"tipo": "apoyo", "restricciones": [True, True, True, False, False, False]}},
        }
        r = (await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_portico), "nombre": "Pórtico", "opciones": opciones}))["resultado"]
        assert r["nombre"] == "Pórtico" and r["derivacion"]["opciones"]["excentricidades"] == "ignorar"


@pytest.mark.parametrize(
    ("args", "codigo", "clave"),
    [
        ({"ruta": "{abs}no_existe.vyba"}, -32002, "no_existe"),
        ({"ruta": "{abs}modelo.ifc"}, -32002, "extension"),
        ({"ruta": "no_existe.vyba"}, -32002, "ruta_relativa"),  # dependería de la carpeta desde la que se lanzó
        ({"ruta": r"\\equipo\recurso\x.vyba"}, -32002, "ruta_red"),
        ({"ruta": "//equipo/recurso/x.vyba"}, -32002, "ruta_red"),
        ({"ruta": "{abs}x\u0007.vyba"}, -32002, "ruta_invalida"),
        ({"ruta": "{abs}NUL.vyba"}, -32002, "ruta_invalida"),
        ({"ruta": "x.vyba", "opciones": {"tol_nodo": 0}}, -32602, None),
        ({"ruta": "x.vyba", "opciones": {"liberaciones": {"no-es-un-guid": {"i": ["rx"]}}}}, -32602, None),
        ({"ruta": "x.vyba", "opciones": {"materiales": {"S275": {"E": 210000.0}}}}, -32602, None),
        ({}, -32602, None),
    ],
)
@asincrona()
async def test_errores_de_importar(args, codigo, clave, archivos, tmp_path):
    if "ruta" in args:
        args = {**args, "ruta": args["ruta"].replace("{abs}", f"{tmp_path}{os.sep}")}
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        r = await c.solicitar("comando.ejecutar", {"nombre": "modelo.importar_vyba", "args": args})
        assert r["error"]["code"] == codigo and r["error"]["data"]["comando"] == "modelo.importar_vyba"
        if clave is not None:
            assert r["error"]["data"]["clave"] == clave
        else:
            assert r["error"]["data"]["errores"]
        assert c.notificaciones("modelo.cambios") == []  # nada cambió


@asincrona()
async def test_importar_un_vyba_dañado_da_clave_lectura(archivos, tmp_path):
    roto = tmp_path / "roto.vyba"
    roto.write_bytes(b"esto no es un zip")
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        r = await c.solicitar("comando.ejecutar", {"nombre": "modelo.importar_vyba", "args": {"ruta": str(roto)}})
        assert r["error"]["code"] == -32002 and r["error"]["data"]["clave"] == "lectura"


@asincrona()
async def test_abrir_y_guardar_vybs(archivos, tmp_path):
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        sin = await c.solicitar("comando.ejecutar", {"nombre": "modelo.guardar_vybs", "args": {}})
        assert sin["error"]["data"]["clave"] == "sin_modelo"
        await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_pr01)})
        c.otros.clear()
        r = await c.comando("modelo.abrir_vybs", {"ruta": str(archivos.vybs_derivado)})
        leido = leer_vybs(archivos.vybs_derivado)
        assert r["transaccion"] is None and r["resultado"]["guid"] == leido.contenedor.manifest["guid"]
        assert r["resultado"]["hash_contenido"] == leido.hash_contenido and r["resultado"]["modificado"] is False
        assert r["resultado"]["casos"] == ["D", "Po", "Tf", "Wy", "Ex", "Ey", "T"] and r["resultado"]["origen"]["formato"] == "vyba"
        (aviso,) = c.notificaciones("modelo.cambios")
        assert aviso["params"]["reemplazado"] is True and aviso["params"]["modificado"] is False and aviso["params"]["transaccion"] is None
        assert (await c.solicitar("transaccion.deshacer"))["result"]["transaccion"] is None  # abrir vacía deshacer

        resumen = (await c.comando("modelo.resumen"))["resultado"]
        assert resumen["modificado"] is False and resumen["archivo"]["al_dia"] is True

        # guardar sin cambios en otro sitio: mismo hash_contenido (copias físicas y enlaces reconstruidos al abrir)
        copia = tmp_path / "copia.vybs"
        g = await c.comando("modelo.guardar_vybs", {"ruta": str(copia)})
        assert g["transaccion"] is None and g["cambios"] == VACIOS
        assert g["resultado"]["hash_contenido"] == leido.hash_contenido and copia.is_file()
        assert leer_vybs(copia).hash_contenido == leido.hash_contenido
        # sin ruta: en la actual
        g2 = await c.comando("modelo.guardar_vybs", {"nombre": "Otro nombre"})
        assert g2["resultado"]["ruta"] == str(copia.resolve()) and leer_vybs(copia).contenedor.manifest["nombre"] == "Otro nombre"

        mala = await c.solicitar("comando.ejecutar", {"nombre": "modelo.guardar_vybs", "args": {"ruta": str(tmp_path / "no" / "x.vybs")}})
        assert mala["error"]["data"]["clave"] == "carpeta_inexistente"
        mala = await c.solicitar("comando.ejecutar", {"nombre": "modelo.abrir_vybs", "args": {"ruta": str(archivos.vyba_pr01)}})
        assert mala["error"]["data"]["clave"] == "extension"


@asincrona()
async def test_importar_y_guardar_dejan_modificado_en_false(archivos, tmp_path):
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_pr01)})
        assert (await c.comando("modelo.resumen"))["resultado"]["modificado"] is True
        ruta = tmp_path / "importado.vybs"
        g = (await c.comando("modelo.guardar_vybs", {"ruta": str(ruta)}))["resultado"]
        resumen = (await c.comando("modelo.resumen"))["resultado"]
        assert resumen["modificado"] is False and resumen["archivo"]["hash_contenido"] == g["hash_contenido"]
        leido = leer_vybs(ruta)
        assert leido.enlaces["documentos"][0]["formato"] == "vyba" and len(leido.modelo.barras) == 64


def _version_mas_nueva(origen, destino) -> None:
    """Copia de un .vybs con ``version_formato`` 0.2.0 (minor más nuevo ⇒ se abre en solo lectura)."""
    with zipfile.ZipFile(origen) as zo, zipfile.ZipFile(destino, "w") as zd:
        for info in zo.infolist():
            datos = zo.read(info)
            if info.filename == "manifest.json":
                manifest = json.loads(datos)
                manifest["version_formato"] = "0.2.0"
                datos = json.dumps(manifest).encode("utf-8")
            zd.writestr(info, datos)


@asincrona()
async def test_un_vybs_mas_nuevo_no_se_reescribe_aunque_cambie_el_modelo(archivos, tmp_path):
    """Regresión ALTA-1 (auditoría del kernel): la protección va por ruta, no por el documento abierto."""
    nuevo = tmp_path / "nuevo.vybs"
    _version_mas_nueva(archivos.vybs_derivado, nuevo)
    antes = nuevo.read_bytes()
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        assert (await c.comando("modelo.abrir_vybs", {"ruta": str(nuevo)}))["resultado"]["solo_lectura"] is True
        await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_pr01)})  # otro documento
        for args in ({}, {"ruta": str(nuevo)}):
            r = await c.solicitar("comando.ejecutar", {"nombre": "modelo.guardar_vybs", "args": args})
            assert r["error"]["data"]["clave"] == "solo_lectura", r
        assert (await c.comando("modelo.guardar_vybs", {"ruta": str(tmp_path / "otro.vybs")}))["resultado"]["modificado"] is False
    assert nuevo.read_bytes() == antes


@asincrona()
async def test_volver_a_guardar_conserva_creado(archivos, tmp_path):
    """BAJA-1 de la auditoría: el mismo documento guardado otra vez conserva ``creado`` y sella ``modificado``."""
    ruta = tmp_path / "sellos.vybs"
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_pr01)})
        await c.comando("modelo.guardar_vybs", {"ruta": str(ruta), "autor": "Primera"})
        primero = leer_vybs(ruta).contenedor.manifest
        assert primero["creado"]["autor"] == "Primera" and primero["modificado"] == primero["creado"]
        await c.comando("modelo.abrir_vybs", {"ruta": str(ruta)})
        await c.comando("modelo.guardar_vybs", {"autor": "Segunda"})
        segundo = leer_vybs(ruta).contenedor.manifest
    assert segundo["creado"] == primero["creado"] and segundo["modificado"]["autor"] == "Segunda"
    assert segundo["guid"] == primero["guid"] and segundo["hash_contenido"] == primero["hash_contenido"]


# --- tareas de análisis --------------------------------------------------------------------------------------------


@asincrona()
async def test_estatico_y_modal_por_rpc_iguales_al_motor_directo(archivos):
    ref = leer_vybs(archivos.vybs_pr01).modelo
    e0, m0 = analizar_estatico(ref), analizar_modal(ref, 6)
    async with servidor_en_marcha() as (_, puerto, kernel), conectar(puerto) as c:
        await c.comando("modelo.abrir_vybs", {"ruta": str(archivos.vybs_pr01)})
        id_e, fin = await c.tarea("analisis.estatico")
        assert fin["estado"] == "terminada", fin
        progreso = [n["params"]["texto"] for n in c.notificaciones("tarea.progreso", id_e)]
        fases = [t for k, t in enumerate(progreso) if k == 0 or t != progreso[k - 1]]  # los avisos del motor, por fase
        assert fases == ["preparar el análisis estático", "preparar las barras", "ensamblar la rigidez", "montar las cargas",
                         "factorizar la rigidez (144 GDL libres)", f"resolver {len(e0.casos)} casos (superlu)", "recuperar reacciones y esfuerzos",
                         "cálculo estático terminado", "resumir los resultados", "análisis estático terminado"], fases  # fmt: skip
        intermedio = [n["params"]["fraccion"] for n in c.notificaciones("tarea.progreso", id_e)]
        assert intermedio[0] == 0.0 and intermedio[-2:] == [0.95, 1.0] and None not in intermedio
        assert all(b >= a for a, b in zip(intermedio, intermedio[1:], strict=False))
        res = fin["resultado"]
        assert [x["caso"] for x in res["casos"]] == list(e0.casos) and res["metadatos"]["resolvedor"] == "superlu"
        assert all(x["residuo"] <= 1e-10 and x["desequilibrio"] <= 1e-10 for x in res["casos"])
        r1 = kernel.estado.resultado("estatico").resultados
        np.testing.assert_allclose(r1.desplazamientos, e0.desplazamientos, rtol=0, atol=1e-12 * np.abs(e0.desplazamientos).max())
        np.testing.assert_allclose(r1.reacciones, e0.reacciones, rtol=0, atol=1e-12 * np.abs(e0.reacciones).max())
        k = int(np.argmax(np.linalg.norm(e0.desplazamientos[0][:, :3], axis=1)))
        assert res["casos"][0]["desplazamiento_maximo"]["nodo"] == e0.nodos[k]

        id_m, fin = await c.tarea("analisis.modal", {"n_modos": 6, "masa": "consistente"})
        assert fin["estado"] == "terminada", fin
        mod = fin["resultado"]
        np.testing.assert_allclose(mod["frecuencias"], m0.frecuencias, rtol=1e-12)
        assert mod["certificado"] is True and mod["sturm"]["perdidos"] == 0 and mod["n_modos"] == 6
        resumen = (await c.comando("modelo.resumen"))["resultado"]
        assert {t: v["estado"] for t, v in resumen["resultados"].items()} == {"estatico": "al_dia", "modal": "al_dia"}
        assert resumen["resultados"]["modal"]["tarea"] == id_m


@asincrona()
async def test_guardar_vybres_con_enlace_al_vybs(archivos, tmp_path):
    vybs = shutil.copy(archivos.vybs_pr01, tmp_path / "pr01a.vybs")
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        await c.comando("modelo.abrir_vybs", {"ruta": str(vybs)})
        _, fin = await c.tarea("resultados.guardar_vybres", {"ruta": str(tmp_path / "r.vybres")})
        assert fin["estado"] == "fallida" and fin["error"]["clave"] == "sin_resultados"
        assert (await c.tarea("analisis.estatico"))[1]["estado"] == "terminada"
        assert (await c.tarea("analisis.modal", {"n_modos": 4}))[1]["estado"] == "terminada"
        _, fin = await c.tarea("resultados.guardar_vybres", {"ruta": str(tmp_path / "r.vybres"), "exportar_vtu": False})
        assert fin["estado"] == "terminada", fin
        res = fin["resultado"]
        leido_vybs = leer_vybs(vybs)
        assert res["analisis"] == ["estatico", "modal"]
        assert res["modelo"] == {"guardado": True, "guid": leido_vybs.contenedor.manifest["guid"], "hash_contenido": leido_vybs.hash_contenido, "ruta": "pr01a.vybs"}
        leidos = leer_vybres(tmp_path / "r.vybres")
        tipos = [p.tipo for p in leidos.pasos]
        assert tipos.count("modo") == 4 and tipos.count("caso") == 7


@asincrona()
async def test_resultados_desactualizados_al_cambiar_el_modelo(archivos, tmp_path):
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        await c.comando("modelo.abrir_vybs", {"ruta": str(archivos.vybs_pr01)})
        assert (await c.tarea("analisis.estatico"))[1]["estado"] == "terminada"
        await c.comando("modelo.importar_vyba", {"ruta": str(archivos.vyba_pr01)})
        resumen = (await c.comando("modelo.resumen"))["resultado"]
        assert resumen["resultados"]["estatico"]["estado"] == "desactualizado"
        _, fin = await c.tarea("resultados.guardar_vybres", {"ruta": str(tmp_path / "r.vybres")})
        assert fin["error"]["clave"] == "sin_resultados"  # solo se guardan resultados del modelo actual
        _, fin = await c.tarea("analisis.estatico")
        assert fin["error"]["clave"] == "sin_casos"  # el .vyba no trae cargas


@pytest.mark.skipif(not pardiso_disponible(), reason="MKL PARDISO no disponible")
@asincrona()
async def test_el_resolvedor_se_respeta_dentro_de_la_tarea(archivos):
    """Por argumento (RPC) y por contexto (API Python: ``with usar_resolvedor`` alrededor de ``iniciar``). El PR-01 tiene
    ~200 GDL: «auto» elige SuperLU (umbral 5 000), así que «pardiso» solo sale si la tarea respeta lo pedido."""
    kernel = crear_kernel()
    kernel.ejecutar("modelo.abrir_vybs", {"ruta": str(archivos.vybs_pr01)})
    usados = {}
    with usar_resolvedor("pardiso"):
        id_tarea = kernel.iniciar("analisis.estatico")
    usados["contexto"] = (await asyncio.to_thread(kernel.esperar, id_tarea, PLAZO))["resultado"]["metadatos"]["resolvedor"]
    usados["sin_contexto"] = (await asyncio.to_thread(kernel.esperar, kernel.iniciar("analisis.estatico"), PLAZO))["resultado"]["metadatos"]["resolvedor"]
    async with servidor_en_marcha(kernel) as (_, puerto, _k), conectar(puerto) as c:
        for pedido in ("pardiso", "superlu", "auto"):
            usados[f"rpc_{pedido}"] = (await c.tarea("analisis.estatico", {"resolvedor": pedido}))[1]["resultado"]["metadatos"]["resolvedor"]
    assert usados == {"contexto": "pardiso", "sin_contexto": "superlu", "rpc_pardiso": "pardiso", "rpc_superlu": "superlu", "rpc_auto": "superlu"}


@asincrona()
async def test_cancelar_un_analisis_real_dentro_del_motor(archivos):
    """Cancelación cooperativa de un análisis de verdad: se pide al avisar el motor de una fase intermedia y sale del
    motor en su siguiente aviso (sin llegar a las fases de después); el resultado no se guarda."""
    kernel = crear_kernel()
    kernel.ejecutar("modelo.abrir_vybs", {"ruta": str(archivos.vybs_pr01)})

    def al_avisar(evento):
        if evento.tipo == "progreso" and evento.params["texto"].startswith("ensamblar la masa"):
            kernel.tareas.cancelar(evento.params["id"])

    kernel.tareas.suscribir(al_avisar)
    async with servidor_en_marcha(kernel) as (_, puerto, _k), conectar(puerto) as c:
        id_tarea, fin = await c.tarea("analisis.modal", {"n_modos": 4})
        assert fin == {"id": id_tarea, "nombre": "analisis.modal", "estado": "cancelada"}
        assert kernel.estado.resultado("modal") is None
        avisos = [n["params"] for n in c.notificaciones("tarea.progreso", id_tarea)]
        textos = [a["texto"] for a in avisos]
        assert textos[:3] == ["preparar el análisis modal", "preparar las barras", "ensamblar la rigidez"], textos
        assert textos[-1].startswith("ensamblar la masa") and not any(t.startswith("factorizar") for t in textos)
        fracciones = [a["fraccion"] for a in avisos]
        assert all(b >= a for a, b in zip(fracciones, fracciones[1:], strict=False)) and fracciones[-1] < 0.5


@asincrona()
async def test_cancelar_un_modal_grande_durante_el_lanczos():
    """Rejilla sintética de 9 216 GDL (Lanczos): la cancelación pedida en la fase de extracción sale en el siguiente
    producto del Lanczos. Criterio fijado antes de ejecutar: de la petición al fin < 0,25 s y estado ``cancelada``."""
    kernel = crear_kernel()
    con_modelo_en_memoria(kernel, rejilla(16, 5))
    kernel.ejecutar("prueba.poner_modelo")
    pedida: dict[str, float] = {}

    def al_avisar(evento):
        if evento.tipo == "progreso" and evento.params["texto"].startswith("extraer") and not pedida:
            pedida["t"] = time.perf_counter()
            kernel.tareas.cancelar(evento.params["id"])
        elif evento.tipo == "terminada" and pedida:
            pedida["fin"] = time.perf_counter()

    kernel.tareas.suscribir(al_avisar)
    id_tarea = kernel.iniciar("analisis.modal", {"n_modos": 12})
    fin = await asyncio.to_thread(kernel.esperar, id_tarea, PLAZO)
    assert fin["estado"] == "cancelada", fin
    assert "Lanczos" in fin["texto"], fin["texto"]
    assert pedida["fin"] - pedida["t"] < 0.25, pedida["fin"] - pedida["t"]
    assert kernel.estado.resultado("modal") is None


@asincrona()
async def test_ping_y_comandos_responden_durante_un_analisis_real():
    """Un análisis de verdad (modal de una rejilla sintética de 9 216 GDL: ~0,6 s medido) no bloquea el bus: mientras
    está en curso responden ``sistema.ping`` y ``comando.ejecutar``. Criterio fijado antes de ejecutar: ≥ 10 pings
    respondidos con la tarea en curso, latencia máxima < 1 s y el análisis termina bien."""
    kernel = crear_kernel()
    con_modelo_en_memoria(kernel, rejilla(16, 5))
    kernel.ejecutar("prueba.poner_modelo")
    async with servidor_en_marcha(kernel) as (_, puerto, _k), conectar(puerto) as c:
        id_tarea = (await c.solicitar("tarea.iniciar", {"nombre": "analisis.modal", "args": {"n_modos": 12}}))["result"]["id"]
        latencias, en_curso, comando_durante = [], 0, None
        while not c.notificaciones("tarea.terminada", id_tarea):
            inicio = time.perf_counter()
            assert (await c.solicitar("sistema.ping", plazo=5.0))["result"]["eco"] is None
            latencias.append(time.perf_counter() - inicio)
            estado = (await c.solicitar("tarea.estado", {"id": id_tarea}, plazo=5.0))["result"]["estado"]
            if estado == "en_curso":
                en_curso += 1
                if comando_durante is None:
                    comando_durante = await c.solicitar("comando.ejecutar", {"nombre": "modelo.resumen"}, plazo=10.0)
        fin = c.notificaciones("tarea.terminada", id_tarea)[0]["params"]
    assert fin["estado"] == "terminada" and fin["resultado"]["n_modos"] == 12, fin
    assert comando_durante is not None and comando_durante["result"]["resultado"]["nodos"] == 16 * 16 * 6
    assert en_curso >= 10 and max(latencias) < 1.0, (en_curso, max(latencias))


@asincrona()
async def test_verificacion_con_su_tabla_y_caso_desconocido():
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        _, fin = await c.tarea("verificacion.ejecutar", {"casos": ["V-B01", "V-M05", "V-M10"], "resolvedor": "superlu"})
        res = fin["resultado"]
        assert res["valido"] is True and res["casos"] == 3 and res["fallos"] == 0 and res["resolvedor"] == "superlu"
        assert {f["caso"] for f in res["filas"]} == {"V-B01", "V-M05", "V-M10"} and all(f["error"] <= f["tolerancia"] for f in res["filas"])
        lineas = res["tabla"].splitlines()
        assert lineas[0].startswith("caso    estado magnitud") and len(lineas) == res["comprobaciones"] + 1
        assert all(" OK " in linea for linea in lineas[1:])
        _, fin = await c.tarea("verificacion.ejecutar", {"casos": ["V-X99"]})
        assert fin["estado"] == "fallida" and fin["error"]["clave"] == "caso_desconocido" and fin["error"]["id"] == "V-X99"
