"""Tareas largas del kernel (análisis, escritura de resultados, verificación) **fuera del candado del bus**, con
progreso y cancelación cooperativa. Métodos ``tarea.*`` de ``docs/protocolo/rpc_simulate.md`` (aditivos: no suben
``protocolo``). Mismos nombres y semántica que ``covillaf.kernel.tareas`` de la ficha D-8, para que migrar sea cambiar el
import cuando DESIGN la aplique; lo único añadido es el **contexto** (ver 2).

Ciclo de una tarea:

1. `GestorTareas.iniciar` valida los argumentos con el JSON Schema de la tarea y toma una **instantánea** del modelo
   (`covillaf_sim_kernel.bus.instantanea`: con el candado y sin esperar; con un comando en curso, `ConflictoTransaccion`).
   Como los elementos son inmutables, copiar sus referencias basta para que la tarea vea un estado coherente.
2. Guarda una copia del **contexto** de quien la inicia (``contextvars.copy_context()``) y la función corre dentro de
   ella, en un **hilo propio** (daemon; a lo sumo `simultaneas` a la vez, las demás en cola FIFO): así respeta los
   ``ContextVar`` de quien llamó, p. ej. ``with usar_resolvedor("pardiso"): gestor.iniciar(...)`` — un hilo nuevo de
   Python 3.13 empieza con un contexto vacío y no los vería. La función recibe un `ContextoTarea`: lee
   ``contexto.instantanea``, informa con ``contexto.progreso(fraccion, texto)`` y comprueba la cancelación
   (``contexto.cancelada``, ``contexto.comprobar()``, ``contexto.esperar_cancelacion(plazo)``). Mientras tanto el bus
   sigue aceptando comandos: la tarea nunca toma su candado.
3. Termina en ``terminada`` (con su resultado JSON), ``fallida`` (con ``error``) o ``cancelada``. La cancelación es
   **cooperativa**: `GestorTareas.cancelar` la pide (``cancelando``) y la tarea la atiende lanzando `TareaCancelada`
   (lo hace ``comprobar()``); una que termina sin atenderla queda ``terminada``.

Los resultados son **datos derivados**: no entran en el modelo del bus, ni en deshacer, ni en el historial.

Los oyentes (`GestorTareas.suscribir`) reciben `EventoTarea` en el hilo de la tarea (o en el que canceló una en cola);
el servidor los convierte en las notificaciones ``tarea.progreso`` y ``tarea.terminada``.
"""
from __future__ import annotations

import collections
import contextvars
import json
import logging
import math
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from covillaf.core import guid as guid_ifc
from covillaf_sim_kernel.bus import PATRON_NOMBRE, BusComandos, ParametrosInvalidos, instantanea

registro = logging.getLogger("covillaf_sim_kernel.tareas")

EN_COLA = "en_cola"
EN_CURSO = "en_curso"
CANCELANDO = "cancelando"
TERMINADA = "terminada"
FALLIDA = "fallida"
CANCELADA = "cancelada"
#: Estados de los que una tarea ya no sale.
FINALES = frozenset({TERMINADA, FALLIDA, CANCELADA})

LONGITUD_MAXIMA_TEXTO = 500


# --- errores ---------------------------------------------------------------------------------------------------------


class ErrorTarea(Exception):
    """Base de los errores del gestor de tareas."""


class TareaDesconocida(ErrorTarea):
    """No hay ninguna tarea registrada con ese nombre, o ninguna tarea con ese id."""

    def __init__(self, nombre: str) -> None:
        super().__init__(f"tarea desconocida: {nombre!r}")
        self.nombre = nombre


class TareaCancelada(BaseException):
    """La lanza `ContextoTarea.comprobar` cuando se pidió cancelar. Hereda de ``BaseException`` (como
    ``asyncio.CancelledError``) para que un ``except Exception`` de la tarea no se la trague."""


# --- definiciones, eventos y contexto --------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DefinicionTarea:
    nombre: str
    descripcion: str
    parametros: Mapping[str, Any]
    funcion: FuncionTarea
    validador: Draft202012Validator


@dataclass(frozen=True, slots=True)
class EventoTarea:
    """``tipo`` = ``"progreso"`` (``params`` = ``{id, texto, fraccion}``) o ``"terminada"`` (``params`` = ``{id,
    nombre, estado, resultado?, error?}``): los ``params`` de las notificaciones ``tarea.progreso``/``tarea.terminada``."""

    tipo: str
    params: Mapping[str, Any]


@dataclass(eq=False, slots=True)
class _Registro:
    id: str
    definicion: DefinicionTarea
    args: dict[str, Any]
    instantanea: Mapping[str, Any]
    contexto: contextvars.Context
    retenida: bool
    estado: str = EN_COLA
    texto: str = ""
    fraccion: float | None = None
    resultado: Any = None
    error: dict[str, Any] | None = None
    cancelar: threading.Event = field(default_factory=threading.Event)
    fin: threading.Event = field(default_factory=threading.Event)
    hilo: threading.Thread | None = None
    ultimo_aviso: float | None = None
    ultimo_texto: str | None = None
    ultima_fraccion: float | None = None


class ContextoTarea:
    """Lo que recibe la función de una tarea (además de sus argumentos)."""

    def __init__(self, gestor: GestorTareas, registro_tarea: _Registro) -> None:
        self._gestor = gestor
        self._registro = registro_tarea

    @property
    def id(self) -> str:
        return self._registro.id

    @property
    def nombre(self) -> str:
        return self._registro.definicion.nombre

    @property
    def instantanea(self) -> Mapping[str, Any]:
        """Modelo (GUID → elemento inmutable) tal como estaba al iniciar la tarea."""
        return self._registro.instantanea

    @property
    def cancelada(self) -> bool:
        """Se pidió cancelar la tarea."""
        return self._registro.cancelar.is_set()

    def comprobar(self) -> None:
        """Lanza `TareaCancelada` si se pidió cancelar (llamarla entre fases y a menudo en los bucles largos)."""
        if self._registro.cancelar.is_set():
            raise TareaCancelada()

    def esperar_cancelacion(self, plazo: float | None) -> bool:
        """Espera hasta `plazo` segundos a que se pida cancelar; True si se pidió (útil al vigilar un proceso hijo)."""
        return self._registro.cancelar.wait(plazo)

    def progreso(self, fraccion: float | None = None, texto: str = "") -> None:
        """Informa del avance: `fraccion` en [0, 1] (se recorta; None o no finita = indeterminado) y un texto corto.
        Los avisos se regulan (como mucho uno cada `GestorTareas.intervalo_progreso` s salvo que cambie el texto, pase
        a indeterminado o llegue a 1)."""
        self._gestor._progreso(self._registro, fraccion, texto)


FuncionTarea = Callable[[ContextoTarea, dict[str, Any]], Any]
OyenteTarea = Callable[[EventoTarea], None]


def _normalizar_fraccion(fraccion: float | None) -> float | None:
    if fraccion is None or isinstance(fraccion, bool):
        return None
    try:
        valor = float(fraccion)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(valor):
        return None
    return min(1.0, max(0.0, valor))


def _copia_json(valor: Any) -> Any:
    """Copia JSON estricta (sin NaN ni infinitos); TypeError/ValueError si el valor no es JSON."""
    return json.loads(json.dumps(valor, ensure_ascii=False, allow_nan=False))


#: Elementos como mucho en cualquier lista de los argumentos de una tarea (se comprueba antes del JSON Schema).
LIMITE_LISTA = 1000


#: Nodos JSON (valores, listas y objetos) como mucho en los argumentos de una tarea: con más, se rechazan sin validar.
LIMITE_NODOS = 100_000


def _lista_larga(valor: Any, limite: int) -> str | None:
    """Ruta JSON de la primera lista con más de `limite` elementos, o ``"/"`` si los argumentos tienen más de
    `LIMITE_NODOS` nodos (recorrido iterativo en anchura; sin este tope se podía esconder una lista larga detrás de
    muchos valores de relleno: auditoría del commit 6fc4e37, M3)."""
    pendientes: collections.deque[tuple[Any, str]] = collections.deque([(valor, "/")])
    vistos = 0
    while pendientes:
        vistos += 1
        if vistos > LIMITE_NODOS:
            return "/"
        actual, donde = pendientes.popleft()
        if isinstance(actual, list):
            if len(actual) > limite:
                return donde
            pendientes.extend((v, f"{donde.rstrip('/')}/{k}") for k, v in enumerate(actual))
        elif isinstance(actual, dict):
            pendientes.extend((v, f"{donde.rstrip('/')}/{k}") for k, v in actual.items())
    return None


def _texto_o_none(valor: object) -> str | None:
    return valor if isinstance(valor, str) and valor else None


# --- gestor ----------------------------------------------------------------------------------------------------------


class GestorTareas:
    """Registro de tipos de tarea + cola + hilos. Seguro entre hilos (un candado propio, distinto del del bus).

    `bus`: de dónde se toma la instantánea (None: tareas que no leen el modelo). `simultaneas`: tareas en curso a la
    vez (las demás, en cola). `conservar`: cuántas tareas terminadas se recuerdan para `estado` (las más antiguas se
    olvidan). `intervalo_progreso`: segundos mínimos entre avisos de progreso de una tarea (regulación).
    """

    def __init__(
        self, bus: BusComandos | None = None, *, simultaneas: int = 1, conservar: int = 100, intervalo_progreso: float = 0.1
    ) -> None:
        if simultaneas < 1:
            raise ValueError("simultaneas debe ser al menos 1")
        if conservar < 0 or intervalo_progreso < 0:
            raise ValueError("conservar e intervalo_progreso no pueden ser negativos")
        self._bus = bus
        self.simultaneas = simultaneas
        self.conservar = conservar
        self.intervalo_progreso = intervalo_progreso
        self._definiciones: dict[str, DefinicionTarea] = {}
        self._tareas: dict[str, _Registro] = {}
        self._cola: collections.deque[_Registro] = collections.deque()
        self._terminadas: collections.deque[str] = collections.deque()
        self._en_curso = 0
        self._oyentes: list[OyenteTarea] = []
        self._candado = threading.Lock()
        self._cerrado = False

    # registro

    def registrar(self, nombre: str, descripcion: str, parametros: Mapping[str, Any]) -> Callable[[FuncionTarea], FuncionTarea]:
        """Decorador: registra `funcion(contexto, args)` como la tarea `nombre` (mismas reglas de nombre y esquema que
        `BusComandos.registrar`). Lo que devuelve la función es el resultado de la tarea (debe ser JSON)."""
        if not PATRON_NOMBRE.fullmatch(nombre):
            raise ValueError(f"nombre de tarea no válido (espacio.accion en minúsculas): {nombre!r}")
        if nombre in self._definiciones:
            raise ValueError(f"tarea ya registrada: {nombre}")
        if parametros.get("type") != "object":
            raise ValueError(f"{nombre}: el esquema de parámetros debe ser de tipo object")
        try:
            Draft202012Validator.check_schema(parametros)
        except SchemaError as error:
            raise ValueError(f"{nombre}: esquema de parámetros no válido: {error.message}") from error

        def decorador(funcion: FuncionTarea) -> FuncionTarea:
            self._definiciones[nombre] = DefinicionTarea(nombre, descripcion, parametros, funcion, Draft202012Validator(parametros))
            return funcion

        return decorador

    def listar(self) -> list[dict[str, Any]]:
        """``[{nombre, descripcion, parametros}]`` de los tipos de tarea, por nombre (como ``comando.listar``)."""
        return [
            {"nombre": d.nombre, "descripcion": d.descripcion, "parametros": dict(d.parametros)}
            for d in sorted(self._definiciones.values(), key=lambda d: d.nombre)
        ]

    def nombres(self) -> frozenset[str]:
        return frozenset(self._definiciones)

    def suscribir(self, oyente: OyenteTarea) -> Callable[[], None]:
        """Añade un oyente de `EventoTarea`; devuelve la función que lo quita."""
        with self._candado:
            self._oyentes.append(oyente)

        def baja() -> None:
            with self._candado:
                if oyente in self._oyentes:
                    self._oyentes.remove(oyente)

        return baja

    # ciclo de vida

    def validar(self, nombre: str, args: Any = None) -> None:
        """Comprueba el nombre y los argumentos (JSON Schema de la tarea) sin iniciar nada: `TareaDesconocida`,
        `ParametrosInvalidos`. Puede tardar con argumentos grandes: el servidor la llama en un hilo."""
        definicion = self._definiciones.get(nombre)
        if definicion is None:
            raise TareaDesconocida(nombre)
        args = {} if args is None else args
        # jsonschema evalúa `uniqueItems` (cuadrático con tipos mezclados) aunque `maxItems` ya haya fallado: las listas
        # largas se rechazan antes, en tiempo lineal (auditoría del commit a32e22f, B-MEDIA-1).
        larga = _lista_larga(args, LIMITE_LISTA)
        if larga is not None:
            mensaje = f"más de {LIMITE_NODOS} valores en los argumentos" if larga == "/" else f"más de {LIMITE_LISTA} elementos"
            raise ParametrosInvalidos(nombre, [{"ruta": larga, "mensaje": mensaje}])
        try:
            errores = [
                {"ruta": "/" + "/".join(str(p) for p in e.absolute_path), "mensaje": e.message}
                for e in sorted(definicion.validador.iter_errors(args), key=lambda e: list(map(str, e.absolute_path)))
            ]
        except RecursionError:  # anidamiento excesivo dentro de los argumentos (B-BAJA-4)
            errores = [{"ruta": "/", "mensaje": "anidamiento excesivo"}]
        if errores:
            raise ParametrosInvalidos(nombre, errores)

    def iniciar(self, nombre: str, args: Any = None, *, retenida: bool = False, validados: bool = False) -> str:
        """Valida (salvo `validados`: ya lo hizo `validar`), toma la instantánea y el contexto de quien llama y encola
        la tarea; devuelve su id (IFC GlobalId). `retenida`: no arranca hasta `liberar` (el servidor la retiene hasta
        haber enviado la respuesta con el id, así ``tarea.progreso`` nunca llega antes). Errores: `TareaDesconocida`,
        `ParametrosInvalidos`, `ConflictoTransaccion` (comando en curso), `ErrorTarea` (gestor cerrado)."""
        args = {} if args is None else args
        definicion = self._definiciones.get(nombre)
        if definicion is None:
            raise TareaDesconocida(nombre)
        if not validados:
            self.validar(nombre, args)
        foto = instantanea(self._bus) if self._bus is not None else MappingProxyType({})
        registro_tarea = _Registro(guid_ifc.nuevo(), definicion, args, foto, contextvars.copy_context(), retenida)
        with self._candado:
            if self._cerrado:
                raise ErrorTarea("el gestor de tareas está cerrado")
            self._tareas[registro_tarea.id] = registro_tarea
            self._cola.append(registro_tarea)
            self._arrancar_siguientes()
        registro.info("tarea %s (%s) en cola%s", registro_tarea.id, nombre, " (retenida)" if retenida else "")
        return registro_tarea.id

    def liberar(self, id_tarea: str) -> None:
        """Deja arrancar una tarea iniciada con ``retenida=True`` (sin efecto si ya no está en cola)."""
        with self._candado:
            registro_tarea = self._tareas.get(id_tarea)
            if registro_tarea is not None:
                registro_tarea.retenida = False
                self._arrancar_siguientes()

    def estado(self, id_tarea: str) -> dict[str, Any]:
        """``{id, nombre, estado, texto, fraccion}`` más ``resultado`` (terminada) o ``error`` (fallida)."""
        with self._candado:
            registro_tarea = self._tareas.get(id_tarea)
            if registro_tarea is None:
                raise TareaDesconocida(id_tarea)
            return self._foto(registro_tarea)

    def activas(self) -> list[dict[str, Any]]:
        """`estado` de las tareas en cola, en curso o cancelándose, por orden de inicio (una interfaz recargada
        recupera así las que siguen vivas: ``tarea.activas``)."""
        with self._candado:
            return [self._foto(r) for r in self._tareas.values() if r.estado not in FINALES]

    def cancelar(self, id_tarea: str) -> dict[str, Any]:
        """Pide cancelar: en cola ⇒ ``cancelada`` al momento (con su aviso); en curso ⇒ ``cancelando`` hasta que la
        tarea lo atienda; terminada ⇒ nada (idempotente). Devuelve ``{id, estado}``."""
        cerradas: list[tuple[_Registro, EventoTarea]] = []
        with self._candado:
            registro_tarea = self._tareas.get(id_tarea)
            if registro_tarea is None:
                raise TareaDesconocida(id_tarea)
            if registro_tarea.estado == EN_COLA:
                self._cola.remove(registro_tarea)
                registro_tarea.cancelar.set()
                cerradas.append((registro_tarea, self._cerrar_registro(registro_tarea, CANCELADA, None, None)))
            elif registro_tarea.estado == EN_CURSO:
                registro_tarea.estado = CANCELANDO
                registro_tarea.cancelar.set()
            estado = registro_tarea.estado
        for registro_tarea, evento in cerradas:
            self._publicar_fin(registro_tarea, evento)
        return {"id": id_tarea, "estado": estado}

    def esperar(self, id_tarea: str, plazo: float | None = None) -> dict[str, Any]:
        """Espera a que la tarea termine (hasta `plazo` s) y devuelve su `estado`; TimeoutError si no terminó."""
        with self._candado:
            registro_tarea = self._tareas.get(id_tarea)
        if registro_tarea is None:
            raise TareaDesconocida(id_tarea)
        if not registro_tarea.fin.wait(plazo):
            raise TimeoutError(f"la tarea {id_tarea} no terminó en {plazo} s")
        with self._candado:
            return self._foto(registro_tarea)

    def cerrar(self, plazo: float = 5.0) -> bool:
        """Cancela todo (las de la cola al momento; las en curso, pidiéndolo), no admite más y espera hasta `plazo` s
        a que las en curso terminen. True si no queda ninguna viva."""
        cerradas: list[tuple[_Registro, EventoTarea]] = []
        with self._candado:
            self._cerrado = True
            while self._cola:
                registro_tarea = self._cola.popleft()
                registro_tarea.cancelar.set()
                cerradas.append((registro_tarea, self._cerrar_registro(registro_tarea, CANCELADA, None, None)))
            vivas = [r for r in self._tareas.values() if r.estado in (EN_CURSO, CANCELANDO)]
            for registro_tarea in vivas:
                registro_tarea.estado = CANCELANDO
                registro_tarea.cancelar.set()
        for registro_tarea, evento in cerradas:
            self._publicar_fin(registro_tarea, evento)
        limite = time.monotonic() + plazo
        for registro_tarea in vivas:
            if not registro_tarea.fin.wait(max(0.0, limite - time.monotonic())):
                registro.warning("la tarea %s (%s) no atendió la cancelación en %.1f s", registro_tarea.id, registro_tarea.definicion.nombre, plazo)
        return all(r.fin.is_set() for r in vivas)

    # interno (con el candado del gestor salvo que se diga)

    def _foto(self, r: _Registro) -> dict[str, Any]:
        foto: dict[str, Any] = {"id": r.id, "nombre": r.definicion.nombre, "estado": r.estado, "texto": r.texto, "fraccion": r.fraccion}
        if r.estado == TERMINADA:
            foto["resultado"] = r.resultado
        if r.estado == FALLIDA and r.error is not None:
            foto["error"] = dict(r.error)
        return foto

    def _arrancar_siguientes(self) -> None:
        while self._en_curso < self.simultaneas and not self._cerrado:
            siguiente = next((r for r in self._cola if not r.retenida), None)
            if siguiente is None:
                return
            self._cola.remove(siguiente)
            siguiente.estado = EN_CURSO
            self._en_curso += 1
            # La función corre DENTRO del contexto copiado al iniciar (ContextVar de quien la lanzó, p. ej. el
            # resolvedor lineal de `usar_resolvedor`): un hilo nuevo no lo heredaría.
            siguiente.hilo = threading.Thread(
                target=siguiente.contexto.run, args=(self._correr, siguiente), name=f"tarea-{siguiente.definicion.nombre}", daemon=True
            )
            siguiente.hilo.start()

    def _cerrar_registro(self, r: _Registro, estado: str, resultado: Any, error: dict[str, Any] | None) -> EventoTarea:
        r.estado = estado
        r.resultado = resultado if estado == TERMINADA else None
        r.error = error if estado == FALLIDA else None
        # Lo que ya no hace falta no se retiene mientras se conserva el registro (`conservar` tareas): la instantánea
        # puede ser un modelo de decenas de MB (auditoría del kernel, MEDIA-3).
        r.instantanea, r.args, r.contexto = MappingProxyType({}), {}, contextvars.Context()
        self._terminadas.append(r.id)
        while len(self._terminadas) > self.conservar:
            self._tareas.pop(self._terminadas.popleft(), None)
        params: dict[str, Any] = {"id": r.id, "nombre": r.definicion.nombre, "estado": estado}
        if estado == TERMINADA:
            params["resultado"] = r.resultado
        if estado == FALLIDA and r.error is not None:
            params["error"] = dict(r.error)
        return EventoTarea("terminada", MappingProxyType(params))

    def _correr(self, r: _Registro) -> None:
        """Hilo de la tarea (sin ningún candado tomado mientras corre la función)."""
        # Por defecto «fallida»: si la función sale con una BaseException (p. ej. SystemExit), el registro nunca se
        # queda «en curso» (el `finally` lo cierra) y la excepción sigue su camino.
        estado, resultado, error = FALLIDA, None, {"detalle": "la tarea se interrumpió", "clave": "interrumpida"}
        inicio = time.monotonic()
        try:
            valor = r.definicion.funcion(ContextoTarea(self, r), r.args)
            try:
                estado, resultado, error = TERMINADA, _copia_json(valor), None
            except (TypeError, ValueError) as fallo:
                error = {"detalle": f"resultado no serializable en JSON: {fallo}", "clave": "resultado_no_json"}
        except TareaCancelada:
            estado, error = CANCELADA, None
        except Exception as fallo:
            error = {"detalle": str(fallo) or type(fallo).__name__}
            clave, id_entidad = _texto_o_none(getattr(fallo, "clave", None)), _texto_o_none(getattr(fallo, "id", None))
            if clave is not None:
                error["clave"] = clave
            if id_entidad is not None:
                error["id"] = id_entidad
            registro.warning("tarea %s (%s) fallida: %s", r.id, r.definicion.nombre, error["detalle"])
        finally:
            with self._candado:
                self._en_curso -= 1
                evento = self._cerrar_registro(r, estado, resultado, error)
                self._arrancar_siguientes()
            registro.info("tarea %s (%s) %s en %.2f s", r.id, r.definicion.nombre, estado, time.monotonic() - inicio)
            self._publicar_fin(r, evento)

    def _progreso(self, r: _Registro, fraccion: float | None, texto: str) -> None:
        fraccion = _normalizar_fraccion(fraccion)
        texto = str(texto)[:LONGITUD_MAXIMA_TEXTO]
        ahora = time.monotonic()
        with self._candado:
            if r.estado not in (EN_CURSO, CANCELANDO):
                return
            r.fraccion, r.texto = fraccion, texto
            avisar = (
                r.ultimo_aviso is None
                or texto != r.ultimo_texto
                or (fraccion is None) != (r.ultima_fraccion is None)
                or (fraccion is not None and fraccion >= 1.0 and r.ultima_fraccion != fraccion)
                or ahora - r.ultimo_aviso >= self.intervalo_progreso
            )
            if not avisar:
                return
            r.ultimo_aviso, r.ultimo_texto, r.ultima_fraccion = ahora, texto, fraccion
        self._avisar(EventoTarea("progreso", MappingProxyType({"id": r.id, "texto": texto, "fraccion": fraccion})))

    def _publicar_fin(self, r: _Registro, evento: EventoTarea) -> None:
        """Sin el candado: avisa de ``terminada`` y **después** marca `fin` (quien vuelve de `esperar` o `cerrar` sabe
        que los oyentes ya recibieron el aviso)."""
        try:
            self._avisar(evento)
        finally:
            r.fin.set()

    def _avisar(self, evento: EventoTarea) -> None:
        """Sin el candado del gestor (un oyente puede consultar el estado)."""
        with self._candado:
            oyentes = list(self._oyentes)
        for oyente in oyentes:
            try:
                oyente(evento)
            except Exception:
                registro.exception("un oyente de tareas falló (%s %s)", evento.tipo, evento.params.get("id"))
