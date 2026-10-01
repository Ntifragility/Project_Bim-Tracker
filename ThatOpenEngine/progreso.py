"""Progreso y cancelación del motor (pedido del kernel, F0-24).

`analizar_estatico` y `analizar_modal` aceptan ``progreso``: una función ``progreso(fraccion, texto)`` que el motor
llama al empezar cada fase y a menudo dentro de los bucles largos (preparar y ensamblar barras, recuperar esfuerzos,
cada producto del Lanczos). ``fraccion`` va de 0 a 1 y nunca retrocede; ``texto`` es corto y **no cambia dentro de una
fase** (así el que escucha puede regular los avisos por tiempo). Los pesos de las fases son **nominales** (estimados,
no medidos en cada modelo): la fracción orienta, no predice el tiempo que falta.

**Cancelación.** Si ``progreso`` lanza una excepción, el motor deja de trabajar y la propaga **sin tocarla** (el
kernel lanza ``TareaCancelada``, que hereda de ``BaseException``), después de liberar la factorización que tuviera
abierta. Una llamada a una biblioteca compilada (la factorización de SuperLU o PARDISO, una inercia de Sturm) no se
interrumpe: la cancelación se atiende al volver de ella.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping

#: ``progreso(fraccion, texto)``: fracción en [0, 1], texto de la fase.
InformeProgreso = Callable[[float, str], None]

#: Avisos por fase como mucho (dentro de un bucle): basta para una barra de progreso fluida.
AVISOS_POR_FASE = 100


class Avance:
    """Reparte [0, 1] entre fases con pesos nominales y avisa a ``informe`` (nada si es None).

    ``fase(nombre, texto)`` abre una fase (aviso en su inicio); ``paso(hecho, total)`` avisa del avance dentro de ella
    (como mucho `AVISOS_POR_FASE` veces por fase); ``pulso()`` repite el último aviso (punto de cancelación en bucles
    sin total conocido, p. ej. los productos del Lanczos); ``fin(texto)`` avisa con 1.
    """

    def __init__(self, informe: InformeProgreso | None, pesos: Mapping[str, float]) -> None:
        if any(p < 0.0 for p in pesos.values()):
            raise ValueError("los pesos de las fases no pueden ser negativos")
        total = float(sum(pesos.values())) or 1.0
        self._informe = informe
        self._inicios: dict[str, float] = {}
        acumulado = 0.0
        for nombre, peso in pesos.items():
            self._inicios[nombre] = acumulado / total
            acumulado += peso
        self._anchos = {nombre: peso / total for nombre, peso in pesos.items()}
        self._inicio, self._ancho, self._texto = 0.0, 0.0, ""
        self._ultima = 0.0
        self._siguiente = 0

    @property
    def activo(self) -> bool:
        return self._informe is not None

    def _avisar(self, fraccion: float) -> None:
        self._ultima = max(self._ultima, min(1.0, fraccion))
        if self._informe is not None:
            self._informe(self._ultima, self._texto)

    def fase(self, nombre: str, texto: str) -> None:
        self._inicio, self._ancho, self._texto = self._inicios[nombre], self._anchos[nombre], texto
        self._siguiente = 0
        self._avisar(self._inicio)

    def paso(self, hecho: int, total: int) -> None:
        """Avance ``hecho``/``total`` dentro de la fase (llamarlo en cada vuelta: solo avisa cada ~1 %)."""
        if self._informe is None or hecho < self._siguiente or total <= 0:
            return
        self._siguiente = hecho + max(1, total // AVISOS_POR_FASE)
        self._avisar(self._inicio + self._ancho * min(hecho, total) / total)

    def pulso(self) -> None:
        if self._informe is not None:
            self._avisar(self._ultima)

    def fin(self, texto: str) -> None:
        self._texto = texto
        self._avisar(1.0)
