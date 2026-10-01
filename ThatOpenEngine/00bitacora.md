# Bitácora de la Fase 0 y de la Fase 1 (desde 2026-09-23)

Qué se hizo, en orden, e incidentes. Evidencia en `.herramientas/registros/` (ignorada por git) y en los documentos citados.

## Sesión de arranque (2026-09-23, tarde y noche)

| # | Paso | Resultado |
|---|---|---|
| 1 | Lectura de la familia: `CLAUDE.md`, `ARCHITECTURE.md`, `docs/HANDOFF.md`, `decisiones.md`, protocolo y formatos de COVILLAF DESIGN; `README` y estructura de COVILLAF 3D; memorias de ambos proyectos | Reglas y stack heredados (`docs/decisiones.md` H-01…H-08) |
| 2 | Inventario de la máquina: Python 3.14/3.13/3.12, Node 24.19, sin WSL ni compiladores, RTX 5070, 24 núcleos, 63 GB; software instalado (solo nombres): SAP2000 26, Robot 2027, Inventor 2026, SOLIDWORKS, AutoCAD/Revit/Navisworks 2027 | F0-14 |
| 3 | Barrido de PyPI (JSON) de ~200 paquetes candidatos: versión, licencia, rueda cp313 win_amd64 | `requirements-dev.txt` y `requirements-opcional.txt` con versiones fijadas |
| 4 | Esqueleto: `CLAUDE.md`, `README.md`, `.gitignore`, `.gitattributes`, `docs/00_prompt_maestro.md`, logo en `recursos/marca/` | — |
| 5 | Lanzados 4 agentes **opus** (stack, referencias, reutilización, formatos) | **Incidente 1** (abajo) |
| 6 | `.venv` Python 3.13 + núcleo + opcionales; `npm install` + Electron | Todo instalado salvo pyNastran (**incidente 2**) y openseespy en 3.13 (**incidente 3**) |
| 7 | `tools/comprobar_entorno.py`: importaciones + 8 pruebas numéricas con criterio | 36/36 núcleo OK; pruebas OK tras corregir la de scikit-fem (**incidente 4**) |
| 8 | Binarios oficiales a `.herramientas/descargas` con SHA-256: gmsh 4.15.2, CalculiX 2.23 (+ manual + ejemplos), SU2 8.5.0, ParaView 6.1.1, OpenFOAM v2506 Windows | `docs/fase0/herramientas_descargadas.md` |
| 9 | Licencias leídas en su fuente: Gmsh, OpenSees, Kratos, CalculiX | F0-07, F0-08, F0-09 |
| 10 | Grafo: `docs/grafo/grafo.json` (fuente) + `tools/generar_grafo.py` (validación + SVG + HTML interactivo + Mermaid + README) | El validador detectó dos errores reales en la primera versión (capa de `mod_viewer`; `cap_publicar_3d` sin referencia): corregidos |
| 11 | `pyproject.toml`, `tools/instalar.ps1`, `tools/ci.ps1`, `tools/herramientas.ps1`, `.github/workflows/ci.yml`, `.claude/launch.json` | — |
| 12 | Paquetes de DESIGN enlazados por `.pth` sin tocar su carpeta; OpenSees en venv 3.12 aparte | F0-03, F0-08 |

## Sesión 2 (2026-09-23, noche)

| # | Paso | Resultado |
|---|---|---|
| 1 | Lectura de `HANDOFF`, decisiones, bitácora, arquitectura y grafo; uso del plan (Max: 16 % de la ventana de 5 h, 5 % semanal, sin límite propio de Opus) | El bloqueo de P-01 ya no existe |
| 2 | Cuatro decisiones del usuario: P-01 (relanzar ya), P-05 (MVP, núcleo primero), P-06 (primer commit local), P-02 (aún no ⇒ OpenSees en cuarentena) | `docs/decisiones.md`, sección «Resueltas» |
| 3 | Encargos originales recuperados del historial de la sesión 1, actualizados a lo ya hecho y versionados en `docs/fase0/encargos/`; 4 agentes opus lanzados en paralelo | Arrancaron sin error de cupo |
| 4 | Núcleo del MVP: `covillaf.sim.modelo`, `covillaf.sim.resultados`, `covillaf.sim.solver` (barra 3D, estático, modal, diagramas) | F0-18, F0-19 |
| 5 | Verificación: 23 casos (16 estáticos, 7 modales), 62 comprobaciones con tolerancia declarada; validación cruzada con PyNite | Estáticos ≈ 1e-16; modales dentro del error de discretización previsto; PyNite ≤ 4e-12 |
| 6 | Informe 03 (reutilización) recibido: arreglos inmediatos aplicados (F0-03 en `instalar.ps1`, caché de bytecode F0-17) | `docs/fase0/03_reutilizacion_familia.md` |
| 7 | CI rápida: grafo, ruff, capas (F0-21), pytest, entorno | En verde |
| 8 | **Primer commit** `4ecb699` en `main`, local, sin remoto; autor `COVILLAF <1mindware6@gmail.com>` (identidad solo del repo, elegida por el usuario) | 71 archivos |
| 9 | Informes 01, 02 y 04 recibidos (los cuatro completos) e integrados: F0-11, F0-12 y F0-16 enmendadas; F0-22…F0-30; `ARCHITECTURE.md` v0.2; **grafo v0.2** (166 nodos, 330 aristas) | Validador del grafo en verde |
| 10 | MVP: asentamientos y cargas proyectadas (V-B17, V-B18); `covillaf.sim.malla` (subdivisión de barras); masa de cargas consistente (V-M08, F0-29); liberaciones en la masa (V-M09) | 27 casos, 75 comprobaciones |
| 11 | **Piloto PR-01** (rack de tuberías del informe 01) y aceptación: A3 equilibrio, A4 PyNite (1,2e-12), A7 ortogonalidad y PyNite (3,7e-13 con entradas idénticas), A8 convergencia, A9 mecanismo localizado, A11 reproducible, A12 (0,11 s) | `tests/aceptacion/test_pr01.py` |
| 12 | Contrato *forbidden* de import-linter (gmsh, openseespy, triangle, cytriangle, sectionproperties, PyNite fuera del motor); guiones y salidas de los agentes guardados en `.herramientas/registros/agentes-2026-09-23/` | `lint-imports` 2 contratos cumplidos |

Incidentes de la sesión 2:

8. **Búsqueda recursiva en DESIGN sin excluir `privado/`**: un `grep` de nombres de fixtures listó una ruta de
   `docs/fase0/privado/` y una línea de un docstring técnico (sin datos de proyecto). No se usó. Regla: excluir
   `privado/` en toda búsqueda en los hermanos.
9. **Nombre de una skill de cliente en las copias versionadas de los encargos**: el nombre identifica un proyecto real.
   Se sustituyó por la fórmula genérica antes del primer commit (memoria `prompts-subagentes-cleanroom` actualizada).
10. **Tres expectativas de prueba mal planteadas** (no del solver): cercha con barras empotradas en la base tratada como
    cercha pura; `vector_ref` no perpendicular al eje; primer modo elástico de la viga libre-libre supuesto de flexión
    cuando con J pequeño es de torsión. En los tres, el solver coincidía con la solución exacta del problema real.
11. **Métrica de desequilibrio mal escalada** en casos autoequilibrados (temperatura): dividía por una resultante nula.
    Ahora se escala por la suma de módulos de cargas y reacciones (fuerzas y momentos por separado).
12. **import-linter con capas de módulos que aún no existen**: resuelto con capas opcionales y `tests/test_capas.py` (F0-21).
13. **Git sin identidad configurada** (ni global ni local; COVILLAF 3D y DESIGN tampoco tienen commits): el autor del primer
    commit se preguntó al usuario (no se inventa): `COVILLAF <1mindware6@gmail.com>` solo en este repo.
14. **Heredoc de bash con comillas volvió a fallar** (como el incidente 5): los guiones largos se escriben con la
    herramienta de archivos y se ejecutan aparte.
15. **`json.dumps(indent=2)` reformateó todo el grafo** (3 238 líneas de diff): se escribió un formateador que conserva
    una entrada por línea (solo pierde las líneas en blanco entre grupos).
16. **PyNite difiere en modal por su modelado**, no por error nuestro: masa de torsión con ρ·J, masa de cargas con
    inercia de giro, condensación de la masa de barras liberadas con el complemento de Schur de M y partición de sus
    barras en nudos coincidentes (tramo de longitud nula en las cruces). Encontrado al comparar, confirmado leyendo su
    código (MIT) y neutralizado (F0-30); nuestra condensación, verificada contra la analítica (V-M09).
17. **Masa de cargas concentrada** ⇒ convergencia O(h²): A8 fallaba (T₁ cambiaba 0,26 % al duplicar la malla). Corregido
    con masa consistente (F0-29).
18. **Evidencia débil de la sesión 1** (auditoría del informe 02): la prueba de PARDISO de `comprobar_entorno.py` mide la
    carga de MKL, no el rendimiento; la de Kratos no resuelve nada; la de ccx del registro no tiene resultado;
    `descargas.log` anota mal los tamaños (los siete SHA-256 sí coinciden). Pendiente de corregir.
19. **El usuario ofreció como «ideas de estructura» un listado recursivo de `C:\Program Files\Autodesk`** (JSON de
    202 MB: 112 266 archivos, 4 129 carpetas). Por la regla 2 (clean-room: las instalaciones no se inspeccionan) solo se
    leyeron los 23 nombres del primer nivel, como en F0-14; no se copió al proyecto ni al scratchpad y su organización
    interna no se usa. Productos de interés (a estudiar solo por documentación pública): Robot 2027, Inventor 2026,
    Revit 2026/2027, Navisworks Manage 2027 y AutoCAD 2027 con Plant 3D. Se pidió al usuario que dé sus ideas de orden
    con sus propias palabras.

## Sesión 3 (2026-09-24)

| # | Paso | Resultado |
|---|---|---|
| 1 | Lectura de `CLAUDE.md`, `HANDOFF`, decisiones, arquitectura v0.2 y bitácora; una sola tanda de preguntas | P-03 (todas comerciales), P-04 (E.030-2026 por defecto), P-09 (D-8, D-11 y D-13 como ficha + parche; los aplica DESIGN), P-12 (`.vybres`), P-16 (sí), P-17 (B31.3 a la Fase 3): `docs/decisiones.md` |
| 2 | P-16: `pip uninstall openseespy openseespywin` en el `.venv` 3.13 | «Successfully uninstalled» ×2; el venv 3.12 los conserva (su prueba sigue OK) |
| 3 | Experimentos con MKL PARDISO por ctypes (scratchpad): `pardiso_getdiag` da los pivotes dᵢ de LDLᵀ y la diagonal de A **en el orden de eliminación** (`iparm(5)=2` lo devuelve: `da == diag(A)[perm]`); con mtype 2 un mecanismo es el error −4 con la ecuación (base 1, numeración original) en `iparm(30)`; un casi-mecanismo (1e-14) factoriza y se ve en dᵢ/Aᵢᵢ = 4,9e-15 | Diseño de `Factorizacion` con el mismo criterio de pivote escalado para SuperLU y PARDISO |
| 4 | Umbral medido (naves sintéticas propias, `Kff` real): con MKL cargada, SuperLU/PARDISO = 0,012/0,005 s a 1 260 GDL, 0,49/0,064 s a 10 296 y 8,8/0,33 s a 38 556; en proceso nuevo (estático completo) 0,47/0,51 s a 5 940 y 1,08/0,77 s a 10 296; carga de MKL ≈ 0,15–0,25 s | `UMBRAL_PARDISO = 5000` (F0-27) |
| 5 | `covillaf.sim.solver.lineal`: envoltorio PARDISO (mtype 2/−2, `iparm(8)=2`, base 0, diagonal siempre en el patrón), `usar_resolvedor`, `inercia` (PARDISO o SuperLU); estático y modal con `resolvedor`; modal con error regresivo por modo, **certificado de Sturm** y `modos_por_debajo` | F0-27 hecho, F0-31 |
| 6 | Casos nuevos con la tolerancia fijada antes de ejecutar: **V-B19** (ménsula de 100 barras, cond₂ ≈ 4e12, 1e-8) y **V-M10** (recuento de Sturm frente al espectro analítico de una ménsula 3D, tolerancia 0) | Registro: **29 casos, 85 comprobaciones**, en verde con SuperLU y con PARDISO. V-B19 con PARDISO: 3,6e-8 sin refinar, 5,2e-11 con 2 pasos; SuperLU 2,3e-11 |
| 7 | Pruebas: `test_lineal.py` (11), modal (+6), mecanismos y PR-01 (A3, A4, A11) con los dos resolvedores, PR-01 partido en 16 (5 904 GDL): «auto» elige PARDISO y coincide con SuperLU a 1,2e-10 (residuo relativo 6e-9 en los dos; desequilibrio 5,9e-12 frente a 7,2e-11) | 156 pruebas en verde |
| 8 | `tools/comprobar_entorno.py`: las tres pruebas débiles del incidente 18, ahora con criterio: PARDISO (40 000 incógnitas: 3,5e-14 frente a SuperLU; Sturm 150 = 150 autovalores analíticos del laplaciano), Kratos (ménsula: 1,3e-10 frente a PL³/3EI) y CalculiX `ccx_static` (parche C3D8: exacto con las 7 cifras del `.dat`); `herramientas.ps1` anota los bytes reales | `.herramientas/registros/comprobar_entorno-2026-09-24.log`: «NÚCLEO: 0 fallos · OPCIONAL: 0 ausentes o con fallo» |
| 9 | Grafo **v0.3** (170 nodos, 336 aristas): `fmt_vybres`, `h_pardiso` en uso, `cap_flexibilidad_tuberias` (Fase 3) con CAESAR II y AutoPIPE (solo documentación pública) y `n_b31_3` | Validador en verde |
| 10 | Commit `c72453a` (bloque 1). Tres subagentes Opus en segundo plano (uso del plan: 28 % de la ventana de 5 h, 22 % semanal): auditor del bloque 1 y fichas + parches D-8 y D-11/D-13 para DESIGN (sobre copias en el scratchpad) | Auditor: **APTO CON RESERVAS**, 6 arreglos requeridos |
| 11 | Arreglos de la auditoría: GDL del pivote de SuperLU = `argsort(perm_c)[k]` (comprobado reconstruyendo A = Prᵀ·L·U·Pcᵀ; venía de `4ecb699`), inercia SuperLU no concluyente con pivotes fuera de la diagonal, σ > 0 en el camino denso y semántica «modos más próximos a σ», σ sobre un valor propio con PARDISO (se mueve), reducción exacta con pocos GDL con masa, marca `certificado`, CLI de verificación en UTF-8 y con código de salida | 11 pruebas nuevas; 29 casos y 85 comprobaciones siguen en verde con los dos resolvedores |
| 13 | Bloque 3 (formatos): contenedor común y esquemas (orquestador); `analysis.ifc` y `.vybres` (dos subagentes Opus, con contratos fijos); propuestas D-8, D-11 y D-13 entregadas (dos subagentes) | 69 pruebas de `covillaf.sim.io`; **A10**: `.vybs` renombrado a `.zip` con IFC válido (0 incidencias) y JSON válidos, ida y vuelta con el mismo análisis; VTK, pyvista y ParaView leen el `.vybres` bit a bit |
| 14 | Auditoría del bloque 3 (APTO CON RESERVAS: robustez del contenedor, cabecera IFC con la hora real, colisión de nombres de tramos, validaciones de `analysis.ifc`) y sus 8 arreglos por un corrector Opus | 29 pruebas nuevas que fallan con `469a9f4` y pasan ahora; 97 pruebas de `covillaf.sim.io` |
| 15 | **Kernel** `covillaf_sim_kernel` (F0-24) por un constructor Opus; `covillaf_design.pth` enlaza `apps\kernel\src` de DESIGN; `pip install -e apps/kernel --no-deps` | 92 pruebas del kernel; batería 355 pruebas; CI rápida en verde |
| 12 | **`covillaf.sim.io`** (bloque 2): `secciones` (cara OCCT de DESIGN + J declarada; ejes principales), `materiales` (biblioteca, `Pset_MaterialMechanical`, acero genérico), `vyba` (reglas de F0-32); `tests/fixtures/vyba_sinteticos.py` escribe el pórtico de DESIGN y el PR-01 (a, b) con el exportador de DESIGN | **A1 cumplido**: PR-01 desde `.vyba` = PR-01 (nodos y barras exactos, propiedades ≤ 1e-12, estático ≤ 1e-9); escribir 0,37 s, leer y derivar 0,08 s |

Incidentes de la sesión 3:

20. **`mkl_set_interface_layer` en minúsculas es la interfaz Fortran** (argumento por referencia): llamarla por valor dio
    «access violation reading 0x0» y 15 casos modales en rojo. La interfaz C es `MKL_Set_Interface_Layer`.
21. **Constante como valor por defecto**: cambiar `lineal.REFINAMIENTO` en caliente no alteraba nada (el valor se fija al
    definir la función) y la primera medida del efecto del refinamiento salió igual en 0, 1 y 2 pasos. Se repitió
    pasando el parámetro: 3,6e-8 / 3,6e-8 / 5,2e-11.
22. **Umbrales de prueba sin base** (míos, no del motor): residuo 1e-13 sobre ‖b‖ con b aleatorio, igualdad de bits entre
    resolver una columna o un bloque en PARDISO, 1e-10 entre resolvedores en PR-01×16. Se sustituyeron por criterios
    medidos y justificados (PARDISO no peor que SuperLU; 1e-12; 1e-9).
23. **Un `python -` suelto** en una orden de bash quedó esperando la entrada estándar (tarea en segundo plano detenida;
    no escribió nada) y **un heredoc con comillas volvió a fallar** (como los incidentes 5 y 14): los guiones de edición
    de documentos se escriben con la herramienta de archivos y se ejecutan aparte.
24. **Un `grep -rn` sobre `.`** (buscar quién construye `ResultadosModales`) recorrió `node_modules` y `.venv` (tarea lenta, sin consecuencias):
    las búsquedas se limitan a `packages tests tools apps docs`.
25. **Fallo de localización heredado** (auditoría): desde `4ecb699` el GDL del pivote mínimo de SuperLU se leía con
    `perm_c[k]` y no con la permutación inversa; las pruebas solo pedían «un GDL del mecanismo» y no lo vieron. Ahora
    una cadena de 12 GDL exige el GDL dentro del mecanismo (el código viejo decía el 0; el nuevo, el 5).
26. **Prueba mal planteada otra vez** (mía): el pilar de prueba tenía Iy = Iz (modos dobles) y σ = √(λ₆·λ₇) cayó sobre
    un valor propio doble; el certificado lo detectó bien («faltan 1 modos»). Se rehízo con inercias distintas y σ en
    un hueco del espectro.
27. **J de pared delgada en perfiles laminados**: sin los acuerdos, J sale un 23 % (HEA300) y un 18 % (IPE300) por debajo
    de `sectionproperties` en el pórtico de DESIGN. Es la fórmula declarada (F0-26/F0-28), pero conviene una fórmula
    publicada con acuerdos (pendiente, con su fuente).
28. **El entorno impide a los subagentes escribir `.md`** (también en el scratchpad): el constructor de `analysis.ifc`
    devolvió el documento en su respuesta y lo copió el orquestador. **`covillaf.core.hash` solo normaliza verdades
    ISO 10303-21**: un `.vybres` (HDF5) fallaba; el contenedor calcula su hash con los bytes de la verdad (F0-33).
    **Escapes en guiones**: una secuencia de escape de salto de línea dentro de un guion de edición se convirtió en salto de línea real (se arregló con la
    herramienta de edición).

## Sesión 4 (2026-09-24)

Encargo del usuario: auditar el kernel, añadir al motor progreso y cancelación, y el escritorio (visor de COVILLAF 3D por
alias, capa de resultados y asistentes). Commits `a32e22f`, `6fc4e37`, `f76a4ce` (detalle en `docs/HANDOFF.md`).

- Agentes (todos Opus): tres auditores (`auditor-scripts`: kernel, commit `a32e22f`, commit `6fc4e37`; los tres
  OBSERVADO, todo arreglado o documentado), un explorador de la receta de escritorio de DESIGN y dos constructores
  en paralelo (`apps/desktop`, `packages/viewer`); la interfaz, la capa de resultados del kernel y la integración, el
  orquestador. Pico de uso: 5 h 8 %, semanal 44 % al empezar.
- Verificación de extremo a extremo con capturas: prueba de humo de Electron con el kernel real (34/34).

29. **`write_text` de Python en Windows escribió CRLF** en `ensamblado.py` (editado con un `python -` en bash, contra la
    regla): se devolvió a LF con `sed` y se siguió con la herramienta de edición.
30. **Un heredoc con barras invertidas** (rutas `\\?\` en una prueba) llegó alterado al archivo: ruff lo detectó y se
    corrigió con la herramienta de edición (cadenas crudas). Tercera vez que un heredoc falla (incidentes 5, 14, 23):
    la regla del HANDOFF se refuerza con estos dos casos.
31. **Prueba de humo que buscaba un botón en una pestaña cerrada** (mía): la cinta solo monta los botones de la pestaña
    visible. Y un **defecto real** que la captura dejó ver: la hoja del visor pone `position: relative` en su
    contenedor y el lienzo se quedaba en 150 px de alto (arreglado en `estilos.css`).
32. **El «máximo» de los esfuerzos era la norma de N, V y M juntos** (N y N·mm mezclados): lo vi en la captura; ahora
    uno por componente (kernel) y el rango de la componente dibujada (interfaz).
33. **Mi arreglo de `frame-src 'none'` no llegaba a la cabecera servida** (solo a `politicaCsp()`): lo detectó la prueba
    de seguridad del escritorio; se corrigió en `cabecerasSeguridad()`.
34. **El visor de COVILLAF 3D cambió durante la sesión** (otra sesión: `motor.ts` y `memoria.ts` nuevos): la huella lo
    avisó; se aceptó tras tipos, pruebas y humo en verde con el nuevo.

## Encargos a agentes (relanzados en la sesión 2)

Texto completo, tal como se lanzó (con las rutas de esa sesión), en `docs/fase0/encargos/`. Resumen:

| Informe | Encargo |
|---|---|
| `01_capacidades_referencia.md` | Capacidades de SAP2000, ANSYS, Robot, Inventor (Nastran, Dynamic Simulation, Frame Analysis, Shape Generator), SolidWorks (Simulation, Motion, Flow) y complementarias (ETABS, Abaqus, STAAD, RFEM, COMSOL, PrePoMax, OpenSees, IDEA StatiCa), **solo por documentación pública**; tabla maestra capacidad → referencia → cómo lo hará SIMULATE → prioridad → verificación; MVP; benchmarks públicos; normas (RNE E.020/E.030/E.060/E.090, ASCE 7, AISC 360, ACI 318) |
| `02_investigacion_stack_simulacion.md` | Stack OSS de simulación con prueba práctica en venv propio (scikit-fem, PyNite, Kratos, OpenSees, netgen, gmsh, meshio, vtk, pypardiso, ccx); licencias con matices; recomendación por capa y binarios con hash |
| `03_reutilizacion_familia.md` | Auditoría de solo lectura de DESIGN y 3D: inventario reutilizable (bus, RPC, VYBM, contenedores, visor por alias, desktop, CI); modelo BIM → modelo analítico y propuestas hacia DESIGN; resultados en el visor (VYBR); publicar en COVILLAF 3D; riesgos de acoplamiento |
| `04_formatos_simulacion.md` | IFC 4.3 estructural, SAF, CIS/2, Nastran, INP/FRD, MSH, MED, VTU/XDMF, s2k/OAPI, Robot API…; propuesta `.vybs` y resultados; JSON Schema; prueba práctica con ifcopenshell, meshio y pyNastran |

Reglas que todo encargo lleva escritas: clean-room (nada de binarios ni instalaciones comerciales), confidencialidad
(nada de proyectos reales; coordenadas de ejemplo EPSG:32755), marcas de verificación [L]/[W]/[D]/[inferido]/[no
verificado], solo escritura en su informe y su scratchpad, hermanos de solo lectura, sin `git`, sin instalar en el proyecto.

## Incidentes

1. **Límite semanal de Opus** (HTTP 429, «resets Sep 28, 4pm America/Lima»): los cuatro agentes opus terminaron
   nada más arrancar. Según la regla global (mismo error dos veces ⇒ parar; Fable en subagentes solo avisando
   antes), no se reintentó ni se lanzaron subagentes Fable. La investigación esencial la hizo el orquestador de forma
   acotada; los informes profundos quedan como P-01.
2. **pyNastran 1.4.1 exige `numpy<2`** (sin rueda cp313): `pip` no pudo resolver `requirements-dev.txt`. Se sacó del
   núcleo (F0-11) y se reinstaló con éxito.
3. **openseespy 3.8 no carga en Python 3.13 en Windows** (`DLL load failed while importing opensees`); en un venv
   3.12 aparte importa y resuelve una cercha con resultado exacto. Decisión F0-08 (subproceso con intérprete 3.12).
4. **Prueba de scikit-fem mal escrita** (selección de grados de libertad por facetas en vez de por nodos: flecha
   `nan`). Corregida a `get_dofs(nodes=…)`: error 0,19 % frente a Timoshenko. Anotado como ejemplo de por qué cada
   prueba lleva criterio numérico y no solo «se ejecutó».
5. **Heredoc múltiple en bash falló** (comilla sin cerrar en el análisis previo; no se escribió nada): los seis
   archivos se escribieron con la herramienta de escritura. Sin consecuencias.
6. **`cupy-cuda13x` importa con aviso**: no hay runtime CUDA (`CUDA_PATH`). Pendiente P-07; `warp-lang` importa
   (uso real de la GPU no verificado).
7. **Grafo v0.1 con dos errores** detectados por su propio validador (capa de `mod_viewer` igual a la de `mod_ui`, de
   la que depende; `cap_publicar_3d` sin referencia que la inspire). Corregidos antes de generar.
