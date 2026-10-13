"""Servidor JSON-RPC 2.0 sobre WebSocket del kernel de SIMULATE (contrato: ``docs/protocolo/rpc_simulate.md``, que
toma ``rpc.md`` v1 de COVILLAF DESIGN al pie de la letra y añade las tareas).

Servidor **propio** (F0-24): el de DESIGN no sirve tal cual (su versión, ``Origin`` ``app://covillaf``, métodos de prueba,
sin tareas). Nombres y semántica = ``covillaf.kernel.servidor`` de la ficha D-8 (`Identidad`, `Metodo`, `Respuesta`,
`metodos_basicos`, `ServidorKernel`), para que migrar al núcleo común sea cambiar imports cuando DESIGN lo aplique.

- Escucha solo en 127.0.0.1. Cabecera ``Origin``: se aceptan los de `Identidad.origenes` (SIMULATE:
  ``app://covillaf-simulate``) y los de desarrollo que se pasen al arrancar (``--origen-permitido``); sin ``Origin``
  (pruebas, CLI) también, siempre con token. Cualquier otro (``app://covillaf`` de DESIGN, ``file://`` y ``null``
  incluidos: `Identidad` no los admite) ⇒ cierre **4403** nada más abrir la conexión.
- El **primer** mensaje debe ser ``sesion.autenticar`` con el token correcto (comparación en tiempo constante con
  ``hmac.compare_digest``). Token incorrecto, otro método antes o 5 s sin autenticarse ⇒ error -32001 (si la solicitud
  tenía ``id``) y cierre **4401**.
- Texto = JSON-RPC 2.0 sin lotes; binario = tramas VYBF (solo kernel → interfaz, detrás de ``resultados.campo``). **Orden**:
  en ``comando.ejecutar``/``deshacer``/``rehacer`` la notificación ``modelo.cambios`` llega **antes** que la respuesta.
- ``modelo.cambios`` lleva siempre ``modificado`` (cambios sin guardar) y, tras sustituir el modelo, ``reemplazado:
  true`` con ``transaccion: null``; se difunde a todas las sesiones autenticadas.
- Los comandos corren en un hilo aparte (el bucle sigue atendiendo ``sistema.ping`` mientras tanto); una sola
  transacción a la vez (``-32003`` si llega otra).
- **Tareas** (aditivo, no sube ``protocolo``): ``tarea.listar``, ``tarea.iniciar`` (``{id}``; la respuesta llega antes
  que cualquier aviso de esa tarea), ``tarea.estado``, ``tarea.cancelar``; avisos ``tarea.progreso {id, texto,
  fraccion}`` y ``tarea.terminada {id, nombre, estado, resultado?, error?}`` a todas las sesiones. Corren fuera del
  candado del bus: un análisis largo no bloquea los comandos ni ``sistema.ping``.
"""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import math
import platform
import threading
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft202012Validator
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from covillaf.core.tiempo import ahora_utc
from covillaf_sim_kernel import PROTOCOLO
from covillaf_sim_kernel.bus import (
    BusComandos,
    ComandoDesconocido,
    ConflictoTransaccion,
    EventoCambios,
    FalloComando,
    ParametrosInvalidos,
    ResultadoComando,
)
from covillaf_sim_kernel.tareas import ErrorTarea, EventoTarea, GestorTareas, TareaDesconocida

registro = logging.getLogger("covillaf_sim_kernel.servidor")

# Cierres del protocolo (rpc.md §1)
CIERRE_NO_AUTENTICADO = 4401
CIERRE_ORIGEN = 4403
# Errores (rpc.md §4)
ERROR_ANALISIS = -32700
SOLICITUD_INVALIDA = -32600
METODO_INEXISTENTE = -32601
PARAMETROS_INVALIDOS = -32602
ERROR_INTERNO = -32603
NO_AUTENTICADO = -32001
FALLO_COMANDO = -32002
CONFLICTO_TRANSACCION = -32003

PLAZO_AUTENTICACION = 5.0
TAMANO_MAXIMO_MENSAJE = 16 * 2**20  # entrante (texto JSON); los paquetes salientes no tienen límite
TAMANO_MAXIMO_AUTENTICACION = 64 * 2**10  # entrante antes de autenticarse (el primer mensaje)
_SIN_ID = object()


class ErrorRpc(Exception):
    """Error JSON-RPC. `id` es el de la solicitud cuando se llegó a leer (si no, None)."""

    def __init__(self, codigo: int, mensaje: str, datos: Any = None, *, id: Any = None) -> None:
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje
        self.datos = datos
        self.id = id


@dataclass(slots=True)
class Solicitud:
    id: Any  # _SIN_ID si es notificación
    metodo: str
    params: dict[str, Any]

    @property
    def es_notificacion(self) -> bool:
        return self.id is _SIN_ID


@dataclass(eq=False, slots=True)
class Sesion:
    conexion: ServerConnection
    cliente: str = ""
    #: Solicitudes de esta sesión que se están atendiendo (tareas de asyncio; se cancelan al cerrar la conexión).
    solicitudes: set[asyncio.Task] = field(default_factory=set)
    #: `tarea.iniciar` de esta sesión, uno tras otro: la cola respeta el orden en que la sesión los envió.
    orden_tareas: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass(frozen=True, slots=True)
class Respuesta:
    """Lo que devuelve un método: `resultado` (JSON), los `binarios` que se envían detrás de la respuesta y, si hace
    falta, `despues`: se llama cuando la respuesta ya salió (o no pudo salir), p. ej. para soltar una tarea retenida."""

    resultado: Any
    binarios: Sequence[bytes] = ()
    despues: Callable[[], None] | None = None


Manejador = Callable[["ServidorKernel", Sesion, dict[str, Any]], Awaitable[Respuesta]]


@dataclass(frozen=True, slots=True)
class Metodo:
    """Un método de la tabla: su manejador ``async (servidor, sesion, params) -> Respuesta`` y el JSON Schema (tipo
    ``object``) de ``params``, que el servidor valida antes de llamarlo (``-32602`` con ``data.errores``)."""

    manejador: Manejador
    parametros: Mapping[str, Any]


def origen_admisible(origen: object) -> bool:
    """Un ``Origin`` que se puede permitir: texto no vacío, ni ``null`` ni ``file:`` (F0-38 de DESIGN: cualquier HTML
    abierto desde el disco en un navegador los enviaría)."""
    return isinstance(origen, str) and bool(origen.strip()) and origen.lower() != "null" and not origen.lower().startswith("file:")


@dataclass(frozen=True, slots=True)
class Identidad:
    """Lo que distingue a un kernel de la familia en el cable (``rpc.md`` §1 y §3).

    `version`: ``kernel`` de ``listo``, ``sesion.autenticar`` y ``sistema.version``. `protocolo`: el que exige su
    interfaz. `producto` (``"covillaf-simulate"``): si no es None, campo ``producto`` en esos tres mensajes (aditivo).
    `origenes`: ``Origin`` fijos aceptados (``app://covillaf-simulate``); nunca ``file://`` ni ``null``. `versiones`:
    campos extra de ``sistema.version`` (se llama en un hilo; por defecto ``{python}``).
    """

    version: str
    protocolo: int = PROTOCOLO
    producto: str | None = None
    origenes: frozenset[str] = frozenset()
    versiones: Callable[[], Mapping[str, Any]] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.version, str) or not self.version.strip():
            raise ValueError("la versión del kernel no puede estar vacía")
        if isinstance(self.protocolo, bool) or not isinstance(self.protocolo, int) or self.protocolo < 1:
            raise ValueError(f"protocolo no válido: {self.protocolo!r}")
        if self.producto is not None and (not isinstance(self.producto, str) or not self.producto.strip()):
            raise ValueError("el producto, si se da, no puede estar vacío")
        malos = sorted(str(o) for o in self.origenes if not origen_admisible(o))
        if malos:
            raise ValueError(f"Origin fijos no admitidos (nunca file:// ni null): {malos}")
        object.__setattr__(self, "origenes", frozenset(self.origenes))


def _dumps(objeto: Any) -> str:
    """JSON compacto en UTF-8 legible; si lleva un sustituto UTF-16 suelto (``"\\ud800"`` es JSON válido y NTFS admite
    nombres así), con escapes ``\\uXXXX``: sin esto websockets no puede codificar el mensaje y cierra la conexión, y en
    una difusión caerían todas las sesiones (auditoría del kernel, ALTA-2)."""
    texto = json.dumps(objeto, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    try:
        texto.encode("utf-8")
    except UnicodeEncodeError:
        texto = json.dumps(objeto, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    return texto


def _rechazar_constante(nombre: str) -> Any:
    raise ValueError(f"constante no válida en JSON: {nombre}")


class _Desborde(float):
    """Un número JSON válido que no cabe en un doble (``1e400`` → ``inf``): se marca al analizar para rechazar la
    solicitud con ``-32602`` (con su ``id``) en vez de dejar entrar un infinito en el modelo (H-01 de la auditoría 09
    de DESIGN, que ``rpc.md`` v1 ya incluye)."""

    texto: str


def _numero_json(texto: str) -> float:
    valor = float(texto)
    if math.isfinite(valor):
        return valor
    marca = _Desborde(valor)
    marca.texto = texto[:40]
    return marca


def _entero_json(texto: str) -> int | float:
    """Un entero JSON; si ni siquiera cabe en un doble (más de ~1,8e308), se marca como desborde."""
    try:
        valor = int(texto)
    except ValueError:  # más de 4 300 cifras (límite de conversión de Python): desborda el doble con seguridad
        marca = _Desborde(-math.inf if texto.startswith("-") else math.inf)
        marca.texto = texto[:40] + "…"
        return marca
    if len(texto) > 300:
        try:
            float(valor)
        except OverflowError:
            marca = _Desborde(math.inf if valor > 0 else -math.inf)
            marca.texto = texto[:40] + "…"
            return marca
    return valor


def _desborde_en(valor: Any) -> str | None:
    if isinstance(valor, _Desborde):
        return valor.texto
    if isinstance(valor, dict):
        valores: Iterable[Any] = valor.values()
    elif isinstance(valor, list):
        valores = valor
    else:
        return None
    for hijo in valores:
        encontrado = _desborde_en(hijo)
        if encontrado is not None:
            return encontrado
    return None


def analizar(texto: str) -> Solicitud:
    """Analiza y valida un mensaje JSON-RPC 2.0 (solo solicitudes y notificaciones con parámetros por nombre).

    ``NaN``, ``Infinity`` y ``-Infinity`` no son JSON: ``-32700``. Un número que desborda el doble (``1e400``) sí es JSON
    pero no se admite: ``-32602`` con el ``id`` de la solicitud."""
    try:
        mensaje = json.loads(texto, parse_constant=_rechazar_constante, parse_float=_numero_json, parse_int=_entero_json)
    except ValueError as error:
        raise ErrorRpc(ERROR_ANALISIS, "error de análisis: el mensaje no es JSON válido", {"detalle": str(error)}) from error
    except RecursionError as error:
        raise ErrorRpc(ERROR_ANALISIS, "error de análisis: anidamiento excesivo") from error
    try:
        return _solicitud(mensaje)
    except RecursionError as error:  # `_desborde_en` recorre los params
        raise ErrorRpc(SOLICITUD_INVALIDA, "solicitud inválida: anidamiento excesivo") from error


def _solicitud(mensaje: Any) -> Solicitud:
    if isinstance(mensaje, list):
        raise ErrorRpc(SOLICITUD_INVALIDA, "solicitud inválida: el protocolo no admite lotes (batch)")
    if not isinstance(mensaje, dict):
        raise ErrorRpc(SOLICITUD_INVALIDA, "solicitud inválida: se esperaba un objeto JSON")
    id_ = mensaje.get("id", _SIN_ID)
    if id_ is not _SIN_ID and (isinstance(id_, (bool, _Desborde)) or not isinstance(id_, (str, int, float, type(None)))):
        raise ErrorRpc(SOLICITUD_INVALIDA, "solicitud inválida: id debe ser texto, número o null")
    id_respuesta = None if id_ is _SIN_ID else id_
    if mensaje.get("jsonrpc") != "2.0":
        raise ErrorRpc(SOLICITUD_INVALIDA, 'solicitud inválida: falta "jsonrpc": "2.0"', id=id_respuesta)
    metodo = mensaje.get("method")
    if not isinstance(metodo, str):
        raise ErrorRpc(SOLICITUD_INVALIDA, "solicitud inválida: method debe ser texto", id=id_respuesta)
    params = mensaje.get("params", {})
    if isinstance(params, list):
        raise ErrorRpc(PARAMETROS_INVALIDOS, "parámetros inválidos: se esperan por nombre (objeto), no por posición", id=id_respuesta)
    if not isinstance(params, dict):
        raise ErrorRpc(SOLICITUD_INVALIDA, "solicitud inválida: params debe ser un objeto", id=id_respuesta)
    desborde = _desborde_en(params)
    if desborde is not None:
        raise ErrorRpc(
            PARAMETROS_INVALIDOS, "parámetros inválidos: número fuera del rango del doble",
            {"detalle": f"el número {desborde} no es finito en doble precisión"}, id=id_respuesta,
        )  # fmt: skip
    return Solicitud(id_, metodo, params)


def esquema_objeto(propiedades: dict[str, Any] | None = None, requeridos: Iterable[str] = (), adicionales: bool = False) -> dict[str, Any]:
    """JSON Schema de un objeto (``params`` de un método), ya comprobado."""
    esquema = {"type": "object", "properties": propiedades or {}, "required": list(requeridos), "additionalProperties": adicionales}
    Draft202012Validator.check_schema(esquema)
    return esquema


# --- métodos básicos (rpc.md §3) ---------------------------------------------------------------------------------------


async def _m_autenticar(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    return Respuesta(servidor._comprobar_token(sesion, params))


async def _m_version(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    return Respuesta(await asyncio.to_thread(servidor.versiones))


async def _m_ping(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    return Respuesta({"eco": params.get("eco"), "t_kernel": ahora_utc()})


async def _m_listar(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    return Respuesta(servidor.bus.listar())


def _cambios_rpc(resultado: ResultadoComando) -> dict[str, Any]:
    return resultado.cambios.como_dict()


async def _m_ejecutar(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    r = await servidor.operacion_bus(servidor.bus.ejecutar, params["nombre"], params.get("args", {}))
    return Respuesta({"resultado": r.resultado, "transaccion": r.transaccion, "cambios": _cambios_rpc(r)})


async def _m_deshacer(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    r = await servidor.operacion_bus(servidor.bus.deshacer)
    return Respuesta({"transaccion": r.transaccion, "cambios": _cambios_rpc(r)})


async def _m_rehacer(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    r = await servidor.operacion_bus(servidor.bus.rehacer)
    return Respuesta({"transaccion": r.transaccion, "cambios": _cambios_rpc(r)})


# --- métodos de tareas (aditivos) --------------------------------------------------------------------------------------


def _gestor(servidor: ServidorKernel) -> GestorTareas:
    if servidor.tareas is None:  # pragma: no cover - el constructor lo impide
        raise ErrorRpc(METODO_INEXISTENTE, "este kernel no tiene tareas")
    return servidor.tareas


async def _m_tarea_listar(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    return Respuesta(_gestor(servidor).listar())


async def _m_tarea_iniciar(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    """Valida, toma la instantánea (rápido, en el bucle: sin ventana en la que una sesión cerrada deje una tarea
    retenida) y deja la tarea retenida hasta haber enviado ``{id}``."""
    gestor = _gestor(servidor)
    nombre = params["nombre"]
    args = params.get("args", {})
    try:
        # La validación puede tardar con argumentos grandes: en un hilo, para no parar el bucle (ping, otras sesiones).
        # La instantánea y la retención van después, en el bucle y sin `await` entre medias. Por sesión, de una en
        # una: si no, una validación más corta adelantaría en la cola a la anterior (auditoría a32e22f, B-BAJA-2).
        async with sesion.orden_tareas:
            await asyncio.to_thread(gestor.validar, nombre, args)
            id_tarea = gestor.iniciar(nombre, args, retenida=True, validados=True)
    except TareaDesconocida as error:
        raise ErrorRpc(PARAMETROS_INVALIDOS, str(error), {"tarea": nombre, "detalle": "tarea desconocida"}) from error
    except ParametrosInvalidos as error:
        raise ErrorRpc(PARAMETROS_INVALIDOS, f"parámetros inválidos para {nombre}", {"tarea": nombre, "errores": error.errores}) from error
    except ConflictoTransaccion as error:
        raise ErrorRpc(CONFLICTO_TRANSACCION, str(error)) from error
    except ErrorTarea as error:
        raise ErrorRpc(FALLO_COMANDO, f"la tarea {nombre} no se pudo iniciar", {"tarea": nombre, "detalle": str(error)}) from error
    return Respuesta({"id": id_tarea}, despues=lambda: gestor.liberar(id_tarea))


async def _m_tarea_activas(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    return Respuesta(_gestor(servidor).activas())


async def _m_tarea_estado(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    try:
        return Respuesta(_gestor(servidor).estado(params["id"]))
    except TareaDesconocida as error:
        raise ErrorRpc(PARAMETROS_INVALIDOS, str(error), {"id": params["id"], "detalle": "tarea desconocida"}) from error


async def _m_tarea_cancelar(servidor: ServidorKernel, sesion: Sesion, params: dict[str, Any]) -> Respuesta:
    try:
        return Respuesta(_gestor(servidor).cancelar(params["id"]))
    except TareaDesconocida as error:
        raise ErrorRpc(PARAMETROS_INVALIDOS, str(error), {"id": params["id"], "detalle": "tarea desconocida"}) from error


_ESQUEMA_AUTENTICAR = esquema_objeto({"token": {"type": "string"}, "cliente": {"type": "string"}}, ["token"], adicionales=True)
_ID_TAREA = {"type": "string", "minLength": 1, "maxLength": 64}


def metodos_basicos(*, tareas: bool = False) -> dict[str, Metodo]:
    """Tabla por defecto (``rpc.md`` §3 **sin** los métodos de prueba de DESIGN, ``geometria.caja_prueba`` y
    ``modelo.mallas``): ``sistema.version``, ``sistema.ping``, ``comando.listar``, ``comando.ejecutar``,
    ``transaccion.deshacer``/``rehacer`` y, con `tareas`, ``tarea.listar``/``iniciar``/``estado``/``cancelar``.
    ``sesion.autenticar`` es del servidor y no va en la tabla."""
    tabla = {
        "sistema.version": Metodo(_m_version, esquema_objeto()),
        "sistema.ping": Metodo(_m_ping, esquema_objeto({"eco": {}})),
        "comando.listar": Metodo(_m_listar, esquema_objeto()),
        "comando.ejecutar": Metodo(_m_ejecutar, esquema_objeto({"nombre": {"type": "string"}, "args": {"type": "object"}}, ["nombre"])),
        "transaccion.deshacer": Metodo(_m_deshacer, esquema_objeto()),
        "transaccion.rehacer": Metodo(_m_rehacer, esquema_objeto()),
    }
    if tareas:
        tabla |= {
            "tarea.listar": Metodo(_m_tarea_listar, esquema_objeto()),
            "tarea.activas": Metodo(_m_tarea_activas, esquema_objeto()),
            "tarea.iniciar": Metodo(_m_tarea_iniciar, esquema_objeto({"nombre": {"type": "string"}, "args": {"type": "object"}}, ["nombre"])),
            "tarea.estado": Metodo(_m_tarea_estado, esquema_objeto({"id": _ID_TAREA}, ["id"])),
            "tarea.cancelar": Metodo(_m_tarea_cancelar, esquema_objeto({"id": _ID_TAREA}, ["id"])),
        }
    return tabla


# --- servidor ----------------------------------------------------------------------------------------------------------


class ServidorKernel:
    """Servidor. Uso: ``puerto = await servidor.iniciar()`` … ``await servidor.detener()``.

    `metodos`: tabla completa (None ⇒ `metodos_basicos` con ``tarea.*`` si hay `tareas`). `origenes_extra`: ``Origin``
    de desarrollo (el arranque solo admite ``http://127.0.0.1:<p>`` y ``http://localhost:<p>``).
    """

    def __init__(
        self,
        token: str,
        bus: BusComandos,
        *,
        identidad: Identidad,
        metodos: Mapping[str, Metodo] | None = None,
        tareas: GestorTareas | None = None,
        origenes_extra: Iterable[str] = (),
        plazo_autenticacion: float = PLAZO_AUTENTICACION,
    ) -> None:
        if not isinstance(token, str) or not token:
            raise ValueError("el token no puede estar vacío")
        tabla = dict(metodos_basicos(tareas=tareas is not None) if metodos is None else metodos)
        if "sesion.autenticar" in tabla:
            raise ValueError("sesion.autenticar es del servidor: no va en la tabla de métodos")
        if tareas is None and any(nombre.startswith("tarea.") for nombre in tabla):
            raise ValueError("la tabla tiene métodos tarea.* pero no hay GestorTareas")
        extra = frozenset(origenes_extra)
        malos = sorted(str(o) for o in extra if not origen_admisible(o))
        if malos:
            raise ValueError(f"Origin de desarrollo no admitidos (nunca file:// ni null): {malos}")
        tabla = {"sesion.autenticar": Metodo(_m_autenticar, _ESQUEMA_AUTENTICAR), **tabla}
        self._validadores: dict[str, Draft202012Validator] = {}
        for nombre, metodo in tabla.items():
            if metodo.parametros.get("type") != "object":
                raise ValueError(f"{nombre}: el esquema de params debe ser de tipo object")
            Draft202012Validator.check_schema(metodo.parametros)
            self._validadores[nombre] = Draft202012Validator(metodo.parametros)
        self._metodos = tabla
        self._token = token.encode("utf-8")
        self._bus = bus
        self._tareas = tareas
        self._identidad = identidad
        self._origenes = identidad.origenes | extra
        self._plazo = plazo_autenticacion
        self._sesiones: set[Sesion] = set()
        self._ultimo_lote = 0
        self._candado_lotes = threading.Lock()
        self._servidor: Server | None = None
        self._bucle: asyncio.AbstractEventLoop | None = None
        self._cola: asyncio.Queue | None = None  # modelo.cambios (operacion_bus espera a que se vacíe)
        self._cola_avisos: asyncio.Queue | None = None  # demás notificaciones (tareas, `notificar`)
        self._difusores: list[asyncio.Task] = []
        self._bajas: list[Callable[[], None]] = []

    # --- propiedades -----------------------------------------------------------------------------------------------

    @property
    def bus(self) -> BusComandos:
        return self._bus

    @property
    def tareas(self) -> GestorTareas | None:
        return self._tareas

    @property
    def identidad(self) -> Identidad:
        return self._identidad

    @property
    def metodos(self) -> tuple[str, ...]:
        """Nombres de los métodos que atiende (``sesion.autenticar`` incluido), por orden alfabético."""
        return tuple(sorted(self._metodos))

    @property
    def origenes(self) -> frozenset[str]:
        """``Origin`` aceptados (los fijos de la identidad y los de desarrollo)."""
        return self._origenes

    @property
    def direccion(self) -> tuple[str, int]:
        if self._servidor is None:
            raise RuntimeError("el servidor no está iniciado")
        return self._servidor.sockets[0].getsockname()[:2]

    # --- ciclo de vida --------------------------------------------------------------------------------------------

    async def iniciar(self, host: str = "127.0.0.1", puerto: int = 0) -> int:
        """Empieza a escuchar y devuelve el puerto (0 = uno libre elegido por el sistema)."""
        self._bucle = asyncio.get_running_loop()
        self._cola = asyncio.Queue()
        self._cola_avisos = asyncio.Queue()
        self._difusores = [
            asyncio.create_task(self._difundir(self._cola), name="difusor-modelo-cambios"),
            asyncio.create_task(self._difundir(self._cola_avisos), name="difusor-avisos"),
        ]
        self._bajas = [self._bus.suscribir(self._al_cambiar)]
        if self._tareas is not None:
            self._bajas.append(self._tareas.suscribir(self._al_evento_tarea))
        self._servidor = await serve(
            self._atender,
            host,
            puerto,
            compression=None,  # conexión local: comprimir solo gasta CPU
            max_size=TAMANO_MAXIMO_MENSAJE,
            server_header=None,
        )
        return self.direccion[1]

    async def detener(self) -> None:
        """Deja de escuchar y cierra las conexiones (código 1001). Se puede llamar varias veces. No cancela las tareas
        (el `GestorTareas` puede sobrevivir al servidor): eso lo hace el arranque con `GestorTareas.cerrar`."""
        bajas, self._bajas = self._bajas, []
        for baja in bajas:
            baja()
        if self._servidor is not None:
            self._servidor.close()  # cierra las conexiones abiertas con 1001
            try:
                async with asyncio.timeout(5.0):
                    await self._servidor.wait_closed()
            except TimeoutError:
                registro.warning("las conexiones no se cerraron en 5 s")
        difusores, self._difusores = self._difusores, []
        for difusor in difusores:
            difusor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await difusor

    def nuevo_lote(self) -> int:
        """Siguiente lote de paquetes binarios: 1, 2, … 2³²−1 y vuelta a 1 (el 0 no se usa). Seguro entre hilos."""
        with self._candado_lotes:
            self._ultimo_lote = self._ultimo_lote % (2**32 - 1) + 1
            return self._ultimo_lote

    def versiones(self) -> dict[str, Any]:
        """Resultado de ``sistema.version``: ``kernel``, ``protocolo``, ``producto`` (si lo hay) y las versiones de la
        identidad (por defecto ``python``); estas no pisan las tres primeras. Puede tardar: llamarla en un hilo."""
        base: dict[str, Any] = {"kernel": self._identidad.version, "protocolo": self._identidad.protocolo}
        if self._identidad.producto is not None:
            base["producto"] = self._identidad.producto
        extra = self._identidad.versiones() if self._identidad.versiones is not None else {"python": platform.python_version()}
        return base | {clave: valor for clave, valor in extra.items() if clave not in base}

    async def operacion_bus(self, funcion: Callable[..., ResultadoComando], *args: Any) -> ResultadoComando:
        """Ejecuta una operación del bus en un hilo, traduce sus errores a JSON-RPC (``-32602``, ``-32002``,
        ``-32003``) y espera a que se hayan enviado sus ``modelo.cambios`` (así la respuesta llega después)."""
        try:
            resultado = await asyncio.to_thread(funcion, *args)
        except ComandoDesconocido as error:
            raise ErrorRpc(PARAMETROS_INVALIDOS, str(error), {"comando": error.nombre, "detalle": "comando desconocido"}) from error
        except ParametrosInvalidos as error:
            raise ErrorRpc(PARAMETROS_INVALIDOS, f"parámetros inválidos para {error.nombre}", {"comando": error.nombre, "errores": error.errores}) from error
        except FalloComando as error:
            datos = {"comando": error.nombre, "detalle": error.detalle}
            if error.clave is not None:
                datos["clave"] = error.clave
            if error.id is not None:
                datos["id"] = error.id
            raise ErrorRpc(FALLO_COMANDO, f"el comando {error.nombre} falló", datos) from error
        except ConflictoTransaccion as error:
            raise ErrorRpc(CONFLICTO_TRANSACCION, str(error)) from error
        # La notificación modelo.cambios se encola desde el hilo del bus antes de que este termine: esperar a que el
        # difusor la envíe garantiza que la respuesta llegue después.
        assert self._cola is not None
        await self._cola.join()
        return resultado

    def notificar(self, metodo: str, params: Mapping[str, Any], paquetes: Sequence[bytes] = ()) -> None:
        """Difunde una notificación (y sus paquetes detrás) a todas las sesiones autenticadas, en orden de llamada.
        Se puede llamar desde cualquier hilo; sin servidor en marcha no hace nada."""
        texto = _dumps({"jsonrpc": "2.0", "method": metodo, "params": dict(params)})
        self._encolar(self._cola_avisos, texto, list(paquetes))

    # --- conexión --------------------------------------------------------------------------------------------------

    async def _atender(self, conexion: ServerConnection) -> None:
        origenes = conexion.request.headers.get_all("Origin")
        if len(origenes) > 1 or (origenes and origenes[0] not in self._origenes):
            registro.warning("conexión rechazada: Origin no permitido (%s)", ", ".join(origenes))
            await conexion.close(CIERRE_ORIGEN, "Origin no permitido")
            return
        # Antes de autenticarse, mensajes pequeños: nadie sin token puede hacer que el kernel lea y analice 16 MiB.
        conexion.protocol.max_message_size = TAMANO_MAXIMO_AUTENTICACION
        try:
            async with asyncio.timeout(self._plazo):
                primero = await conexion.recv()
        except TimeoutError:
            registro.warning("conexión cerrada: sin autenticar en %.0f s", self._plazo)
            await conexion.close(CIERRE_NO_AUTENTICADO, "sin autenticar")
            return
        except ConnectionClosed:
            return
        sesion = Sesion(conexion)
        if not await self._autenticar(sesion, primero):
            await conexion.close(CIERRE_NO_AUTENTICADO, "no autenticado")
            return
        conexion.protocol.max_message_size = TAMANO_MAXIMO_MENSAJE
        self._sesiones.add(sesion)
        registro.info("sesión autenticada (%s)", sesion.cliente or "cliente sin nombre")
        try:
            async for mensaje in conexion:
                if not isinstance(mensaje, str):
                    await self._enviar_error(sesion, None, ErrorRpc(SOLICITUD_INVALIDA, "solicitud inválida: el kernel no acepta tramas binarias"))
                    continue
                tarea = asyncio.create_task(self._procesar(sesion, mensaje))
                sesion.solicitudes.add(tarea)
                tarea.add_done_callback(sesion.solicitudes.discard)
        except ConnectionClosed:
            pass
        finally:
            self._sesiones.discard(sesion)
            for tarea in list(sesion.solicitudes):
                tarea.cancel()
            registro.info("sesión cerrada (%s)", sesion.cliente or "cliente sin nombre")

    def _comprobar_token(self, sesion: Sesion, params: dict[str, Any]) -> dict[str, Any]:
        token = params.get("token")
        try:
            valido = isinstance(token, str) and hmac.compare_digest(token.encode("utf-8"), self._token)
        except UnicodeEncodeError:  # sustituto UTF-16 suelto: no puede ser el token
            valido = False
        if not valido:
            raise ErrorRpc(NO_AUTENTICADO, "no autenticado: token incorrecto")
        cliente = params.get("cliente")
        if isinstance(cliente, str):
            sesion.cliente = cliente[:200]
        resultado: dict[str, Any] = {"kernel": self._identidad.version, "protocolo": self._identidad.protocolo}
        if self._identidad.producto is not None:
            resultado["producto"] = self._identidad.producto
        return resultado

    async def _autenticar(self, sesion: Sesion, mensaje: Any) -> bool:
        """True si el primer mensaje autentica la sesión. Nunca lanza (salvo cancelación): cualquier fallo es un 4401."""
        try:
            return await self._autenticar_primero(sesion, mensaje)
        except asyncio.CancelledError:
            raise
        except Exception:
            registro.exception("autenticación fallida: error inesperado")
            return False

    async def _autenticar_primero(self, sesion: Sesion, mensaje: Any) -> bool:
        if not isinstance(mensaje, str):
            registro.warning("autenticación fallida: primer mensaje binario")
            return False
        try:
            solicitud = analizar(mensaje)
        except ErrorRpc as error:
            registro.warning("autenticación fallida: %s", error.mensaje)
            return False
        if solicitud.metodo != "sesion.autenticar" or solicitud.es_notificacion:
            registro.warning("autenticación fallida: el primer mensaje fue %r", solicitud.metodo)
            if not solicitud.es_notificacion:
                await self._enviar_error(sesion, solicitud.id, ErrorRpc(NO_AUTENTICADO, "no autenticado: el primer mensaje debe ser sesion.autenticar"))
            return False
        try:
            resultado = self._comprobar_token(sesion, solicitud.params)
        except ErrorRpc as error:
            registro.warning("autenticación fallida: %s", error.mensaje)
            await self._enviar_error(sesion, solicitud.id, ErrorRpc(NO_AUTENTICADO, "no autenticado"))
            return False
        await self._enviar(sesion, _dumps({"jsonrpc": "2.0", "id": solicitud.id, "result": resultado}))
        return True

    async def _procesar(self, sesion: Sesion, texto: str) -> None:
        try:
            solicitud = analizar(texto)
        except ErrorRpc as error:
            await self._enviar_error(sesion, error.id, error)
            return
        despues: Callable[[], None] | None = None
        try:
            try:
                metodo = self._metodos.get(solicitud.metodo)
                if metodo is None:
                    raise ErrorRpc(METODO_INEXISTENTE, f"método inexistente: {solicitud.metodo}")
                errores = [
                    {"ruta": "/" + "/".join(str(p) for p in e.absolute_path), "mensaje": e.message}
                    for e in self._validadores[solicitud.metodo].iter_errors(solicitud.params)
                ]
                if errores:
                    raise ErrorRpc(PARAMETROS_INVALIDOS, f"parámetros inválidos para {solicitud.metodo}", {"errores": errores})
                respuesta = await metodo.manejador(self, sesion, solicitud.params)
                despues = respuesta.despues
            except ErrorRpc as error:
                if solicitud.metodo == "sesion.autenticar" and error.codigo == NO_AUTENTICADO:
                    if not solicitud.es_notificacion:  # rpc.md §1.4: a una notificación no se responde
                        await self._enviar_error(sesion, solicitud.id, error)
                    await sesion.conexion.close(CIERRE_NO_AUTENTICADO, "no autenticado")
                    return
                if not solicitud.es_notificacion:
                    await self._enviar_error(sesion, solicitud.id, error)
                return
            except asyncio.CancelledError:
                raise
            except Exception as error:
                registro.exception("error interno en %s", solicitud.metodo)
                if not solicitud.es_notificacion:
                    await self._enviar_error(sesion, solicitud.id, ErrorRpc(ERROR_INTERNO, "error interno", {"tipo": type(error).__name__, "detalle": str(error)}))
                return
            if solicitud.es_notificacion:
                return
            try:
                texto_respuesta = _dumps({"jsonrpc": "2.0", "id": solicitud.id, "result": respuesta.resultado})
            except (TypeError, ValueError) as error:
                registro.exception("resultado no serializable en %s", solicitud.metodo)
                await self._enviar_error(sesion, solicitud.id, ErrorRpc(ERROR_INTERNO, "error interno: resultado no serializable", {"detalle": str(error)}))
                return
            await self._enviar(sesion, texto_respuesta)
            for paquete in respuesta.binarios:
                await self._enviar(sesion, paquete)
        finally:
            if despues is not None:
                try:
                    despues()
                except Exception:
                    registro.exception("falló la acción posterior a la respuesta de %s", solicitud.metodo)

    async def _enviar(self, sesion: Sesion, datos: str | bytes) -> None:
        with contextlib.suppress(ConnectionClosed):
            await sesion.conexion.send(datos)

    async def _enviar_error(self, sesion: Sesion, id_: Any, error: ErrorRpc) -> None:
        cuerpo: dict[str, Any] = {"code": error.codigo, "message": error.mensaje}
        if error.datos is not None:
            cuerpo["data"] = error.datos
        await self._enviar(sesion, _dumps({"jsonrpc": "2.0", "id": None if id_ is _SIN_ID else id_, "error": cuerpo}))

    # --- notificaciones --------------------------------------------------------------------------------------------

    def _encolar(self, cola: asyncio.Queue | None, texto: str, paquetes: list[bytes]) -> None:
        if self._bucle is None or cola is None:
            return
        try:
            self._bucle.call_soon_threadsafe(cola.put_nowait, (texto, paquetes))
        except RuntimeError:  # el bucle ya se cerró (aviso tardío de una tarea tras detener)
            registro.debug("notificación descartada: el bucle ya no existe")

    def _al_cambiar(self, evento: EventoCambios) -> None:
        """Oyente del bus (hilo del comando, con el candado del bus tomado): encola ``modelo.cambios``."""
        params: dict[str, Any] = {"transaccion": evento.transaccion, **evento.cambios.como_dict(), "modificado": evento.modificado}
        if evento.reemplazado:
            params["reemplazado"] = True
        self._encolar(self._cola, _dumps({"jsonrpc": "2.0", "method": "modelo.cambios", "params": params}), [])

    def _al_evento_tarea(self, evento: EventoTarea) -> None:
        """Oyente del gestor de tareas (hilo de la tarea): ``tarea.progreso`` o ``tarea.terminada``."""
        self.notificar("tarea.progreso" if evento.tipo == "progreso" else "tarea.terminada", evento.params)

    async def _difundir(self, cola: asyncio.Queue) -> None:
        while True:
            texto, paquetes = await cola.get()
            try:
                for sesion in list(self._sesiones):
                    await self._enviar(sesion, texto)
                    for paquete in paquetes:
                        await self._enviar(sesion, paquete)
            except Exception:  # pragma: no cover - defensa: el difusor no debe morir
                registro.exception("error al difundir una notificación")
            finally:
                cola.task_done()
