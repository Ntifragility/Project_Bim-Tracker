"""Montaje del kernel de SIMULATE: bus con los comandos del modelo, gestor de tareas con los análisis, estado y la
identidad del servidor. Es también la **API Python** del kernel (H-04: los mismos nombres que por RPC)::

    from covillaf_sim_kernel.kernel import crear_kernel
    from covillaf.sim.solver import usar_resolvedor

    k = crear_kernel()
    k.ejecutar("modelo.importar_vyba", {"ruta": r"…\\portico.vyba"})
    with usar_resolvedor("pardiso"):                       # la tarea corre en una copia de este contexto
        id_tarea = k.iniciar("analisis.estatico")
    print(k.esperar(id_tarea, 60)["resultado"]["casos"])
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import platform
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from covillaf_sim_kernel import ORIGEN_APP, PRODUCTO, PROTOCOLO, __version__
from covillaf_sim_kernel.bus import HUELLA_DESIGN, BusComandos, ResultadoComando, huella_design
from covillaf_sim_kernel.comandos_modelo import registrar_comandos_modelo
from covillaf_sim_kernel.estado import EstadoKernel
from covillaf_sim_kernel.metodos_resultados import metodos_resultados
from covillaf_sim_kernel.servidor import PLAZO_AUTENTICACION, Identidad, ServidorKernel, metodos_basicos
from covillaf_sim_kernel.tareas import GestorTareas
from covillaf_sim_kernel.tareas_analisis import registrar_tareas_analisis

_DISTRIBUCIONES = ("numpy", "scipy", "ifcopenshell", "h5py", "websockets")
_PAQUETES_SIM = ("modelo", "malla", "resultados", "io", "solver", "kernel")


def versiones_motores() -> dict[str, Any]:
    """Campos de ``sistema.version`` propios de SIMULATE: Python, bibliotecas numéricas y de formatos, MKL (PARDISO)
    y si el bus de DESIGN sigue siendo el de la huella (``bus_design``: ``coincide`` | ``cambiado``)."""
    versiones: dict[str, Any] = {"python": platform.python_version()}
    for nombre in _DISTRIBUCIONES:
        try:
            versiones[nombre] = importlib.metadata.version(nombre)
        except importlib.metadata.PackageNotFoundError:
            versiones[nombre] = None
    try:
        from covillaf.sim.solver.lineal import pardiso_disponible, version_mkl

        versiones["mkl"] = version_mkl() if pardiso_disponible() else None
    except Exception:  # sin MKL el kernel funciona con SuperLU: no es un error de sistema.version
        versiones["mkl"] = None
    try:
        versiones["bus_design"] = "coincide" if huella_design() == dict(HUELLA_DESIGN) else "cambiado"
    except (OSError, ValueError):
        versiones["bus_design"] = "cambiado"
    versiones["covillaf_sim"] = {}
    for paquete in _PAQUETES_SIM:
        try:
            versiones["covillaf_sim"][paquete] = importlib.metadata.version(f"covillaf-sim-{paquete}")
        except importlib.metadata.PackageNotFoundError:
            versiones["covillaf_sim"][paquete] = None
    versiones["motor"] = huella_motor()
    return versiones


def huella_motor() -> str | None:
    """sha256 (16 cifras) de las fuentes de `covillaf.sim.solver`: con la instalación editable la versión no cambia al
    tocar el código, la huella sí (la interfaz puede avisar de que los resultados guardados son de otro motor)."""
    try:
        import covillaf.sim.solver as solver

        suma = hashlib.sha256()
        for archivo in sorted(Path(solver.__file__).parent.glob("*.py")):
            suma.update(archivo.name.encode("utf-8") + b"\0" + archivo.read_bytes().replace(b"\r\n", b"\n"))
        return suma.hexdigest()[:16]
    except (ImportError, OSError):
        return None


#: Identidad del kernel en el cable: ``producto`` en «listo», ``sesion.autenticar`` y ``sistema.version``; ``Origin``
#: fijo solo ``app://covillaf-simulate`` (``app://covillaf`` es de DESIGN y se rechaza con 4403).
IDENTIDAD = Identidad(
    version=__version__, protocolo=PROTOCOLO, producto=PRODUCTO, origenes=frozenset({ORIGEN_APP}), versiones=versiones_motores
)


@dataclass(frozen=True, eq=False, slots=True)
class Kernel:
    """Bus (comandos del modelo), gestor de tareas (análisis) y estado (archivo y resultados)."""

    bus: BusComandos
    tareas: GestorTareas
    estado: EstadoKernel

    def ejecutar(self, nombre: str, args: dict[str, Any] | None = None) -> ResultadoComando:
        """Comando del bus (lo mismo que ``comando.ejecutar``)."""
        return self.bus.ejecutar(nombre, args)

    def inici
    ar(self, nombre: str, args: dict[str, Any] | None = None) -> str:
        """Tarea (lo mismo que ``tarea.iniciar``); corre en una copia del contexto de quien llama."""
        return self.tareas.iniciar(nombre, args)

    def esperar(self, id_tarea: str, plazo: float | None = None) -> dict[str, Any]:
        """Espera a la tarea y devuelve su estado (``tarea.estado``)."""
        return self.tareas.esperar(id_tarea, plazo)


def crear_kernel(*, simultaneas: int = 1, intervalo_progreso: float = 0.1) -> Kernel:
    """Kernel completo. `simultaneas`: tareas en curso a la vez (1: los análisis se encolan; el motor ya usa varios
    núcleos en PARDISO y LAPACK)."""
    bus = BusComandos()
    estado = EstadoKernel()
    registrar_comandos_modelo(bus, estado)
    tareas = GestorTareas(bus, simultaneas=simultaneas, intervalo_progreso=intervalo_progreso)
    registrar_tareas_analisis(tareas, estado)
    repetidos = {c["nombre"] for c in bus.listar()} & tareas.nombres()
    if repetidos:
        raise ValueError(f"nombres a la vez de comando y de tarea: {sorted(repetidos)}")
    return Kernel(bus, tareas, estado)


def crear_servidor(
    token: str, origenes_extra: Iterable[str] = (), *, kernel: Kernel | None = None, plazo_autenticacion: float = PLAZO_AUTENTICACION
) -> ServidorKernel:
    """Servidor del kernel (el que arranca ``python -m covillaf_sim_kernel``) sobre `kernel` (uno nuevo si falta)."""
    kernel = kernel if kernel is not None else crear_kernel()
    metodos = metodos_basicos(tareas=True) | metodos_resultados(kernel.bus, kernel.estado)
    return ServidorKernel(
        token, kernel.bus, identidad=IDENTIDAD, metodos=metodos, tareas=kernel.tareas, origenes_extra=origenes_extra,
        plazo_autenticacion=plazo_autenticacion,
    )  # fmt: skip
