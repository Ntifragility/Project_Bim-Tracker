# COVILLAF SIMULATE — Arquitectura

Estado: **Fase 1 en curso** (núcleo del solver verificado; kernel con progreso y cancelación dentro del motor, F0-34;
escritorio Electron con el visor de COVILLAF 3D por alias, capa de resultados VYBF y asistentes, F0-35…F0-37)
· versión 0.4 · 2026-09-24 · autor: orquestador (Claude). Las decisiones marcadas
**[tomada]** vienen del prompt maestro ([`docs/00_prompt_maestro.md`](docs/00_prompt_maestro.md)) y no se reabren; las
**[F0]** se toman en esta fase con evidencia y están en [`docs/decisiones.md`](docs/decisiones.md); las **[H]** se
heredan de COVILLAF 3D y COVILLAF DESIGN. Lo inferido va como **[inferido]**; lo no comprobado, **[no verificado]**. El
alcance completo (referencias → capacidades → módulos → herramientas → formatos, por fases) vive en el
**grafo** [`docs/grafo/`](docs/grafo/): este documento lo explica, no lo sustituye.

---

## 1. Qué es

COVILLAF SIMULATE es el **motor de simulación y análisis** de la familia COVILLAF para plantas industriales. Recibe los
modelos de **COVILLAF DESIGN** (ensambles `.vyba`, piezas `.vybp`, proyecto `.covillaf`, IFC 4.3, STEP), construye el
modelo analítico, lo resuelve (con su propio motor o con solvers libres enchufables), verifica por norma, y publica
resultados en **COVILLAF 3D** y en formatos abiertos. Toma de cada referencia su mejor capacidad **[tomada]**:

| Referencia | Su mejor capacidad | Cómo la resuelve COVILLAF SIMULATE | Módulo | Fase |
|---|---|---|---|---|
| SAP2000 | Análisis estructural general: barras, cáscaras, modal, espectro, tiempo-historia, pushover, diseño, OAPI | Modelo analítico IFC-nativo; solver propio verificado; combinaciones y espectros por norma; API Python «todo es un comando» | modelo, solver, normas, scripting | 1–4 |
| Robot Structural Analysis | Diseño por normas, integración BIM (Revit), cargas de viento y sismo, informes | Modelo derivado del `.vyba` con niveles y ejes del proyecto; cargas por E.020/E.030/ASCE 7; memoria de cálculo automática | io, normas | 1–3 |
| ANSYS Mechanical | Sólidos, contacto, no lineal, térmico, fatiga, mallado avanzado, verificación | Kratos en proceso y CalculiX por subproceso sobre mallas de netgen/gmsh; casos NAFEMS en la CI | malla, adaptadores | 2–4 |
| ANSYS Fluent · SolidWorks Flow | CFD | Casos de OpenFOAM/SU2 generados desde el modelo; presiones de vuelta como cargas | adaptadores | 5 |
| Inventor Nastran · SolidWorks Simulation | FEM accesible dentro del CAD: asistentes, mallado automático, contornos, informes | Interfaz con asistentes por tipo de análisis; mallado automático desde el B-rep de `.vybp`/STEP; resultados en el visor | ui, malla, viewer | 1–2 |
| Inventor Dynamic Simulation · SolidWorks Motion | Mecanismos: juntas, motores, cargas al FEM | Multicuerpo por adaptador (MuJoCo en evaluación; Project Chrono pendiente) y reacciones como cargas | adaptadores | 4 |
| Inventor Shape Generator · SolidWorks topología · ANSYS DesignXplorer | Optimización | Barridos y optimización de parámetros (nlopt, pymoo, openmdao) y topología SIMP sobre sólidos | scripting, solver | 4 |
| CAESAR II · AutoPIPE (solo documentación pública) | Flexibilidad y tensiones de tuberías por ASME B31.3 | Modelo de barras desde el piping de DESIGN; codos y tes con factores de flexibilidad y SIF; apoyos con holgura y fricción; cargas en toberas (P-17) | io, solver, normas | 3 |
| PrePoMax + CalculiX · OpenSees · Abaqus | Flujo FEM abierto; dinámica no lineal; formato INP | Adaptadores con el mismo modelo; comparación automática entre solvers; INP y FRD como formatos de intercambio | adaptadores, io | 2–3 |

Objetivo del usuario **[tomada]**: software **flexible y mejorable** (todo es un comando, solvers enchufables,
formatos abiertos) que haga las simulaciones **más accesibles** (asistentes, unidades explícitas, plantillas, el
modelo BIM ya es el modelo de análisis) y **más precisas** (doble precisión, casos de verificación obligatorios,
convergencia de malla declarada, comparación entre solvers).

## 2. Principios

1. **El modelo BIM es el modelo de análisis** [F0]: nodos, barras, placas y apoyos se derivan del `.vyba` por GUID;
   la verdad del modelo de simulación es IFC 4.3 (`IfcStructuralAnalysisModel`) ligada a los elementos físicos.
2. **Estándares abiertos por dentro** [H]: `.vybs` es un ZIP con IFC y JSON validado; los resultados salen también en
   VTU/XDMF y HDF5 documentado. Nada queda atrapado.
3. **Verificable o no existe** [F0]: cada elemento y cada tipo de análisis lleva su caso de verificación (analítico,
   NAFEMS, ejemplo público de un solver libre) con tolerancia declarada, en la CI. Un resultado sin caso de
   verificación no se presenta como válido.
4. **Todo es un comando** [H]: cada acción de la interfaz, de la API Python y del historial es el mismo comando del
   bus del kernel, en una transacción; los análisis son tareas con progreso y cancelación.
5. **Doble precisión, unidades explícitas** [H][F0]: motor en doble; sistema coherente N·mm·s·t; la unidad se muestra
   siempre; nunca UTM crudo en float32 hacia la GPU.
6. **Solver propio para lo esencial, solvers libres para lo demás** [F0]: el motor propio cubre pórticos 3D, modal,
   pandeo, P-Delta y continuo básico con control total; Kratos, CalculiX, OpenSees, SU2/OpenFOAM entran por
   **adaptadores** con el mismo modelo y se comparan entre sí.
7. **Licencias limpias** [H][F0]: permisivas y LGPL en proceso; GPL solo como proceso aparte; OpenSees condicionado a
   la decisión de distribución; cada pieza con licencia anotada.
8. **Reutilizar antes que construir** [tomada]: visor de COVILLAF 3D por alias; bus de comandos, protocolo RPC, VYBM,
   contenedores y `covillaf.core/geometry/io` de DESIGN por ruta; scikit-fem, netgen, meshio, pyvista.
9. **Local y confidencial** [H]: kernel en 127.0.0.1; nada sale de la máquina; sin telemetría; datos de proyectos
   reales nunca en git.
10. **Clean-room** [H]: de los productos de referencia se toman capacidades, nunca código, textos, ejemplos ni marca.

## 3. Stack (verificado en esta máquina el 2026-09-23)

Detalle, hashes y comandos: [`docs/fase0/herramientas_descargadas.md`](docs/fase0/herramientas_descargadas.md).

| Pieza | Elección | Versión | Licencia | Modo |
|---|---|---|---|---|
| Escritorio e interfaz | Electron · TypeScript · Vite (idénticos a COVILLAF 3D y DESIGN) | 44.4.5 · 7.0.2 · 8.3.0 | MIT · Apache-2.0 · MIT | interfaz |
| Visor 3D | Visor de COVILLAF 3D: three.js + That Open (`components` 3.4.8, `components-front` 3.4.4, `fragments` 3.4.7) + camera-controls 3.1.2 | three 0.186.0 | MIT | interfaz, por alias |
| Kernel | Python (proceso aparte) | 3.13.15 | PSF | — |
| Álgebra y solvers propios | numpy · scipy (SuperLU, ARPACK) · MKL PARDISO (`mkl`, envoltorio ctypes propio, F0-27) · numba · sympy | 2.5.3 · 1.18.1 · 2026.1.0 · 0.67.0 · 1.14.0 | BSD · BSD · ISSL · BSD · BSD | proceso |
| FEM continuo | scikit-fem | 12.0.2 | BSD-3 | proceso |
| Validación cruzada de pórticos | PyNiteFEA | 3.2.0 | MIT | proceso |
| Secciones | sectionproperties (+ catálogos de DESIGN) | 3.10.2 | MIT | proceso |
| Unidades | pint | 0.26.1 | BSD-3 | proceso |
| Mallado | netgen-mesher (proceso) · Gmsh 4.15.2 (`gmsh.exe`, subproceso) | 6.2.2607 · 4.15.2 | LGPL-2.1 · GPL-2.0+ | proceso · subproceso |
| Intercambio de mallas | meshio · trimesh · shapely · rtree | 5.3.5 · 5.1.0 · 2.1.2 · 1.4.1 | MIT · MIT · BSD · MIT | proceso |
| Resultados | h5py (HDF5/VTKHDF 2.2, F0-12) · vtk · pyvista | 3.16.0 · 9.7.0 · 0.49.0 | BSD · BSD · MIT | proceso |
| Informes | pandas · matplotlib · jinja2 · openpyxl | 3.0.6 · 3.11.2 · 3.1.6 · 3.1.5 | BSD · PSF · BSD · MIT | proceso |
| Geometría e IFC | OCCT 8.0.1 (`cadquery-ocp-novtk`) · IfcOpenShell · ezdxf | 8.0.1.0.0 · 0.8.5 · 1.4.4 | Apache/LGPL+exc · LGPL-3.0 · MIT | proceso |
| Familia | `covillaf.core` · `covillaf.geometry` · `covillaf.io` de DESIGN por `.pth` | — | propietario (familia) | proceso |
| Multifísica externa | Kratos Multiphysics (+ Structural, LinearSolvers, ConvectionDiffusion, Contact, Meshing, Mapping, FluidDynamics) | 10.4.3 | BSD-4 (mención en publicidad) | proceso (evaluación) |
| Sólidos y térmico externo | CalculiX `ccx` 2.23 (binario oficial); **solo continuo**: expande las vigas a sólidos (F0-22) | 2.23 | GPL-2.0 | subproceso |
| Dinámica no lineal externa | OpenSeesPy en `.herramientas/venv-opensees` (Python 3.12) | 3.8.0.0 | OpenSees (no comercial sin acuerdo) | subproceso, **en cuarentena** (P-02) |
| Verificador de BDF/OP2 | pyNastran en un Python 3.12 aparte (F0-11) | 1.4.1 | BSD-3-Clause | subproceso, opcional |
| CFD externo | SU2 8.5.0 · OpenFOAM v2506 Windows (instalador, no ejecutado) | 8.5.0 · v2506 | LGPL-2.1 · GPL-3.0 | subproceso (Fase 5) |
| Post-proceso externo | ParaView portable | 6.1.1 | BSD-3 | externo |
| Optimización | nlopt · pymoo · optuna · openmdao | 2.11.0 · 0.6.2 · 5.0.0 · 3.45.1 | MIT · Apache · MIT · Apache | proceso |
| GPU (evaluación) | warp-lang · cupy-cuda13x (sin runtime CUDA aún, P-07) | 1.17.0 · 14.2.0 | Apache-2.0 · MIT | proceso |
| Protocolo y esquemas | websockets · jsonschema · referencing · rfc8785 | 17.1 · 4.26.0 · 0.37.0 · 0.1.4 | BSD · MIT · MIT · Apache | proceso |
| Conectores COM | pywin32 · comtypes | 312 · 1.4.17 | PSF · MIT | conector (Fase 5) |
| Calidad | pytest · ruff · import-linter · `node --test` · `tsc` | 9.1.1 · 0.16.8 · 2.15 | MIT · MIT · BSD-2 | — |

## 4. Topología en ejecución

```
┌──────────────────────────── COVILLAF SIMULATE (Electron 44) ────────────────────────────────────┐
│ Proceso principal (apps/desktop): ventana · menús · GPU dedicada · lanza y vigila el kernel   │
│        │  python -m covillaf_sim_kernel --puerto 0 --token-stdin   (token por stdin, 127.0.0.1)  │
│        ▼                                                                                      │
│ Renderer (packages/ui + packages/viewer)      ◄═══►   Kernel (apps/kernel · Python 3.13)      │
│   cinta por análisis · línea de comandos       WS     bus de comandos + transacciones + tareas │
│   navegador del modelo · propiedades         JSON-RPC modelo · malla · solver · normas         │
│   asistentes · tablas · visor de COVILLAF 3D    + VYBM/  resultados (HDF5) · io                   │
│   + capa de resultados (VYBR)                  VYBR   adaptadores ──► procesos aparte:         │
│                                                        gmsh.exe · ccx · python3.12 (OpenSees)  │
│                                                        SU2_CFD · OpenFOAM   (archivos + cola)  │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
      ▲ lee (.vyba/.vybp/.covillaf/IFC/STEP)                   │ publica (IFC + Psets, BCF)   │ VTU/XDMF
      │                                                     ▼                              ▼
   COVILLAF DESIGN (PRJ-XXXX_Nombre/ ISO 19650)         COVILLAF 3D (127.0.0.1:5180)          ParaView / Python
```

- El **kernel** es la única pieza que modifica el modelo de simulación y lanza análisis; la interfaz nunca escribe
  archivos ni ejecuta solvers.
- Protocolo: el de DESIGN ([`docs/protocolo/rpc.md`](https://github.com/) de aquel repo, v1) más los métodos de
  tareas (`tarea.iniciar`, `tarea.cancelar`, `tarea.progreso`) y las tramas de resultados VYBR; se especifica en
  `docs/protocolo/` en la Fase 1.
- Los solvers externos corren como **procesos hijos** con carpeta de trabajo propia, salida por archivos, progreso
  leído de su stdout y cancelación por terminación del proceso. Nunca se enlaza GPL al kernel.

## 5. Monorepo

```
07.36 COVILLAF SIMULATE/
├─ ARCHITECTURE.md · CLAUDE.md · README.md · pyproject.toml (herramientas) · package.json (workspaces npm)
├─ docs/               grafo/ (fuente + generados) · formatos/ · protocolo/ · fase0/ · decisiones.md · HANDOFF.md
├─ schemas/            JSON Schema 2020-12 de analisis.json, manifest de .vybs, resultados; ejemplos válidos
├─ packages/
│  ├─ modelo/       (py) covillaf.sim.modelo       nodos, barras, cáscaras, sólidos, materiales, secciones, apoyos, cargas, casos, combinaciones
│  ├─ malla/        (py) covillaf.sim.malla        geometría → malla (netgen, gmsh), calidad, correspondencia con el B-rep
│  ├─ resultados/   (py) covillaf.sim.resultados   HDF5, campos, envolventes, extracción para el visor y las tablas
│  ├─ io/           (py) covillaf.sim.io           .vybs, IFC estructural, VTU/XDMF, INP/FRD, MSH, BDF, SAF, s2k, Excel, informes; lectura de .vyba/.vybp
│  ├─ solver/       (py) covillaf.sim.solver       elementos, ensamblado, estático, modal, pandeo, P-Delta, dinámico, verificación
│  ├─ adaptadores/  (py) covillaf.sim.adaptadores  Kratos · CalculiX · OpenSees · SU2/OpenFOAM · multicuerpo
│  ├─ normas/       (py) covillaf.sim.normas       cargas y combinaciones por norma; acero y concreto; ratios D/C
│  ├─ scripting/    (py) covillaf.sim.scripting    API Python pública, CLI
│  ├─ ui/           (ts) @covillaf-simulate/ui     cinta, línea de comandos, navegador, propiedades, asistentes, tablas
│  └─ viewer/       (ts) @covillaf-simulate/viewer visor de COVILLAF 3D por alias + capa de resultados VYBR
├─ apps/
│  ├─ kernel/       (py) covillaf_sim_kernel       bus de comandos, transacciones, tareas, servidor RPC
│  └─ desktop/      (js) Electron: proceso principal, preload, seguridad
├─ connectors/      sap2000/ · robot/ · inventor/ · solidworks/ (COM; validación cruzada, Fase 5)
├─ tests/           fixtures sintéticos · verificacion/ (casos analíticos y NAFEMS) · interop/
├─ tools/           instalar.ps1 · ci.ps1 · herramientas.ps1 · comprobar_entorno.py · generar_grafo.py · servir_grafo.mjs
├─ .herramientas/   (ignorada) binarios de terceros con hash, venv-opensees (3.12), registros
└─ recursos/marca/  logo original de COVILLAF SIMULATE
```

**Capas** [F0] (import-linter y el grafo comprueban lo mismo; cada capa solo importa las inferiores):

```
covillaf_sim_kernel > covillaf.sim.scripting > covillaf.sim.normas > covillaf.sim.solver | covillaf.sim.adaptadores > covillaf.sim.io > covillaf.sim.malla | covillaf.sim.resultados > covillaf.sim.modelo
```

`solver` y `adaptadores` no se conocen: ambos producen `resultados` con el mismo esquema, y `normas` los consume sin
saber quién resolvió. `covillaf.core`, `covillaf.geometry` y `covillaf.io` (DESIGN) están por debajo de `modelo`.

## 6. Modelo analítico (`covillaf.sim.modelo`)

| Concepto | Contenido | Correspondencia IFC 4.3 |
|---|---|---|
| Nodo | posición (mm, marco local de proyecto), grados de libertad, restricciones, resortes, masa concentrada | `IfcStructuralPointConnection` + `IfcBoundaryNodeCondition` |
| Barra | nodos i–j, sección, material, ejes locales (giro), **liberaciones** en extremos, **desfases** (punto cardinal y excentricidades), cargas | `IfcStructuralCurveMember` (+ `IfcStructuralCurveConnection`), `IfcRelAssignsToProduct` → `IfcBeam`/`IfcColumn` |
| Cáscara | polígono de nodos, espesor, material, ejes locales, liberaciones de borde | `IfcStructuralSurfaceMember` → `IfcPlate`/`IfcSlab`/`IfcWall` |
| Sólido | malla tet/hex sobre un B-rep de `.vybp`/STEP, material | representación por malla (no hay miembro IFC de sólido: `IfcStructuralSurfaceMember` no aplica) **[inferido]** |
| Material | E, ν, G, ρ, α; curvas plásticas; dependencia térmica; fuente y estado de verificación por fila | `IfcMaterial` + `Pset_MaterialMechanical`/`Thermal` |
| Sección | del catálogo de DESIGN (perfil paramétrico) o arbitraria (`sectionproperties`) | `IfcProfileDef` + `IfcMaterialProfileSet` |
| Apoyo | fijo, elástico, inclinado, unilateral | `IfcBoundaryNodeCondition` (rigideces) |
| Liberación · excentricidad | GDL liberados por extremo; desfases rígidos | `IfcRelConnectsStructuralMember.AppliedCondition` · `IfcRelConnectsWithEccentricity` (en `analysis.ifc`, no en JSON: F0-16) |
| Restricción | diafragma rígido, cuerpo rígido, ecuación lineal | no nativo en IFC: `datos` en `analisis.json` |
| Carga | puntual, distribuida, de área, temperatura, presión, peso propio, aceleración | `IfcStructuralPointAction`/`CurveAction`/`SurfaceAction` + `IfcStructuralLoad*` |
| Caso · combinación | tipo (D, L, W, E, T), factores, envolventes | `IfcStructuralLoadCase` · `IfcStructuralLoadCombination` |
| Resultado | reacción, desplazamiento, esfuerzo, tensión, modo | `IfcStructuralResultGroup` + `IfcStructuralPointReaction` (solo lo que IFC expresa; el resto en HDF5) |

Del `.vyba` al modelo analítico [F0-26, verificado con el pórtico sintético de DESIGN en el informe 03 §2.3]: cada
`IfcBeam`/`IfcColumn`/`IfcMember` aporta el eje (`Axis` × `ObjectPlacement`, en doble y mm), el perfil
(`IfcMaterialProfileSetUsage`: A e I exactas con la cara OCCT de `covillaf.geometry.perfiles`, J por fórmula declarada —`sectionproperties` solo en desarrollo, F0-28—
y su origen declarado) y el nombre del material. El `Axis` es la línea de referencia del punto cardinal; el desfase al
baricentro entra como desfase rígido (opción declarada con los resultados). Los ejes del `ObjectPlacement` de DESIGN
coinciden con la convención de F0-18 (X del perfil = y local, Y del perfil = z local). Nodos por fusión de extremos a
≤ 1 mm, con partición en uniones en T y cruces; apoyos sugeridos por placa base. Lo que el `.vyba` aún no trae
(liberaciones, condición de las conexiones, apoyos, E·ν·ρ) se completa en SIMULATE por GUID y se pide a DESIGN (P-09:
D-1…D-7). **Hecho en la sesión 3** (`covillaf.sim.io.leer_vyba`, F0-32): ejes locales = ejes principales del perfil,
excentricidad con el centroide, cruces unidos solo si una conexión lo declara, condiciones por tabla de componentes y
nombres de nodos desde la rejilla y los niveles; el PR-01 escrito con el exportador de DESIGN se lee idéntico al PR-01
(criterio A1).

## 7. Unidades, precisión y verificación

- **Unidades internas** [F0-06]: N, mm, s, t (masa) ⇒ MPa, N·mm, t/mm³, mm/s². Entrada, salida, API e informes
  convierten con `pint` y muestran la unidad. Nunca hay factores implícitos en el código del solver.
- **Precisión**: doble en todo; SuperLU simétrico por debajo de 5 000 GDL y MKL PARDISO (directo, multinúcleo, dos
  pasos de refinamiento iterativo) desde ahí, con los dos elegibles (F0-27); certificado de Sturm y error regresivo por
  modo en el modal (F0-31); iterativos (CG/AMG) para sólidos grandes;
  condicionamiento y residuo relativo reportados con cada solución.
- **Verificación** [F0-20]: registro `covillaf.sim.solver.verificacion` (V-Bxx estático, V-Mxx modal) con la fuente de la
  fórmula, la magnitud, la unidad y la tolerancia **fijada antes de ejecutar**; `tests/verificacion/` los corre en la CI
  y `python -m covillaf.sim.solver.verificacion` imprime la tabla. Hoy: **29 casos, 85 comprobaciones**, que pasan con **los dos resolvedores**; los estáticos
  quedan en ≈ 1e-16 (el elemento es exacto) y los modales dentro del error de discretización previsto por la teoría.
  Validación cruzada: PyNite en un pórtico 3D de 42 barras con diferencias ≤ 4e-12. Benchmarks por venir: NAFEMS P18
  (de pago, P-13), Comentario de AISC 360, FeenoX LE10, suites de Kratos y CalculiX (informe 01 §5).
- **Diagnóstico** [F0-19]: cada solución informa residuo relativo, desequilibrio (cargas + reacciones, escalado por la
  suma de módulos), pivote mínimo del sistema escalado y las direcciones sin rigidez estabilizadas; un mecanismo cargado
  es un error que nombra el nodo y el GDL.
- **Convergencia de malla**: para sólidos y cáscaras se declara con el resultado (dos mallas, estimación de error) y
  el informe lo incluye.

## 8. Formatos [F0-12, F0-16, F0-25; informe 04; especificación en `docs/formatos/` en la Fase 1]

| Formato | Rol | Contenido |
|---|---|---|
| `.vybs` (modelo de simulación; hecho en la sesión 3, F0-33, `docs/formatos/vybs.md` y `analysis_ifc.md`) | nativo | ZIP determinista (reglas de `contenedores.md` de DESIGN, sin cambios): `mimetype` `application/vnd.covillaf.simulacion+zip`, `manifest.json`, **verdad** `analysis.ifc` (IFC4X3_ADD2: `IfcStructuralAnalysisModel` con nudos, barras, perfiles, apoyos, resortes, liberaciones, excentricidades, casos y combinaciones lineales; unidades N·mm·s·t con la masa en MEGA GRAM; copias de referencia de los elementos físicos sin `Body`; GUID analíticos UUID v5), **datos** `analisis.json` (categoría normativa, envolventes, definiciones de análisis, fuente de masa, discretización, restricciones no IFC; ángulos en rad; `urn:covillaf:esquema:vybs:analisis:1`) y `enlaces.json` (GUID + `hash_contenido` del origen), **cache** `mesh/*.vybm` |
| `.vybres` (resultados; P-12; hecho en la sesión 3, F0-33, `docs/formatos/vybres.md`) | nativo abierto | ZIP con `resultados.vtkhdf` **STORED**: VTKHDF 2.2 (malla de cálculo, desplazamientos y giros por paso, esfuerzos por extremo; ParaView 6.1 lo abre) + grupo `/covillaf` (pasos con su GUID, casos, modal, envolventes, verificación, calidad numérica, `hash_contenido` del `.vybs` ⇒ «desactualizado»); `track_times=False` para bytes deterministas; VTU/PVD como exportación |
| IFC 4.3 | publicación | IFC físico con los mismos GUID + Pset `COVILLAF_Resultados` + color por banda hacia COVILLAF 3D (Fase 2, P-14); `IfcStructural*` no se dibuja allí |
| IFC4 + SAV | intercambio | perfil de exportación que documentan SAP2000/ETABS y RFEM (Fase 2) |
| INP · FRD/DAT | solver | CalculiX (continuo); escritor INP y lector FRD propios (meshio solo malla; `ccx2paraview` es GPL-3) |
| MSH 4.1 | malla | gmsh |
| mdpa + json | solver | Kratos |
| script Python | solver | OpenSees (intérprete 3.12 aparte; en cuarentena por P-02) |
| BDF · SAF · OAPI | intercambio | Nastran en campo largo (pyNastran 3.12 como verificador), SAF opcional (P-15), SAP2000 por su API pública (Fase 5, P-03); el texto `.s2k` se descarta (clean-room) |
| VTU · CSV/XLSX · PDF/HTML · DXF · BCF 2.1 · glTF | salida | ParaView, tablas, memoria de cálculo, diagramas, incidencias hacia DESIGN, animaciones (Fase 2) |
| VYBM · VYBF | tramas | mallas (VYBM de DESIGN) y campos de resultados al visor (VYBF: por vértice o triángulo de un VYBM ya enviado o por estación de barra; pasos y modos; rango) |

Regla de la familia [H]: cualquier `.vybs` renombrado a `.zip` abre y contiene un IFC válido (`ifcopenshell.validate`
sin errores) y JSON válidos contra sus esquemas; prueba de ida y vuelta por formato.

## 9. Solvers

**Motor propio (`covillaf.sim.solver`)** [F0-10, F0-19]. **Hecho** (sesión 2): barra 3D de dos nodos Euler-Bernoulli o
Timoshenko (funciones interdependientes: las cargas de tramo dan las fuerzas de empotramiento exactas) con
liberaciones por condensación estática, desfases rígidos, cargas nodales, distribuidas lineales parciales (globales o
locales), puntuales de tramo, temperatura uniforme y peso propio; masa consistente o concentrada, masas nodales y
fuente de masa desde cargas; ensamblado disperso; estático lineal multicaso sobre una factorización (SuperLU simétrico
del sistema escalado, detección y localización de mecanismos, estabilización exacta de direcciones desacopladas);
modal denso o por ARPACK en desplazamiento-inversión, con cuerpo libre; reacciones, fuerzas de extremo, equilibrio y
residuo; asentamientos y cargas proyectadas; **MKL PARDISO** con envoltorio propio (sesión 3), elegido por tamaño,
que localiza mecanismos por el pivote escalado; en el modal, error regresivo por modo y **certificado de Sturm**
(`modos_por_debajo` cuenta los modos bajo una frecuencia sin calcularlos). Matrices comprobadas contra su derivación
simbólica (sympy) y la flexibilidad de Timoshenko. **Por hacer**: numba, rigidez geométrica, pandeo, P-Delta, espectro (CQC/SRSS),
tiempo-historia (Newmark), barras solo a tracción, cáscaras MITC4/DKT y sólidos vía scikit-fem. Sin GUI ni archivos:
recibe `modelo`, devuelve `resultados`.

**Adaptadores (`covillaf.sim.adaptadores`)**: cada uno traduce el mismo `modelo` a la entrada del solver, lo ejecuta
como tarea (en proceso: Kratos; aparte: `ccx`, `gmsh.exe`, `python.exe` 3.12 con OpenSees, `SU2_CFD`, OpenFOAM) y
devuelve `resultados` en el esquema común. Un comando `analisis.comparar` ejecuta el mismo caso en varios solvers y
reporta diferencias con tolerancias: es la herramienta de precisión del usuario y la prueba de los propios
adaptadores.

## 10. Mallado (`covillaf.sim.malla`)

Barras: discretización por longitud y por puntos de interés (cargas, intersecciones). Cáscaras: mallado de la
superficie media desde `IfcPlate` con netgen (proceso) o gmsh (subproceso) con tamaño global y local. Sólidos:
tet cuadráticos desde el B-rep (OCCT) con netgen/gmsh; hexaedros donde la geometría lo permita. Métricas de calidad
(aspecto, jacobiano, ángulos) en el informe; correspondencia malla ↔ caras del B-rep para aplicar cargas y apoyos
sobre geometría y no sobre nodos. Remallado/adaptación con mmg (evaluación).

## 11. Normas y diseño (`covillaf.sim.normas`)

Cargas y combinaciones generadas por norma (E.020, E.030, ASCE 7-22, Eurocódigo 0/1), verificación de acero (AISC
360-22, E.090, Eurocódigo 3) y concreto (ACI 318-19, E.060), cada cláusula como función pura con su prueba y su
referencia (número de cláusula, sin copiar texto con derechos). Ratios D/C por miembro y combinación, longitudes
efectivas, optimización de perfiles del catálogo. **E.030-2026 por defecto** y la 2018 elegible por proyecto (P-04);
qué normas de pago hay en la empresa sigue pendiente (P-04). Fase 3: flexibilidad de tuberías por ASME B31.3 (P-17).

## 12. Post-proceso y visor

La capa de resultados de `packages/viewer` (propia; la capa de edición de DESIGN no sirve para colorear) dibuja sobre
el visor de COVILLAF 3D **sin ganchos nuevos** (informe 03 §3): deformadas escaladas por uniforme en el sombreador,
diagramas N/V/M como polígonos en el plano local de cada barra (`Mesh` + `LineSegments2`, nunca `THREE.Line`),
reacciones instanciadas, animación modal, contornos por vértice (Fase 2) y sondas; todo desde tramas **VYBF** (F0-25).
Los ganchos G1, G6, G8 y G10 del visor mejorarían encuadre, sondas, capturas y D/C sobre fragments: se piden con P-16 de
DESIGN. Tablas y envolventes en la interfaz; VTU/XDMF para ParaView; memoria de cálculo PDF/HTML con
trazabilidad (hash del modelo, versión del solver, casos de verificación pasados).

## 13. Integración con la familia

| Con | Qué | Cómo | Estado |
|---|---|---|---|
| COVILLAF DESIGN | entrada del modelo | `.vyba` con `covillaf.io.contenedor` y `covillaf.geometry.perfiles` de DESIGN (por `.pth`, solo lectura, caché de bytecode fuera: F0-17); marcos, niveles, ejes y CRS del `.covillaf` | derivación del modelo analítico verificada en el informe 03 [verificado]; lector propio en `covillaf.sim.io` (Fase 1) |
| COVILLAF DESIGN | kernel | `covillaf_kernel.comandos` por ruta + servidor propio con `rpc.md` v1 y tareas (F0-24); núcleo común `covillaf.kernel` si se aprueba D-8 | Fase 1 |
| COVILLAF DESIGN | intención de análisis | propuestas D-1…D-13 (P-09); mientras tanto, lo que falta se completa en SIMULATE por GUID | pendiente del usuario |
| COVILLAF 3D | visor | alias de Vite + `paths` de TS + `COVILLAF3D_APP`, `dedupe`, worker y sustituto si no está la carpeta (receta de DESIGN); huella sha256 de sus 18 fuentes; falta `opentype.js` 1.3.4 en `package.json` | Fase 1 |
| COVILLAF 3D | publicación | IFC físico con los mismos GUID + Pset `COVILLAF_Resultados` + color por banda por su API local `POST /api/proyectos/:pid/modelos` (bytes deterministas, D-11) y tareas con miniatura para incidencias; COVILLAF 3D no importa BCF | Fase 2, con permiso (P-14) |
| Los tres | visor compartido `@covillaf/visor` | decisión P-10 (= P-02 de DESIGN) | pendiente |

## 14. Scripting

API `covillaf.sim` = fachada del bus de comandos (lo que hace un botón lo hace una línea). Ejemplo **ilustrativo**:

```python
import covillaf.sim as sim
m = sim.abrir_modelo(r"D:\Proyectos\PRJ-0001_Planta\07_Analisis\portico-A.vybs")
with m.transaccion("Cargas de viento E.020"):
    m.cargas.viento(norma="E.020", velocidad_kmh=85, exposicion="C")
    m.combinaciones.generar(norma="ASCE 7-22", metodo="LRFD")
r = m.analizar(["estatico", "modal"], solver="propio")
print(r.envolvente("M33", combinaciones="todas").maximo())
m.verificar(norma="AISC 360-22").informe("memoria.pdf")
```

Corre en la consola de la app (kernel), en la CLI sin interfaz y, más adelante, en un editor de nodos. Los scripts
del usuario son código de confianza; los de terceros, en proceso aparte (decisión de la Fase 5).

## 15. Interfaz

Cinta por tipo de trabajo: Modelo (importar de DESIGN, nodos, barras, cáscaras, apoyos) · Cargas (casos, patrones,
viento/sismo, combinaciones) · Análisis (asistentes: estático, modal, espectro, pandeo, P-Delta, térmico, sólidos;
solver y comparación) · Diseño (normas, ratios, optimización) · Resultados (deformadas, contornos, diagramas, tablas,
animación, sondas) · Informes · Automatizar (consola Python). Línea de comandos y entrada de coordenadas como en
DESIGN; propiedades contextuales con unidades explícitas; navegador del modelo (casos, combinaciones, análisis,
resultados con estado: al día / desactualizado / con avisos). Tema claro/oscuro con la marca (verde ≈ #7AC41E, gris
≈ #383838); textos centralizados en español.

## 16. Calidad y pruebas

- `tools/ci.ps1`: validación del grafo y de sus generados, ruff, import-linter (capas), pytest (casos de verificación
  incluidos), `comprobar_entorno.py --rapido`, `tsc`, `node --test`. `-Rapido` omite `lento` y `externo`.
- `tools/comprobar_entorno.py`: importa todo el stack y ejecuta pruebas numéricas con criterio (registro en
  `.herramientas/registros/`).
- Cada formato con ida y vuelta; cada adaptador con al menos un caso comparado contra el solver propio; cada norma
  con ejemplos numéricos de referencia.
- Pruebas de interoperabilidad con el software instalado (`interop`, a mano y con permiso: P-03).

## 17. Seguridad, privacidad y licencias

Kernel solo en 127.0.0.1 con token por stdin y `Origin` controlado (protocolo de DESIGN); procesos hijos con carpeta
de trabajo propia y sin red; nada sale de la máquina. Datos de proyectos reales nunca en git. Licencias: permisivas y
LGPL en proceso (OCCT, IfcOpenShell, netgen: mencionar en la documentación del producto); Kratos BSD-4 (mención en
material publicitario); GPL solo aparte (gmsh, CalculiX, OpenFOAM, TetGen nunca enlazado); OpenSees solo con acuerdo
si hay uso comercial (P-02).

## 18. Fases y criterios de aceptación

| Fase | Entregables | Criterio de aceptación (medible) |
|---|---|---|
| **0** | Grafo; herramientas descargadas y verificadas; arquitectura; esqueleto con CI; informes de investigación | Grafo válido y generado en la CI; `comprobar_entorno.py` con el núcleo en verde; `tools/ci.ps1 -Rapido` en verde; los 4 informes (P-01) integrados |
| **1 (MVP)** | Las 16 capacidades cerradas de F0-23: modelo analítico desde un `.vyba` sintético de DESIGN; cargas (incluidos asentamientos y cargas proyectadas) y combinaciones con envolventes; estático y modal con el solver propio; diagnóstico; resultados en el visor (deformada, diagramas, tablas, animación modal) y en VTKHDF/VTU; `.vybs` con ida y vuelta. Prueba de aceptación: piloto PR-01 (rack de tuberías, variantes a/b/c) | A1–A12 del informe 01 §4.3 (F0-22): casos V-B/V-M ≤ 1e-9 donde el elemento es exacto; equilibrio ≤ 1e-9; PR-01a frente a **PyNite ≤ 1e-6** y frente a **Kratos ≤ 1e-4**; ortogonalidad ΦᵀMΦ = I ≤ 1e-10; T₁ estable (< 0,1 %) al duplicar la malla; el mecanismo de PR-01c detectado y localizado; `.vybs` renombrado a `.zip` abre y valida; reproducibilidad ≤ 1e-13; PR-01 completo en < 2 s |
| **2** | Cáscaras y sólidos con mallado automático; pandeo, P-Delta, espectro (E.030/ASCE 7); Kratos y CalculiX por adaptador; verificación AISC 360/E.090; informes; publicación en COVILLAF 3D | NAFEMS públicos de placas y sólidos dentro de tolerancia; convergencia declarada; ratios D/C de ejemplos publicados reproducidos; IFC con resultados abre en COVILLAF 3D |
| **3** | Contacto y plasticidad, térmico, tiempo-historia, concreto, conexiones por sólidos | Casos de verificación de cada análisis; comparación entre solvers |
| **4** | Pushover, fatiga, mecanismos, optimización, GPU | Idem + tiempos medidos frente a CPU |
| **5** | CFD, acoplados, conectores SAP2000/Robot/Inventor/SolidWorks | Mismo modelo en el software instalado con diferencias reportadas; con permiso (P-03) |

## 19. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Alcance (cinco familias de referencia en un producto) | Alto | Fases con criterios medibles; el grafo como límite explícito; MVP de pórticos primero |
| Precisión del solver propio | Alto | Casos de verificación obligatorios; comparación automática con PyNite, CalculiX y Kratos |
| Licencias (OpenSees no comercial; GPL; Kratos BSD-4) | Medio | Subprocesos; decisión P-02 antes de distribuir; licencias anotadas |
| Derivar el modelo analítico del BIM (ejes, liberaciones, excentricidades) | Alto en Fase 1 | Propuestas a DESIGN (P-09); tolerancias explícitas; revisión visual en el visor |
| Los hermanos cambian a diario (DESIGN sin commit; COVILLAF 3D en edición) | Medio | Consumo por ruta con huella sha256; sustitutos para compilar sin ellos; paquete compartido (P-10) |
| Rendimiento en Python con modelos grandes | Medio | numba, PARDISO multinúcleo, Kratos/CalculiX en C++, GPU en Fase 4 |
| Normas de pago (AISC, ASCE, ACI) | Medio | Implementar por cláusula sin copiar texto; empezar por las públicas del RNE (P-04) |
| Términos de uso de los programas de referencia (competidor, confidencialidad, licencias Education) | Alto | Validación solo interna con modelos sintéticos, sin publicar; revisión legal antes de la Fase 5 (P-03) |
| Dos versiones vigentes de la E.030 (2018 y 2026) | Alto en la Fase 2 | Normas versionadas, elegibles por proyecto (P-04) |
| J de pared delgada frente a J exacta (0,8–1,8 % en el piloto) confundida con un error | Medio | Origen de J declarado por sección; la misma J en toda comparación |
| Nombres cercanos (`.covillaf`, `VYBR`) | Bajo | Trama VYBF y contenedor `.vybres` (F0-25, P-12) |

## 20. Decisiones y pendientes

Registro completo: [`docs/decisiones.md`](docs/decisiones.md). Estado y siguientes pasos: [`docs/HANDOFF.md`](docs/HANDOFF.md).
