"""Trama binaria VYBF v1: un campo de resultados del kernel al visor (``docs/formatos/trama_vybf.md``, F0-25, F0-35).

Little-endian. Cabecera de 64 bytes, después (según las banderas) los valores de paso (float64), el rango por paso y
componente (float32) y los valores (float32, orden [paso][valor][componente]). El visor solo dibuja: los valores ya
vienen interpolados por el kernel en los vértices o triángulos de un VYBM ya enviado, en las estaciones de las barras o
en los nudos de la geometría analítica (``resultados.geometria``).

`decodificar` aplica las mismas reglas de rechazo que el decodificador TypeScript del visor (`packages/viewer`).
"""
from __future__ import annotations

import re
import struct
from dataclasses import dataclass

import numpy as np

MAGIA = b"VYBF"
VERSION = 1
CABECERA = struct.Struct("<4sHHI24sIBBHIII8s")
assert CABECERA.size == 64

#: Banderas: bit0 rango por paso y componente · bit2 valores de paso. bit1 (valores cuantizados u16) queda reservado
#: en v1 y se rechaza, como los bits 3–15.
RANGO, CUANTIZADO, VALORES_PASO = 1, 2, 4
BANDERAS_V1 = RANGO | VALORES_PASO

#: Ubicación de los valores.
VERTICE, TRIANGULO, ESTACION, NUDO = 1, 2, 3, 4
UBICACIONES = {VERTICE: "vertice", TRIANGULO: "triangulo", ESTACION: "estacion", NUDO: "nudo"}

#: Magnitud → (componentes, unidad). La unidad viaja en la trama para depurar y debe corresponder a la magnitud.
MAGNITUDES: dict[int, tuple[int, str]] = {
    1: (3, "mm"),  # desplazamiento (ejes globales)
    2: (3, "rad"),  # giro (ejes globales)
    3: (3, "1"),  # forma modal (ejes globales, φᵀMφ = 1: la escala la pone el visor)
    10: (1, "N"),  # N
    11: (1, "N"),  # Vy
    12: (1, "N"),  # Vz
    13: (1, "N.mm"),  # T
    14: (1, "N.mm"),  # My
    15: (1, "N.mm"),  # Mz
    16: (6, "N;N.mm"),  # esfuerzos N, Vy, Vz, T, My, Mz (ejes locales de la barra)
    17: (6, "N;N.mm"),  # reacción Fx, Fy, Fz, Mx, My, Mz (ejes globales)
    20: (1, "MPa"),  # tensión de von Mises
    30: (1, "1"),  # ratio demanda/capacidad
    40: (1, "C"),  # temperatura
}
DESPLAZAMIENTO, FORMA_MODAL, ESFUERZOS = 1, 3, 16

_GUID = re.compile(r"[0-9A-Za-z_$]{22}")


class ErrorVybf(ValueError):
    """Trama VYBF mal formada."""


@dataclass(frozen=True, eq=False)
class Trama:
    lote: int
    guid: str
    referencia: int  # lote del VYBM (ubicación 1, 2) o `revision` de la geometría analítica (3, 4)
    ubicacion: int
    magnitud: int
    unidad: str
    valores: np.ndarray  # (n_pasos, n_valores, componentes) float32
    rango: np.ndarray | None  # (n_pasos, componentes, 2) float32: mínimo y máximo
    valores_paso: np.ndarray | None  # (n_pasos,) float64


def codificar(
    lote: int, guid: str, referencia: int, ubicacion: int, magnitud: int, valores: np.ndarray, valores_paso=None
) -> bytes:
    """Trama VYBF de `valores` (n_pasos, n_valores, componentes), siempre con el rango de cada paso y componente."""
    if magnitud not in MAGNITUDES:
        raise ErrorVybf(f"magnitud desconocida: {magnitud}")
    componentes, unidad = MAGNITUDES[magnitud]
    if ubicacion not in UBICACIONES:
        raise ErrorVybf(f"ubicación desconocida: {ubicacion}")
    if not _GUID.fullmatch(guid):
        raise ErrorVybf(f"GUID IFC no válido: {guid!r}")
    if not (0 < lote < 2**32 and 0 <= referencia < 2**32):
        raise ErrorVybf("lote fuera de 1…2³²−1 o referencia fuera de u32")
    v = np.asarray(valores, dtype=np.float64)
    if v.ndim == 2:
        v = v[None]
    if v.ndim != 3 or v.shape[2] != componentes or v.shape[0] < 1:
        raise ErrorVybf(f"valores de forma {v.shape}: se esperaba (n_pasos ≥ 1, n_valores, {componentes})")
    v32 = v.astype(np.float32)
    if not np.isfinite(v32).all():
        raise ErrorVybf("valores no finitos (o fuera del rango de float32)")
    n_pasos, n_valores = v.shape[:2]
    banderas = RANGO
    cuerpo = []
    if valores_paso is not None:
        p = np.asarray(valores_paso, dtype="<f8").reshape(-1)
        if p.size != n_pasos or not np.isfinite(p).all():
            raise ErrorVybf("valores de paso: uno finito por paso")
        banderas |= VALORES_PASO
        cuerpo.append(p.tobytes())
    if n_valores:
        rango = np.stack([v32.min(axis=1), v32.max(axis=1)], axis=-1)  # (n_pasos, componentes, 2)
    else:
        rango = np.zeros((n_pasos, componentes, 2), dtype=np.float32)
    cuerpo += [rango.astype("<f4").tobytes(), v32.astype("<f4").tobytes()]
    cabecera = CABECERA.pack(MAGIA, VERSION, banderas, lote, guid.encode("ascii") + b"\0\0", referencia, ubicacion,
                             componentes, magnitud, n_valores, n_pasos, 0, unidad.encode("ascii").ljust(8, b"\0"))  # fmt: skip
    return cabecera + b"".join(cuerpo)


def decodificar(datos: bytes) -> Trama:
    """Lee una trama y aplica las reglas de rechazo de la especificación (§4)."""
    if len(datos) < CABECERA.size:
        raise ErrorVybf(f"trama corta: {len(datos)} bytes")
    (magia, version, banderas, lote, guid, referencia, ubicacion, componentes, magnitud, n_valores, n_pasos, reservado,
     unidad) = CABECERA.unpack_from(datos)  # fmt: skip
    if magia != MAGIA or version != VERSION:
        raise ErrorVybf(f"no es VYBF v1 (magia {magia!r}, versión {version})")
    if banderas & ~BANDERAS_V1:
        raise ErrorVybf(f"banderas desconocidas o reservadas: {banderas:#06x}")
    if not banderas & RANGO:
        raise ErrorVybf("falta el rango (bit0 obligatorio en v1)")
    if reservado != 0 or guid[22:] != b"\0\0":
        raise ErrorVybf("reservado o relleno del GUID distinto de cero")
    try:
        texto_guid = guid[:22].decode("ascii")
    except UnicodeDecodeError as error:
        raise ErrorVybf("GUID no ASCII") from error
    if not _GUID.fullmatch(texto_guid):
        raise ErrorVybf(f"GUID fuera del alfabeto IFC: {texto_guid!r}")
    if lote == 0:
        raise ErrorVybf("lote 0")
    if ubicacion not in UBICACIONES:
        raise ErrorVybf(f"ubicación desconocida: {ubicacion}")
    if magnitud not in MAGNITUDES:
        raise ErrorVybf(f"magnitud desconocida: {magnitud}")
    esperadas, unidad_magnitud = MAGNITUDES[magnitud]
    if componentes != esperadas:
        raise ErrorVybf(f"magnitud {magnitud} con {componentes} componentes (son {esperadas})")
    texto_unidad = unidad.rstrip(b"\0")
    if b"\0" in texto_unidad or texto_unidad.decode("ascii", "replace") != unidad_magnitud:
        raise ErrorVybf(f"unidad {unidad!r} no corresponde a la magnitud {magnitud} ({unidad_magnitud})")
    if n_pasos == 0:
        raise ErrorVybf("n_pasos = 0")
    largo = CABECERA.size + (8 * n_pasos if banderas & VALORES_PASO else 0) + 8 * n_pasos * componentes
    largo += 4 * n_pasos * n_valores * componentes
    if len(datos) != largo:
        raise ErrorVybf(f"longitud {len(datos)} ≠ {largo}")
    pos = CABECERA.size
    valores_paso = None
    if banderas & VALORES_PASO:
        valores_paso = np.frombuffer(datos, "<f8", n_pasos, pos).copy()
        pos += 8 * n_pasos
    rango = np.frombuffer(datos, "<f4", 2 * n_pasos * componentes, pos).reshape(n_pasos, componentes, 2).copy()
    pos += 8 * n_pasos * componentes
    valores = np.frombuffer(datos, "<f4", n_pasos * n_valores * componentes, pos).reshape(n_pasos, n_valores, componentes).copy()
    for nombre, a in (("valores", valores), ("rango", rango)) + ((("valores de paso", valores_paso),) if valores_paso is not None else ()):
        if not np.isfinite(a).all():
            raise ErrorVybf(f"{nombre} no finitos")
    if (rango[..., 0] > rango[..., 1]).any():
        raise ErrorVybf("rango con mínimo mayor que máximo")
    return Trama(lote, texto_guid, referencia, ubicacion, magnitud, texto_unidad.decode("ascii"), valores, rango, valores_paso)
