# Trama VYBF v1 — campos de resultados del kernel al visor

Estado: **v1** (2026-09-24, sesión 4). Decisiones: F0-25 (nombre), F0-35 (esta especificación). Código: codificador y
decodificador de referencia `apps/kernel/src/covillaf_sim_kernel/vybf.py`; decodificador del visor
`packages/viewer/src/vybf.ts`; campos `apps/kernel/src/covillaf_sim_kernel/campos.py`; métodos
`apps/kernel/src/covillaf_sim_kernel/metodos_resultados.py`. Parte del bosquejo del informe 04 §2.4 con los cambios de §5.

## 1. Principio

El visor **solo dibuja**. Todo lo que hay que interpolar lo interpola el kernel, en doble, y manda valores ya situados:
en los vértices o triángulos de una malla VYBM que ya envió, en las **estaciones** de las barras o en los **nudos** de
la geometría analítica (`resultados.geometria`). Una trama = **un campo** (una magnitud) con uno o varios **pasos**
(casos, combinaciones, modos o instantes). Binaria, solo kernel → interfaz, detrás del JSON que anuncia su `lote`
(`rpc.md` §2 de DESIGN).

## 2. Estructura (little-endian)

| Desplazamiento | Tamaño | Campo |
|---|---|---|
| 0 | 4 | `magic` = `VYBF` (0x56 0x59 0x42 0x46) |
| 4 | 2 | `version` (u16) = 1 |
| 6 | 2 | `banderas` (u16): bit0 rango (**obligatorio** en v1) · bit2 valores de paso. bit1 (cuantizado u16) reservado: se rechaza en v1, como los bits 3–15 |
| 8 | 4 | `lote` (u32, ≠ 0): liga la trama con el JSON que la anuncia |
| 12 | 24 | `guid`: 22 bytes ASCII (IFC GlobalId: del documento de simulación, o del elemento del VYBM) + 2 bytes a 0 |
| 36 | 4 | `referencia` (u32): lote del VYBM (ubicación 1, 2) o `revision` de la geometría analítica (ubicación 3, 4) |
| 40 | 1 | `ubicacion` (u8): 1 vértice del VYBM · 2 triángulo del VYBM · 3 estación de barra · 4 nudo analítico |
| 41 | 1 | `componentes` (u8): el de la magnitud (§3) |
| 42 | 2 | `magnitud` (u16): §3 |
| 44 | 4 | `n_valores` (u32): vértices, triángulos, estaciones (todas las barras) o nudos |
| 48 | 4 | `n_pasos` (u32) ≥ 1 |
| 52 | 4 | reservado = 0 |
| 56 | 8 | `unidad`: ASCII relleno con 0; debe ser la de la magnitud (§3) |
| 64 | 8·n_pasos | `valores_paso` float64 (si bit2): frecuencia en Hz (modos), tiempo en s o factor |
| … | 8·n_pasos·componentes | `rango` float32 [paso][componente][mín, máx] (bit0) |
| … | 4·n_pasos·n_valores·componentes | `valores` float32 [paso][valor][componente] |

Longitud total exacta: 64 + (8·n_pasos si bit2) + 8·n_pasos·componentes + 4·n_pasos·n_valores·componentes. Todo queda
alineado a 4 bytes (a 8 hasta el rango), así que el visor lee sin copiar.

## 3. Magnitudes de v1

| Código | Componentes | Unidad | Qué | Ejes |
|---|---|---|---|---|
| 1 | 3 | `mm` | desplazamiento | globales |
| 2 | 3 | `rad` | giro | globales |
| 3 | 3 | `1` | forma modal (φᵀMφ = 1: la escala la pone el visor) | globales |
| 10 · 11 · 12 | 1 | `N` | N · Vy · Vz | locales de la barra |
| 13 · 14 · 15 | 1 | `N.mm` | T · My · Mz | locales de la barra |
| 16 | 6 | `N;N.mm` | esfuerzos N, Vy, Vz, T, My, Mz (resultantes sobre la cara de normal +x) | locales de la barra |
| 17 | 6 | `N;N.mm` | reacción Fx, Fy, Fz, Mx, My, Mz | globales |
| 20 | 1 | `MPa` | tensión de von Mises | — |
| 30 | 1 | `1` | ratio demanda/capacidad | — |
| 40 | 1 | `C` | temperatura | — |

El kernel de la sesión 4 emite 1, 3 y 16 con ubicación 3; las demás quedan definidas para las fases siguientes.

## 4. Rechazo

Una trama se rechaza entera si: es más corta que la cabecera; `magic` o `version` no son los de v1; hay banderas
desconocidas o reservadas, o falta el bit0; `reservado` ≠ 0 o los 2 bytes del GUID ≠ 0; el GUID no es ASCII del
alfabeto IFC (`[0-9A-Za-z_$]{22}`); `lote` = 0; `ubicacion` o `magnitud` desconocidas; `componentes` distinto del de la
magnitud; `unidad` distinta de la de la magnitud; `n_pasos` = 0; la longitud no es la exacta; hay valores, rangos o
valores de paso no finitos; un rango tiene mínimo > máximo. En el visor, además: `referencia` distinta de la `revision`
de la geometría cargada (ubicación 3, 4) o del lote de un VYBM registrado (1, 2), y `n_valores` distinto de sus
estaciones, nudos, vértices o triángulos. Las pruebas cubren cada regla en los dos lados (`test_resultados.py`,
`packages/viewer/test/`).

## 5. Cambios respecto al bosquejo del informe 04 §2.4

1. `magic` `VYBF` en vez de `VYBR` (F0-25: `VYBR` es el `application_id` del `.covillaf`).
2. **Ubicación 3 = todas las estaciones de todas las barras** del modelo analítico, concatenadas en el orden de
   `barras` de `resultados.geometria` (el bosquejo mandaba una trama por barra con sus extremos y ejes: 16 000 tramas
   por campo en un modelo grande). Extremos, ejes locales y estaciones viajan **una vez**, en el JSON de la geometría.
3. **Ubicación 4 = nudos** de la geometría analítica (nueva).
4. `lote_malla` pasa a llamarse `referencia` y liga también con la `revision` de la geometría (u32: los 4 primeros bytes
   de su huella sha256), para que el visor rechace un campo de otra geometría.
5. El rango es obligatorio en v1 y la cuantización u16 queda reservada (se decidirá con datos de volumen reales).

## 6. Geometría analítica (`resultados.geometria`)

`{guid, nombre, unidad: "mm", caja: [[x,y,z]mín, [x,y,z]máx], nodos: [{id, punto}], barras: [{id, nodos: [i, j],
extremos: [[x,y,z]i, [x,y,z]j], ejes: [[x], [y], [z]], estaciones: [mm desde i]}], apoyos: [{nodo, restricciones[6]}],
huella, revision, n_estaciones, estados}`. `extremos` = nodo + desfase rígido; `ejes` = filas de los ejes locales en
globales (convenio de `covillaf.sim.modelo.geometria`); la estación s de la barra b está en `extremos[0] + x_s · ejes[0]`.
Las estaciones son 11 equiespaciadas más las abscisas de las cargas de **todos** los casos; una carga puntual interior
aparece **dos veces** seguidas (valor a la izquierda y a la derecha). Coordenadas del marco local de proyecto en mm
(doble): el visor resta el origen en doble antes de pasar a float32 (ARCHITECTURE §2 punto 5).
