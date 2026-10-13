"""Regresiones de la auditoría del kernel (sesión 4, veredicto OBSERVADO): cada prueba reproduce el escenario del
hallazgo y comprueba el arreglo. ALTA-1 (solo lectura por ruta) y BAJA-1 (sellos) están en ``test_comandos.py``; las
claves de ruta de MEDIA-4, en ``test_errores_de_importar``."""
from __future__ import annotations

import asyncio
import json

import pytest
from ayudas_sim_kernel import TOKEN, asincrona, cierre, con_tarea_de_espera, conectar, servidor_en_marcha

from covillaf_sim_kernel.__main__ import normalizar_origen
from covillaf_sim_kernel.kernel import crear_kernel
from covillaf_sim_kernel.servidor import TAMANO_MAXIMO_AUTENTICACION

PLAZO = 20.0


@asincrona()
async def test_un_sustituto_suelto_no_tira_las_sesiones():
    """ALTA-2: ``"\\ud800"`` es JSON válido; el aviso ``tarea.terminada`` que lo repite se difunde a todas las sesiones.
    Antes websockets no podía codificarlo y cerraba **todas** las conexiones."""
    async with servidor_en_marcha() as (servidor, puerto, _k), conectar(puerto) as a, conectar(puerto) as b:
        await a.enviar('{"jsonrpc":"2.0","id":1,"method":"tarea.iniciar","params":{"nombre":"verificacion.ejecutar","args":{"casos":["\\ud800"]}}}')
        id_tarea = (await a.respuesta(1))["result"]["id"]
        for cliente in (a, b):
            fin = (await cliente.notificacion("tarea.terminada", id_tarea))["params"]
            assert fin["estado"] == "fallida" and fin["error"]["clave"] == "caso_desconocido" and fin["error"]["id"] == "\ud800"
            assert (await cliente.solicitar("sistema.ping", {"eco": "sigo"}))["result"]["eco"] == "sigo"
        assert len(servidor._sesiones) == 2


@pytest.mark.parametrize("token", ["\ud800", "a\udfffb"])
@asincrona()
async def test_token_con_sustituto_cierra_con_4401(token):
    """ALTA-2 y MEDIA-1: antes, 1011 (error interno) en vez de 4401."""
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto, token=None) as c:
        await c.enviar(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "sesion.autenticar", "params": {"token": token}}))
        assert await cierre(c.ws) == 4401


@asincrona()
async def test_segunda_autenticacion_con_sustituto_cierra_con_4401():
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        await c.enviar(json.dumps({"jsonrpc": "2.0", "id": 9, "method": "sesion.autenticar", "params": {"token": "\ud800"}}))
        assert (await c.respuesta(9))["error"]["code"] == -32001
        assert await cierre(c.ws) == 4401


@pytest.mark.parametrize("profundo", ["[" * 100_000, '{"a":' * 100_000, "[" * 5_000 + "]" * 5_000], ids=["corchetes", "objetos", "cerrado"])
@asincrona()
async def test_anidamiento_excesivo_responde_y_no_cae(profundo):
    """MEDIA-1: antes la solicitud se quedaba sin respuesta (RecursionError fuera del manejo de errores)."""
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        await c.enviar(profundo)
        r = json.loads(await c.recibir())
        assert r["id"] is None and r["error"]["code"] in (-32700, -32600), r
        assert (await c.solicitar("sistema.ping", {"eco": 1}))["result"]["eco"] == 1


@asincrona()
async def test_anidamiento_excesivo_como_primer_mensaje_cierra_con_4401():
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto, token=None) as c:
        await c.enviar("[" * 50_000)
        assert await cierre(c.ws) == 4401


@asincrona()
async def test_entero_enorme_da_32602_con_su_id():
    """BAJA-5: más de 4 300 cifras (límite de Python) daba -32700 sin id."""
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        await c.enviar('{"jsonrpc":"2.0","id":5,"method":"sistema.ping","params":{"eco":1' + "0" * 5_000 + "}}")
        r = await c.respuesta(5)
        assert r["error"]["code"] == -32602, r


@asincrona()
async def test_primer_mensaje_grande_no_se_lee():
    """BAJA-8: sin autenticar, como mucho `TAMANO_MAXIMO_AUTENTICACION` (64 KiB); después, el límite normal."""
    async with servidor_en_marcha() as (_, puerto, _k):
        async with conectar(puerto, token=None) as c:
            await c.enviar(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "sesion.autenticar", "params": {"token": TOKEN, "x": "a" * TAMANO_MAXIMO_AUTENTICACION}}))
            assert await cierre(c.ws) == 1009  # mensaje demasiado grande
        async with conectar(puerto) as c:  # autenticado: 1 MiB pasa
            assert (await c.solicitar("sistema.ping", {"eco": "b" * 2**20}))["result"]["eco"] == "b" * 2**20


@asincrona()
async def test_notificacion_de_autenticacion_mala_cierra_sin_responder():
    """BAJA-2: a una notificación no se responde (rpc.md §1.4); se cierra con 4401."""
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        await c.enviar({"jsonrpc": "2.0", "method": "sesion.autenticar", "params": {"token": "malo"}})
        try:
            async with asyncio.timeout(10):
                recibido = await c.ws.recv()
        except Exception as error:  # ConnectionClosed: lo esperado
            assert getattr(getattr(error, "rcvd", None), "code", None) == 4401, error
        else:
            raise AssertionError(f"respondió a una notificación: {recibido!r}")


@asincrona()
async def test_listas_de_argumentos_acotadas():
    """MEDIA-2: ``uniqueItems`` es cuadrático; las listas llevan ``maxItems`` (1 000, comprobado antes del esquema)."""
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        r = await c.solicitar("tarea.iniciar", {"nombre": "analisis.estatico", "args": {"casos": [f"C{i}" for i in range(10_001)]}}, plazo=PLAZO)
        assert r["error"]["code"] == -32602 and r["error"]["data"]["tarea"] == "analisis.estatico", r


@asincrona()
async def test_tarea_activas_y_registros_que_sueltan_la_instantanea():
    """BAJA-9 (``tarea.activas`` para una interfaz recargada) y MEDIA-3 (el registro terminado no retiene el modelo)."""
    kernel = crear_kernel()
    retencion = con_tarea_de_espera(kernel)
    async with servidor_en_marcha(kernel) as (_, puerto, _k), conectar(puerto) as c:
        assert (await c.solicitar("tarea.activas"))["result"] == []
        id_tarea = (await c.solicitar("tarea.iniciar", {"nombre": "prueba.espera"}))["result"]["id"]
        await asyncio.to_thread(retencion.dentro.wait, PLAZO)
        (activa,) = (await c.solicitar("tarea.activas"))["result"]
        assert activa["id"] == id_tarea and activa["estado"] == "en_curso" and activa["texto"] == "esperando a la prueba"
        retencion.soltar.set()
        await c.notificacion("tarea.terminada", id_tarea)
        assert (await c.solicitar("tarea.activas"))["result"] == []
        r = kernel.tareas._tareas[id_tarea]
        assert dict(r.instantanea) == {} and r.args == {} and len(r.contexto) == 0
        assert (await c.solicitar("tarea.estado", {"id": id_tarea}))["result"]["resultado"] == {"hecho": True}


@pytest.mark.parametrize(
    ("texto", "normal"),
    [
        ("http://127.0.0.1:5173", "http://127.0.0.1:5173"),
        ("http://127.0.0.1:5173/", "http://127.0.0.1:5173"),  # Vite la da con «/»: antes nunca coincidía (4403)
        ("http://localhost:5174", "http://localhost:5174"),
        ("http://localhost:5173.evil.example", None),
        ("http://127.0.0.1:5173/ruta", None),
        ("http://127.0.0.1:5173/?q=1", None),
        ("http://usuario@127.0.0.1:5173", None),
        ("https://127.0.0.1:5173", None),
        ("http://127.0.0.1", None),
        ("http://127.0.0.1:99999", None),
        ("http://192.168.1.2:5173", None),
        ("file:///C:/x.html", None),
    ],
)
def test_normalizar_origen(texto, normal):
    """BAJA-3: se analiza la URL en vez de comparar un prefijo."""
    assert normalizar_origen(texto) == normal


# --- auditoría del commit a32e22f (segunda vuelta) -----------------------------------------------------------------------


def test_lista_larga_de_tipos_mezclados_se_rechaza_al_momento():
    """B-MEDIA-1: `uniqueItems` es cuadrático con tipos mezclados y jsonschema lo evalúa aunque `maxItems` falle; la
    longitud se comprueba antes. Criterio fijado antes de ejecutar: < 0,1 s con 16 000 elementos (antes, 4,7 s)."""
    import time

    from covillaf_sim_kernel.tareas import ParametrosInvalidos

    kernel = crear_kernel()
    inicio = time.perf_counter()
    with pytest.raises(ParametrosInvalidos) as info:
        kernel.tareas.validar("analisis.estatico", {"casos": [0] + [f"a{i}" for i in range(16_000)]})
    assert time.perf_counter() - inicio < 0.1
    assert info.value.errores == [{"ruta": "/casos", "mensaje": "más de 1000 elementos"}]


def test_anidamiento_excesivo_en_args_es_parametro_invalido():
    """B-BAJA-4: antes, -32603 «error interno» (RecursionError dentro de jsonschema)."""
    from covillaf_sim_kernel.tareas import ParametrosInvalidos

    profundo: object = "x"
    for _ in range(900):
        profundo = [profundo]
    with pytest.raises(ParametrosInvalidos):
        crear_kernel().tareas.validar("verificacion.ejecutar", {"casos": [profundo]})


@asincrona()
async def test_tareas_de_una_sesion_se_encolan_en_el_orden_de_envio():
    """B-BAJA-2: la validación en un hilo dejaba que una tarea posterior adelantara a la anterior."""
    kernel = crear_kernel()
    retencion = con_tarea_de_espera(kernel)
    async with servidor_en_marcha(kernel) as (_, puerto, _k), conectar(puerto) as c:
        primero = (await c.solicitar("tarea.iniciar", {"nombre": "prueba.espera"}))["result"]["id"]  # ocupa el hilo
        await asyncio.to_thread(retencion.dentro.wait, PLAZO)
        for k in range(5):
            grande = {"casos": [f"V-X{i}" for i in range(900)]}  # validación lenta primero, rápida después
            await c.enviar({"jsonrpc": "2.0", "id": 100 + 2 * k, "method": "tarea.iniciar", "params": {"nombre": "verificacion.ejecutar", "args": grande}})
            await c.enviar({"jsonrpc": "2.0", "id": 101 + 2 * k, "method": "tarea.iniciar", "params": {"nombre": "verificacion.ejecutar", "args": {"casos": ["V-B01"]}}})
        ids = [(await c.respuesta(i))["result"]["id"] for i in range(100, 110)]
        activas = [t["id"] for t in (await c.solicitar("tarea.activas"))["result"]]
        assert activas == [primero, *ids], "la cola no sigue el orden de envío de la sesión"
        retencion.soltar.set()


def _manifest_version(ruta, version: str) -> None:
    """Reescribe `version_formato` del manifest de un .vybs (la copia se hace en el mismo sitio)."""
    import shutil
    import zipfile

    copia = ruta.with_suffix(".tmp")
    with zipfile.ZipFile(ruta) as zo, zipfile.ZipFile(copia, "w") as zd:
        for info in zo.infolist():
            datos = zo.read(info)
            if info.filename == "manifest.json":
                m = json.loads(datos)
                m["version_formato"] = version
                datos = json.dumps(m).encode("utf-8")
            zd.writestr(info, datos)
    shutil.move(copia, ruta)


@asincrona()
async def test_un_vybs_mas_nuevo_en_el_destino_nunca_se_reescribe(archivos, tmp_path):
    """B-MEDIA-2: los tres flujos que aún reescribían el archivo más nuevo (guardar como otro y volver; abrir otro;
    guardar encima sin haberlo abierto). La protección mira el contenido del destino."""
    import shutil

    nuevo = tmp_path / "nuevo.vybs"
    shutil.copy(archivos.vybs_pr01, nuevo)
    _manifest_version(nuevo, "0.2.0")
    antes = nuevo.read_bytes()
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        async def guardar(args):
            return await c.solicitar("comando.ejecutar", {"nombre": "modelo.guardar_vybs", "args": args})

        await c.comando("modelo.abrir_vybs", {"ruta": str(nuevo)})
        assert "result" in await guardar({"ruta": str(tmp_path / "otro.vybs")})
        assert (await guardar({"ruta": str(nuevo)}))["error"]["data"]["clave"] == "solo_lectura"   # 1
        await c.comando("modelo.abrir_vybs", {"ruta": str(archivos.vybs_pr01)})
        assert (await guardar({"ruta": str(nuevo)}))["error"]["data"]["clave"] == "solo_lectura"   # 2 y 3
        mayor = tmp_path / "mayor.vybs"
        shutil.copy(archivos.vybs_pr01, mayor)
        _manifest_version(mayor, "1.0.0")
        assert (await guardar({"ruta": str(mayor)}))["error"]["data"]["clave"] == "solo_lectura"  # mayor distinta
        assert "result" in await guardar({"ruta": str(tmp_path / "otro.vybs")})  # uno de esta versión sí
    assert nuevo.read_bytes() == antes


@asincrona()
async def test_rutas_extendidas_de_windows(archivos, tmp_path):
    r"""B-BAJA-3: «\\?\C:\…» y «\\.\C:\…» son locales; «\\?\UNC\…» es de red."""
    async with servidor_en_marcha() as (_, puerto, _k), conectar(puerto) as c:
        for prefijo in (r"\\?" + "\\", r"\\." + "\\"):
            r = await c.comando("modelo.abrir_vybs", {"ruta": prefijo + str(archivos.vybs_pr01)})
            assert r["resultado"]["nodos"] > 0
        r = await c.solicitar("comando.ejecutar", {"nombre": "modelo.abrir_vybs", "args": {"ruta": r"\\?\UNC\equipo\recurso\x.vybs"}})
        assert r["error"]["data"]["clave"] == "ruta_red"
        r = await c.solicitar("comando.ejecutar", {"nombre": "modelo.guardar_vybs", "args": {"ruta": str(tmp_path / "punto final.vybs.")}})
        assert r["error"]["data"]["clave"] in ("ruta_invalida", "extension")


# --- auditoría del commit 6fc4e37 (escritorio) ---------------------------------------------------------------------------


def test_lista_larga_escondida_tras_valores_de_relleno():
    """M3: con más de LIMITE_NODOS valores, el recorrido ya no deja pasar la lista larga (antes: 20 s con 32 000)."""
    import time

    from covillaf_sim_kernel.tareas import LIMITE_NODOS, ParametrosInvalidos

    args = {f"k{i}": 0 for i in range(LIMITE_NODOS)} | {"casos": [0] + [f"a{i}" for i in range(32_000)]}
    inicio = time.perf_counter()
    with pytest.raises(ParametrosInvalidos) as info:
        crear_kernel().tareas.validar("analisis.estatico", args)
    assert time.perf_counter() - inicio < 1.0 and info.value.errores[0]["ruta"] == "/"


def test_peticiones_iguales_de_un_campo_se_calculan_una_vez(archivos, monkeypatch):
    """M5: seis `resultados.campo` iguales a la vez hacían seis cálculos; ahora esperan al primero."""
    import threading

    from covillaf_sim_kernel import campos, metodos_resultados

    reales = campos.estado_estatico
    llamadas: list[int] = []

    def contar(*args, **kw):
        llamadas.append(1)
        return reales(*args, **kw)

    monkeypatch.setattr(campos, "estado_estatico", contar)
    kernel = crear_kernel()
    kernel.ejecutar("modelo.abrir_vybs", {"ruta": str(archivos.vybs_pr01)})
    kernel.esperar(kernel.iniciar("analisis.estatico"), PLAZO)
    cache = metodos_resultados._Cache()
    from covillaf_sim_kernel.estado import documento_de

    documento = documento_de(kernel.bus.modelo)
    g = cache.geometria(documento)
    r = kernel.estado.resultado("estatico", documento)
    salidas: list = []
    hilos = [threading.Thread(target=lambda: salidas.append(cache.estado_estatico(documento, g, r, "D"))) for _ in range(6)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(PLAZO)
    assert len(salidas) == 6 and len(llamadas) == 1
    assert all(s[0] is salidas[0][0] for s in salidas)


def test_destino_ilegible_no_se_sobrescribe(tmp_path):
    """B3: un .vybs con compresión que Python no lee (o cifrado) no se sabe de qué versión es: no se reescribe."""
    import zipfile

    from covillaf_sim_kernel.comandos_modelo import version_mas_nueva

    raro = tmp_path / "raro.vybs"
    with zipfile.ZipFile(raro, "w") as zf:
        zf.writestr("manifest.json", b'{"formato": "vybs", "version_formato": "0.1.0"}')
    datos = bytearray(raro.read_bytes())
    for inicio in (0, datos.find(b"PK\x01\x02")):  # cabecera local y central: método de compresión 93 (zstd)
        desplazamiento = inicio + (8 if inicio == 0 else 10)
        datos[desplazamiento : desplazamiento + 2] = (93).to_bytes(2, "little")
    raro.write_bytes(bytes(datos))
    assert version_mas_nueva(raro) == "desconocida"
