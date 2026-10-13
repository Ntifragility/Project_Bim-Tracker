# Protocolo kernel ⇄ interfaz de COVILLAF SIMULATE — `protocolo` 1

Estado: **Fase 0** (2026-09-24). Decisiones: H-03, H-04, F0-24; ficha D-8 (núcleo común, aprobada, sin aplicar en
DESIGN). Código: `apps/kernel/src/covillaf_sim_kernel/`. Pruebas: `apps/kernel/tests/` (156; 30 son las regresiones de las
auditorías de la sesión 4, `test_auditoria.py`, y 26 de la capa de resultados, `test_resultados.py`).

Base: [`rpc.md` v1 de COVILLAF DESIGN](../../../07.34%20COVILLAF%20DESIGN/docs/protocolo/rpc.md) (`DES:docs/protocolo/rpc.md`),
**al pie de la letra** salvo lo que dice §1. Todo lo añadido es **aditivo** según su §0: `protocolo` sigue en **1** y el
cliente TS de DESIGN funciona sin cambios contra este kernel (salvo el `Origin`, §1).

## 1. Qué se toma de `rpc.md` v1 y qué cambia

| `rpc.md` v1 | En SIMULATE |
|---|---|
| §0 versiones (aditivo no sube `protocolo`) | Igual. Añadidos: campo `producto`, métodos `tarea.*`, notificación `tarea.terminada`, comandos `modelo.*` |
| §1.1 `python -m … --puerto 0 --token-stdin`, token por stdin | Igual con `python -m covillaf_sim_kernel` |
| §1.2 línea «listo» por stdout, resto por stderr UTF-8, cierre con código 0 | Igual + `"producto":"covillaf-simulate"` **al final**: `{"evento":"listo","puerto":54614,"kernel":"0.1.0","protocolo":1,"pid":32700,"producto":"covillaf-simulate"}` |
| §1.4 primer mensaje `sesion.autenticar`, `hmac.compare_digest`, 4401, 5 s | Igual. Además (auditoría de la sesión 4): el primer mensaje no puede pasar de **64 KiB** (si no, cierre 1009; después, 16 MiB); cualquier fallo al analizarlo (anidamiento, sustitutos UTF-16) es 4401, nunca 1011; a una notificación `sesion.autenticar` con token malo no se responde (solo 4401). El cliente **espera la respuesta de `sesion.autenticar`** antes de enviar nada más (el de DESIGN lo hace): un mensaje de más de 64 KiB enviado sin esperar puede leerse aún con el límite previo y cerrar con 1009 |
| §1.5 `Origin` `app://covillaf` + `--origen-permitido` (solo `http://127.0.0.1:<p>`/`http://localhost:<p>`), sin `Origin` con token, `null`/`file://`/otros ⇒ 4403 | Fijo **solo `app://covillaf-simulate`**; `app://covillaf` (DESIGN) ⇒ **4403**. `--origen-permitido` se **analiza como URL** y se guarda normalizado (`http://127.0.0.1:5173/` ⇒ `http://127.0.0.1:5173`; `localhost:5173.evil.example`, rutas, consultas o usuario ⇒ código 2). `Identidad` y el servidor rechazan `file:` y `null` hasta como origen de desarrollo |
| §2 texto JSON | Igual; los mensajes salen en UTF-8 y, si llevan un sustituto UTF-16 suelto (JSON válido; NTFS admite nombres así), con escapes `\uXXXX` (si no, websockets cerraba la conexión y una difusión tiraba todas las sesiones). Un entero de más de 4 300 cifras es -32602 con su `id` (como `1e400`); un anidamiento excesivo, -32700 |
| §2 JSON-RPC sin lotes, binario solo kernel → interfaz, `modelo.cambios` antes que la respuesta, un comando a la vez (-32003) | Igual. Binarios: tramas VYBF detrás de la respuesta de `resultados.campo` (nunca VYBM todavía) |
| §3 métodos | Los básicos, **sin** `geometria.caja_prueba` ni `modelo.mallas` (-32601); más `tarea.*` (§2) y `resultados.*` (§3) |
| §4 errores | Igual; `data` de `tarea.*` en §2 |
| §5 pruebas mínimas | Portadas (§5) |

## 2. Métodos

| Método | Parámetros | Resultado | Errores |
|---|---|---|---|
| `sesion.autenticar` | `{token, cliente?}` | `{kernel, protocolo, producto}` | -32001 y cierre 4401 |
| `sistema.version` | — | `{kernel, protocolo, producto, python, numpy, scipy, ifcopenshell, h5py, websockets, mkl, bus_design, covillaf_sim, motor}`; `mkl` = versión de MKL o `null` sin PARDISO; `bus_design` = `coincide` \| `cambiado` (huella, §4); `covillaf_sim` = `{modelo, malla, resultados, io, solver, kernel}` (versiones instaladas); `motor` = sha256 (16 cifras) de las fuentes de `covillaf.sim.solver` (con la instalación editable la versión no cambia al tocar el código; la huella sí) | -32602 si hay params |
| `sistema.ping` | `{eco?}` | `{eco, t_kernel}` | — |
| `comando.listar` | — | `[{nombre, descripcion, parametros}]` (JSON Schema 2020-12) | — |
| `comando.ejecutar` | `{nombre, args?}` | `{resultado, transaccion, cambios}` | -32602 (`data: {comando, detalle \| errores}`), -32002 (`data: {comando, detalle, clave?, id?}`), -32003 |
| `transaccion.deshacer` · `transaccion.rehacer` | — | `{transaccion, cambios}` (nada que hacer: `transaccion: null`) | -32003 |
| `tarea.listar` | — | `[{nombre, descripcion, parametros}]` | — |
| `tarea.iniciar` | `{nombre, args?}` | `{id}` (IFC GlobalId); valida (en un hilo: no para el bucle), toma la instantánea del modelo y encola; **la respuesta llega antes que cualquier aviso de esa tarea**. Las listas de `args` admiten como mucho **1 000** elementos (se comprueba antes del JSON Schema, en tiempo lineal); las de una misma sesión se encolan en el orden en que se enviaron | -32602 (`data: {tarea, detalle: "tarea desconocida"}` o `{tarea, errores}`), -32003 (comando en curso) |
| `tarea.activas` | — | `[{id, nombre, estado, texto, fraccion}]` de las tareas en cola, en curso o cancelándose, por orden de inicio: una interfaz recargada o reconectada recupera así las que siguen vivas (como `modelo.mallas` en DESIGN) | — |
| `tarea.estado` | `{id}` | `{id, nombre, estado, texto, fraccion, resultado?, error?}` | -32602 (`data: {id, detalle: "tarea desconocida"}`) |
| `tarea.cancelar` | `{id}` | `{id, estado}`: en cola ⇒ `cancelada`; en curso ⇒ `cancelando` (cooperativa); terminada ⇒ igual | -32602 |

Notificaciones (a **todas** las sesiones autenticadas):

| Notificación | Parámetros |
|---|---|
| `modelo.cambios` | Las de `rpc.md` §3 sin `lote`: `{transaccion, anadidos, modificados, borrados, modificado, reemplazado?}` |
| `tarea.progreso` | `{id, texto, fraccion}` (`fraccion` 0..1, o `null` = indeterminado); ≤ 10/s por tarea salvo cambio de texto o fin |
| `tarea.terminada` | `{id, nombre, estado: "terminada" \| "fallida" \| "cancelada", resultado?, error?: {detalle, clave?, id?}}` |

Estados de una tarea: `en_cola`, `en_curso`, `cancelando`, `terminada`, `fallida`, `cancelada`. Una a la vez
(`simultaneas = 1`: el motor ya usa varios núcleos); las demás esperan en cola. Orden garantizado por tarea; entre
tareas o respecto de `modelo.cambios`, no. Las tareas corren **fuera del candado del bus** en un hilo propio, dentro de
una **copia del contexto** de quien las inicia (`contextvars.copy_context()`), sobre una instantánea inmutable del
modelo; sus resultados son datos derivados (ni deshacer ni historial).

## 3. Comandos y tareas de SIMULATE

El modelo del bus tiene un solo elemento, el **documento de simulación** (GUID = `manifest.guid` del `.vybs`; uno nuevo
al importar), inmutable por convención. Mismo nombre en RPC, en la API Python (`covillaf_sim_kernel.kernel.Kernel`:
`ejecutar`, `iniciar`, `esperar`) y en el historial del bus (H-04); el historial guarda solo el nombre del archivo.

**Rutas** (todas las `ruta` de comandos y tareas): absolutas y locales, normalizadas (sin «..»). Además de las claves de
cada fila: `ruta_relativa` (dependería de la carpeta desde la que se lanzó el kernel), `ruta_red` (`\\equipo\recurso`:
solo comprobarla ya abre una conexión SMB; también `\\?\UNC\…`) y `ruta_invalida` (caracteres de control, nombres
reservados como `NUL`, espacio o punto final, `:`). Las rutas de formato extendido locales (`\\?\C:\…`, `\\.\C:\…`) se
aceptan. **Sellos**: volver a guardar el mismo documento (mismo GUID) conserva el `creado` del archivo y sella
`modificado`. **Solo lectura**: `modelo.guardar_vybs` nunca reescribe un `.vybs` de una versión más nueva: mira el
`version_formato` del archivo que ya hay en el destino, esté abierto o no (auditoría del commit a32e22f, B-MEDIA-2).

| Comando (`comando.ejecutar`) | `args` | `resultado` | `clave` de -32002 |
|---|---|---|---|
| `modelo.importar_vyba` | `{ruta, nombre?, opciones?: {tol_nodo (mm), unir_cruces, excentricidades: desfase \| ignorar, materiales: {IfcMaterial: {E, nu, rho?, alfa?, G?, nombre?, fuente?}}, condiciones: {componente: {tipo: rigida \| articulada \| apoyo, descripcion?, restricciones?[6]}}, liberaciones: {GUID: {i?: [ux…rz], j?: […]}}}}` (F0-32) | resumen del documento: `{guid, nombre, nodos, barras, apoyos, materiales, secciones, masas, casos, combinaciones, cargas, origen, problemas, derivacion: {avisos, apoyos_sugeridos, cruces, trazas, opciones}, avisos}`. Sustituye el documento en una transacción normal (**se puede deshacer**) | `extension`, `no_existe`, `opciones`, `derivacion`, `lectura` |
| `modelo.abrir_vybs` | `{ruta}` | resumen + `{ruta, hash_contenido, modificado: false, solo_lectura, avisos_archivo}`. **Sustituye el modelo entero** (`reemplazado`, deshacer vacío); reconstruye las copias físicas del IFC para volver a guardarlo igual | `extension`, `no_existe`, `lectura` |
| `modelo.guardar_vybs` | `{ruta?, nombre?, autor?}` (sin `ruta`: la actual) | `{ruta, guid, nombre, hash_contenido, bytes, modificado: false, avisos}`; `transaccion: null` | `sin_modelo`, `sin_ruta`, `extension`, `carpeta_inexistente`, `solo_lectura`, `escritura` |
| `modelo.resumen` | — | `{cargado, modificado, …resumen, archivo: {ruta, guid, hash_contenido, fecha, al_dia, solo_lectura} \| null, resultados: {estatico?, modal?: {estado: al_dia \| desactualizado, fecha, tarea}}}` | — |

| Tarea (`tarea.iniciar`) | `args` | `resultado` de `tarea.terminada` | `error.clave` |
|---|---|---|---|
| `analisis.estatico` | `{casos?, deformacion_cortante?, resolvedor?: auto \| superlu \| pardiso}` | `{casos: [{caso, desplazamiento_maximo: {valor, nodo, unidad: mm}, reaccion_total: {valor[3], unidad: N}, residuo, desequilibrio}], combinaciones, nodos, barras, metadatos: {solver, version, gdl, gdl_libres, resolvedor, pasos_refinamiento, pivote_minimo, segundos…}, avisos}` | `sin_modelo`, `sin_casos`, `modelo_no_valido`, `inestable`, `elemento`, `pardiso`, `casos_inexistentes`, `analisis` |
| `analisis.modal` | `{n_modos? (1–1000, 12), masa?: consistente \| concentrada, desplazamiento? (σ ≥ 0, rad²/s²), deformacion_cortante?, sturm?, resolvedor?}` | `{n_modos, frecuencias (Hz), periodos (s; null = ∞), ratios_masa [[X,Y,Z]], ratios_acumulados, certificado, residuo_maximo, sturm: {valido, concluyente, perdidos, por_debajo, calculados, repetidos_cortados, desplazamiento}, tipo_masa, metadatos, avisos}` | las de arriba salvo `sin_casos` |
| `resultados.guardar_vybres` | `{ruta, nombre?, autor?, exportar_vtu?}` | `{ruta, bytes, hash_contenido, analisis, modelo: {guardado, guid?, hash_contenido?, ruta?}, avisos}`: solo resultados **al día** del documento actual; enlace al `.vybs` si el documento es el abierto o guardado (ruta relativa a la carpeta del `.vybres`, o solo el nombre con aviso) | `sin_modelo`, `sin_resultados`, `extension`, `carpeta_inexistente`, `escritura` |
| `verificacion.ejecutar` | `{casos? (ids V-…), resolvedor?}` | `{casos, comprobaciones, fallos, valido, resolvedor, filas: [{caso, titulo, analisis, magnitud, calculado, referencia, error, tolerancia, unidad, cumple}], tabla}` (la de `python -m covillaf.sim.solver.verificacion`); un caso que lanza cuenta como FALLA y no para los demás | `caso_desconocido` (`id` = el primero) |

**Capa de resultados** (métodos aditivos, sesión 4; `metodos_resultados.py`, formato en
[`../formatos/trama_vybf.md`](../formatos/trama_vybf.md)). Son lecturas de datos derivados, como `modelo.mallas` de
DESIGN: fuera del bus (ni transacción ni historial), calculadas en un hilo, y solo de resultados **al día** del
documento actual. Errores: -32002 con `data: {metodo, detalle, clave}`; -32003 si un comando está cambiando el modelo.

| Método | `params` | Resultado | `clave` de -32002 |
|---|---|---|---|
| `resultados.geometria` | — | `{guid, nombre, unidad: "mm", caja, nodos, barras: [{id, nodos, extremos, ejes, estaciones}], apoyos, huella, revision, n_estaciones, estados: {estatico: {casos, combinaciones: [{id, tipo}], fecha} \| null, modal: {modos: [{modo, frecuencia, periodo}], fecha} \| null}}` | `sin_modelo` |
| `resultados.campo` | `{tipo: estatico \| modal, magnitud: desplazamiento \| esfuerzos \| forma, estado? (caso o combinación lineal), modo? (1…n)}` | `{tipo, magnitud, estado? | modo? + frecuencia, lote, guid, revision, codigo, componentes, unidad, n_valores, rango: [[mín, máx] por componente], maximo: {valor, barra, x}}` (desplazamiento y forma: el de mayor norma; esfuerzos: una lista con el mayor |valor| de cada componente)\| modo? + frecuencia, lote, guid, revision, codigo, componentes, unidad, n_valores, rango: [[mín, máx] por componente], maximo: {valor, barra, x}}` y **después de la respuesta** una trama VYBF con ese `lote` (ubicación 3: estaciones de todas las barras) | `sin_modelo`, `sin_resultados` (no hay o desactualizados), `estado_inexistente`, `estado_envolvente` (aún no se dibujan), `modo_inexistente`, `parametros` |
| `resultados.tabla` | `{tabla: reacciones \| desplazamientos \| esfuerzos \| modos, estado?}` | `{tabla, estado?, columnas: [{id, titulo, unidad}], filas}`: reacciones de los nudos con apoyo (N, N·mm), desplazamientos de todos los nudos (mm, rad), esfuerzos en los extremos i y j de cada barra (ejes locales), modos (f, T, masas por dirección y acumuladas) | las mismas |

Coste medido (rejilla sintética 30×30×6, 15 840 barras, 174 240 estaciones): geometría 1,6 s; un estado estático
(deformada + esfuerzos, integración exacta barra a barra) 9,1 s, que queda en caché (8 estados); forma modal 2,2 s;
trama de esfuerzos 4 MiB codificada en 13 ms.

**Progreso y cancelación dentro del motor** (F0-34). Estático y modal avisan `preparar el análisis …` (0) → las fases
del motor en [0,02; 0,95] (estático: `preparar las barras`, `ensamblar la rigidez`, `montar las cargas`, `factorizar la
rigidez (n GDL libres)`, `resolver n casos (resolvedor)`, `recuperar reacciones y esfuerzos`; modal: `preparar las
barras`, `ensamblar la rigidez`, `ensamblar la masa (tipo)`, `factorizar K − σM (n GDL libres)`, `extraer los modos
(denso | reducción a n GDL con masa)` o `extraer n modos (Lanczos)`, `normalizar los modos…`, `certificado de Sturm…`,
`masas participativas`; y `cálculo … terminado`) → `resumir los resultados` (0,95) → `análisis … terminado` (1). La
fracción nunca retrocede ni es `null`; sus pesos por fase son nominales. La cancelación se atiende en el **siguiente
aviso del motor** (bucles de barras, cada producto del Lanczos). Espera a una llamada compilada en curso
(factorización, inercia de Sturm) y a los tramos de Python sin avisos dentro: comprobar el modelo, montar las cargas de
un caso, estabilizar. Medido: en la rejilla 16×16×5 (9 216 GDL), 1–8 ms en los cortes de nuestra prueba y hasta 0,24 s
en el peor hueco; en una de 20×20×10 (26 400 GDL, auditoría del commit a32e22f), durante el Lanczos 13–27 ms y hasta
0,82 s en «montar las cargas». El resultado cancelado no se guarda. Verificación: un aviso por caso y cancelación entre
casos.

**Resolvedor.** `with usar_resolvedor("pardiso"): kernel.iniciar(...)` se respeta (la tarea corre en la copia del
contexto); el argumento `resolvedor` lo fija para esa tarea. El usado sale en `metadatos.resolvedor`.

## 4. Implementación (lo que se toma de DESIGN y cómo)

| Pieza | Origen |
|---|---|
| Bus, transacciones, deshacer/rehacer, historial, `ErrorComando` | `covillaf_kernel.comandos` de DESIGN **por ruta** (`covillaf_design.pth` con `DES:apps\kernel\src`), importado **solo** en `covillaf_sim_kernel.bus`. Arrastra `covillaf_kernel/__init__`, `covillaf.core` (`__init__`, `guid` → `ifcopenshell.guid`, `tiempo`) y `jsonschema`; **ni OCCT ni VYBM** (prueba en proceso limpio). `HUELLA_DESIGN` = sha256 de esos 5 archivos; `test_huella_de_design` falla si cambian |
| `instantanea(bus)` | Propia (es `BusComandos.instantanea` de D-8): toma `bus._candado` sin esperar (privado, cubierto por la huella) |
| `servidor.py`, `tareas.py`, `__main__.py` | Propios, con los nombres y la semántica de `covillaf.kernel.{servidor,tareas,arranque}` de D-8 (`Identidad`, `Metodo`, `Respuesta`, `metodos_basicos`, `GestorTareas`, `ContextoTarea`…) + `copy_context` por tarea |
| Comandos, tareas, estado | Propios: `comandos_modelo.py`, `tareas_analisis.py`, `estado.py`, `kernel.py` |

Migración cuando DESIGN aplique D-8: `bus.py` importa de `covillaf.kernel.comandos` (e `instantanea` pasa a
`bus.instantanea()`); `servidor.py`, `tareas.py` y el arranque se sustituyen por `covillaf.kernel` (llevar `copy_context`
al `GestorTareas` común); `.pth`: `DES:packages\kernel\src` en vez de `DES:apps\kernel\src`; nueva huella.

## 5. Evidencias (2026-09-24; `PYTHONPATH=apps\kernel\src`, sin instalar nada)

```text
$ python -c "import covillaf_kernel.comandos as c; print(c.__file__)"
D:\07. Automatization Claude\07.34 COVILLAF DESIGN\apps\kernel\src\covillaf_kernel\comandos.py
$ echo <token> | python -m covillaf_sim_kernel --puerto 0 --token-stdin        (stdout)
{"evento":"listo","puerto":54614,"kernel":"0.1.0","protocolo":1,"pid":32700,"producto":"covillaf-simulate"}
$ python -m ruff check packages apps tests tools conftest.py
All checks passed!
$ lint-imports --no-cache
Analyzed 86 files, 318 dependencies. · Licencias … KEPT · Capas del kernel COVILLAF SIMULATE KEPT · 2 kept, 0 broken
$ python -m pytest -q -p no:cacheprovider apps/kernel
92 passed in 14.88s
$ python -m pytest -q -p no:cacheprovider -m "not lento and not externo"
343 passed, 2 deselected in 48.80s            (251 del repo + 92 del kernel)
```

Pruebas (`apps/kernel/tests/`): `test_bus` (huella, por ruta, qué arrastra, instantánea), `test_tareas` (registro,
regulación, cancelación en curso y en cola, `TareaCancelada` no la traga `except Exception`, clave/id, resultado no
JSON, contexto de quien lanza —con la premisa: un hilo sin copia ve «auto»—, retención y cierre), `test_servidor`
(127.0.0.1, tabla sin métodos de prueba, autenticación, 4401, `Origin` bueno y 10 malos ⇒ 4403, 17 errores JSON-RPC,
difusión, respuesta antes que avisos, ping y comandos durante una tarea, -32003, cancelación), `test_comandos` (PR-01 y
pórtico de DESIGN desde `.vyba` sintéticos: 36/64 y 8/10/4; deshacer/rehacer; abrir y guardar con el mismo
`hash_contenido`; estático y modal por RPC iguales al motor directo ≤ 1e-12; `.vybres` con enlace; desactualizados;
resolvedor por contexto y por argumento; cancelación de un análisis real; ping y comando durante un modal real de
9 216 GDL; verificación), `test_proceso` (proceso real: «listo», comando, tarea, `Origin`, cierre con tarea en curso ⇒
cancelada y código 0; 6 arranques incorrectos ⇒ código 2).

Latencia de `sistema.ping` en el **proceso real** durante análisis largos (rejilla sintética 30×30×6: 6 300 nodos,
15 840 barras, 37 800 GDL; guion de medida fuera del repo, en la carpeta de trabajo del agente):

```text
analisis.modal: terminada en 5.71 s · pardiso · Lanczos (ARPACK, desplazamiento-inversión)
  ping sin tarea: mediana 0.20 ms (máx 0.54) · durante: 6841 pings, mediana 0.26 ms (máx 62.49) · con la tarea en curso: 6839
analisis.estatico: terminada en 4.78 s · pardiso
  ping sin tarea: mediana 0.20 ms (máx 0.54) · durante: 2741 pings, mediana 0.44 ms (máx 71.15) · con la tarea en curso: 2739
en proceso (prueba), rejilla 16×16×5, 9 216 GDL: modal terminada · motor 0.89 s · 1364 pings, 1363 con la tarea en curso ·
  mediana 0.12 ms · máx 53.33 ms
```

## 6. Límites conocidos

- La cancelación de un análisis espera a que termine la llamada compilada en curso (una factorización de PARDISO o
  SuperLU de un modelo muy grande puede durar segundos).
- `modelo.abrir_vybs` y `modelo.importar_vyba` son comandos: leen dentro del candado del bus. Con la rejilla de §5,
  abrir tarda 14 s (`leer_vybs` 10,8 s + copias físicas 0,8 s); mientras, `ping` responde y otro comando da -32003. Para
  modelos grandes convendría leer en una tarea y sustituir con un comando corto (patrón de D-8).
- Las tareas no dejan fila en el historial del bus, y es a propósito (criterio de la auditoría de la sesión 4): ese
  historial es de cambios del modelo; qué análisis, con qué argumentos, resolvedor, versión y huella del motor, y sobre
  qué `hash_contenido`, viaja con los resultados (`metadatos`, `/covillaf` del `.vybres`, `modelo.resumen.resultados`).
- El historial pendiente se descarta al guardar (el `.vybs` no tiene historial; el `.covillaf` de DESIGN sí).
- La pila de deshacer del bus de DESIGN no tiene límite: cada `modelo.importar_vyba` conserva el documento anterior.
- `verificacion.ejecutar` toma la instantánea aunque no lea el modelo: con un comando en curso da -32003.
- Un token de formato distinto al del protocolo (64 cifras hex) solo da un aviso en stderr (como DESIGN).
