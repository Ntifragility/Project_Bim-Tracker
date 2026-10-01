"""``python -m covillaf_sim_kernel --puerto 0 --token-stdin`` (``rpc.md`` §1 de DESIGN; ``docs/protocolo/rpc_simulate.md``).

1. Lee el token de sesión de la **entrada estándar** (una línea). Nunca por argumentos ni variables de entorno.
2. Escucha en **127.0.0.1** (``--puerto 0`` = un puerto libre) y escribe **una** línea JSON por la salida estándar:
   ``{"evento":"listo","puerto":…,"kernel":…,"protocolo":1,"pid":…,"producto":"covillaf-simulate"}``. Todo lo demás va
   por stderr (UTF-8): el descriptor 1 se redirige a stderr al arrancar (OCCT, que llega con ``covillaf.sim.io``, escribe
   en ``std::cout``) y la línea «listo» se escribe por una copia del descriptor original.
3. Termina limpio (código 0) cuando se cierra la entrada estándar (el proceso padre murió), con Ctrl+C o con
   Ctrl+Break (``SIGBREAK``, Windows); antes cancela las tareas y espera `PLAZO_TAREAS` s a que lo atiendan.

Códigos de salida: 0 = cierre normal · 2 = uso incorrecto (sin token, argumentos) · 1 = error inesperado.

Este módulo solo importa la biblioteca estándar: el kernel (bus, motor, formatos) se importa dentro del bucle, después
de reservar stdout y de leer el token. Mismo arranque que ``covillaf_kernel.__main__`` de DESIGN y ``covillaf.kernel.arranque``
de la ficha D-8.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import getpass
import json
import logging
import os
import signal
import sys
import threading
import urllib.parse
from typing import BinaryIO

from covillaf_sim_kernel import PRODUCTO, PROTOCOLO, __version__

registro = logging.getLogger("covillaf_sim_kernel")

PROGRAMA = "python -m covillaf_sim_kernel"
#: Segundos que se espera a que las tareas en curso atiendan la cancelación al cerrar.
PLAZO_TAREAS = 5.0


def reservar_stdout() -> BinaryIO:
    """Devuelve un archivo binario sobre la salida estándar ORIGINAL y redirige el descriptor 1 a stderr."""
    with contextlib.suppress(AttributeError, OSError):
        sys.stdout.flush()
    try:
        copia = os.dup(1)
        os.dup2(2, 1)
    except OSError:  # sin descriptores estándar (p. ej. pythonw): se usa lo que haya
        return sys.stdout.buffer
    sys.stdout = sys.stderr
    return os.fdopen(copia, "wb", buffering=0)


def leer_token() -> str | None:
    """Primera línea de la entrada estándar, sin espacios (en consola se pide sin eco). Bloquea hasta que llegue: si el
    proceso padre muere antes de escribirla, llega EOF y se devuelve None."""
    if sys.stdin is None:
        return None
    if sys.stdin.isatty():
        try:
            return getpass.getpass("Token de sesión: ", stream=sys.stderr).strip() or None
        except (EOFError, KeyboardInterrupt):
            return None
    try:
        return sys.stdin.buffer.readline().decode("utf-8").strip() or None
    except (OSError, UnicodeDecodeError):
        return None


def vigilar_stdin(bucle: asyncio.AbstractEventLoop, fin: asyncio.Event, descriptor: int) -> None:
    """Hilo: lee la entrada estándar hasta EOF (el padre murió o la cerró) y pide el cierre.

    Lee con ``os.read`` sobre una COPIA del descriptor 0, nunca con ``sys.stdin.buffer`` (un hilo daemon bloqueado con
    el candado del ``BufferedReader`` tomado haría abortar a Python al finalizar; visto en DESIGN con Ctrl+Break).
    """
    try:
        while os.read(descriptor, 65536):
            pass
    except OSError:
        pass
    registro.info("stdin cerrado: el kernel se detiene")
    with contextlib.suppress(RuntimeError):  # el bucle ya terminó (cierre por otra vía)
        bucle.call_soon_threadsafe(fin.set)


def normalizar_origen(texto: str) -> str | None:
    """``http://127.0.0.1:<puerto>`` o ``http://localhost:<puerto>`` (con o sin «/» final) → ``http://host:puerto``, que
    es lo que el navegador manda en ``Origin``; None si no es exactamente eso (otra ruta, consulta, usuario, otro host
    —``localhost:5173.evil.example``—, otro esquema o sin puerto)."""
    try:
        url = urllib.parse.urlsplit(texto)
        puerto = url.port
    except ValueError:
        return None
    if (url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost") or puerto is None or url.path not in ("", "/")
            or url.query or url.fragment or url.username or url.password or "@" in url.netloc):  # fmt: skip
        return None
    return f"http://{url.hostname}:{puerto}"


def linea_listo(puerto: int, pid: int) -> bytes:
    """La línea «listo» (JSON compacto + ``\\n``) con ``producto`` al final (aditivo sobre ``rpc.md`` §1)."""
    listo = {"evento": "listo", "puerto": puerto, "kernel": __version__, "protocolo": PROTOCOLO, "pid": pid, "producto": PRODUCTO}
    return (json.dumps(listo, separators=(",", ":")) + "\n").encode("utf-8")


async def ejecutar(args: argparse.Namespace, token: str, salida: BinaryIO) -> int:
    from covillaf_sim_kernel.kernel import crear_servidor

    bucle = asyncio.get_running_loop()
    fin = asyncio.Event()
    for nombre in ("SIGBREAK", "SIGTERM"):
        senal = getattr(signal, nombre, None)
        if senal is not None:
            signal.signal(senal, lambda *_: bucle.call_soon_threadsafe(fin.set))
    servidor = crear_servidor(token, list(args.origen_permitido))
    puerto = await servidor.iniciar("127.0.0.1", args.puerto)
    salida.write(linea_listo(puerto, os.getpid()))
    salida.flush()
    registro.info("kernel %s (%s) escuchando en 127.0.0.1:%d (pid %d)", __version__, PRODUCTO, puerto, os.getpid())
    try:
        descriptor = os.dup(sys.stdin.fileno())
    except (AttributeError, OSError, ValueError):
        descriptor = None
    if descriptor is not None:
        threading.Thread(target=vigilar_stdin, args=(bucle, fin, descriptor), name="vigia-stdin", daemon=True).start()
    try:
        await fin.wait()
    finally:
        await servidor.detener()
        if servidor.tareas is not None:
            await asyncio.to_thread(servidor.tareas.cerrar, PLAZO_TAREAS)
        registro.info("kernel detenido")
    return 0


def construir_analizador() -> argparse.ArgumentParser:
    analizador = argparse.ArgumentParser(prog=PROGRAMA, description="Kernel de COVILLAF SIMULATE (JSON-RPC por WebSocket).")
    analizador.add_argument("--puerto", type=int, default=0, help="puerto TCP en 127.0.0.1 (0 = uno libre al azar)")
    analizador.add_argument("--token-stdin", action="store_true", help="leer el token de sesión de la entrada estándar (obligatorio)")
    analizador.add_argument(
        "--origen-permitido",
        action="append",
        default=[],
        metavar="URL",
        help="Origin adicional permitido, p. ej. http://127.0.0.1:5173 (servidor de Vite en desarrollo); repetible",
    )
    analizador.add_argument("--registro", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"], help="nivel de registro (stderr)")
    return analizador


def main(argumentos: list[str] | None = None) -> int:
    # stderr en UTF-8 aunque sea una tubería (en Windows se usaría la página de códigos local): Electron lo lee en UTF-8.
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    args = construir_analizador().parse_args(argumentos)
    logging.basicConfig(level=args.registro, stream=sys.stderr, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.registro != "DEBUG":
        logging.getLogger("websockets").setLevel(logging.WARNING)
    if not 0 <= args.puerto <= 65535:
        registro.error("--puerto fuera de rango: %d", args.puerto)
        return 2
    if not args.token_stdin:
        registro.error("falta --token-stdin: el token de sesión solo se acepta por la entrada estándar")
        return 2
    origenes = [normalizar_origen(o) for o in args.origen_permitido]
    for texto, origen in zip(args.origen_permitido, origenes, strict=True):
        if origen is None:
            registro.error("--origen-permitido solo admite orígenes locales (http://127.0.0.1:<puerto>): %r", texto)
            return 2
    args.origen_permitido = origenes
    salida = reservar_stdout()
    token = leer_token()
    if not token:
        registro.error("no se recibió el token de sesión por stdin")
        return 2
    if len(token) != 64 or any(c not in "0123456789abcdefABCDEF" for c in token):
        registro.warning("el token no tiene el formato del protocolo (32 bytes en hex): úsese solo para depurar")
    try:
        return asyncio.run(ejecutar(args, token, salida))
    except KeyboardInterrupt:
        registro.info("Ctrl+C: kernel detenido")
        return 0
    except Exception:
        registro.exception("error inesperado del kernel")
        return 1


if __name__ == "__main__":
    sys.exit(main())
