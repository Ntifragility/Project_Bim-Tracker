// Capa de resultados de COVILLAF SIMULATE sobre la escena del visor de COVILLAF 3D (m, Y arriba): modelo analítico de barras
// (líneas), nudos (puntos) y apoyos (símbolos por tipo); deformada, diagramas N/V/T/M, reacciones y animación modal.
// Todo desde la geometría analítica (`resultados.geometria`) y tramas VYBF de estaciones (ubicación 3). La geometría la
// calcula `construir.ts` (sin WebGL, probado en Node) en doble y con el origen restado; aquí solo se pasa a three.js.
// Líneas con `LineSegments2` (grosor en píxeles, ARCHITECTURE §12: nunca `THREE.Line`).
//
// Una sola representación de resultados a la vez (deformada, diagrama o modo; mostrar otra sustituye a la anterior; la
// escala `escala` es la de esa representación); las reacciones van aparte y conviven con ella.
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  FRACCION_DEFORMADA,
  FRACCION_DIAGRAMA,
  comprobarTrama,
  construirDiagrama,
  construirReacciones,
  diagonalReferencia,
  elegirBarra,
  escalaAutomatica,
  marcoDeGeometria,
  maximaNorma,
  maximoAbsoluto,
  paresTramos,
  posicionesEstaciones,
  puntosAEscena,
  segmentosDePares,
  simbolosApoyos,
  sumarEscalado,
  vectoresAEscena,
  vectoresPaso,
  type EleccionBarra,
  type ExtremoDiagrama,
  type ReaccionNudo,
  type TipoApoyo,
} from "./construir.ts";
import type { GeometriaAnalitica, Punto3 } from "./geometria.ts";
import { MARCO_PROYECTO, MM_POR_M, proyectoAEscena, type MarcoEscena } from "./marcos-design.ts";
import { MAGNITUD_DESPLAZAMIENTO, MAGNITUD_ESFUERZOS, MAGNITUD_FORMA_MODAL, type TramaVybf } from "./vybf.ts";

/** Colores de la capa por tema (criterio propio). */
export const COLORES_CAPA = {
  claro: { barras: 0x3d4852, tenue: 0xaab2bb, nudos: 0x1f262d, deformada: 0x4f8f12, apoyos: 0x2e7d74, fuerza: 0x7b3fb5, momento: 0xb5651d },
  oscuro: { barras: 0xc5ced8, tenue: 0x59616a, nudos: 0xe6ebf0, deformada: 0x8fd43a, apoyos: 0x4fb3a8, fuerza: 0xb58ae0, momento: 0xe39a55 },
} as const;
/** Grosores de línea en píxeles CSS. */
export const GROSORES = { barras: 2, deformada: 2.5, contorno: 1.25, reacciones: 2 } as const;
/** Tamaño de los símbolos de apoyo y de las puntas de flecha: fracción de la diagonal. */
export const FRACCION_SIMBOLO = 0.025;
/** Periodo en pantalla de la animación modal (s) si no se da otro. */
export const PERIODO_ANIMACION_S = 2;
/** Tolerancia de elección: fracción de la altura de la vista (≈ 10 px en una vista de 800 px). */
export const TOLERANCIA_ELECCION = 0.0125;

export interface OpcionesCampo {
  /** mm de dibujo por unidad del campo; si falta, la automática. */
  escala?: number;
  /** Paso de la trama (0 por defecto). */
  paso?: number;
}

type Representacion =
  | { tipo: "deformada"; trama: TramaVybf; paso: number }
  | { tipo: "diagrama"; trama: TramaVybf; paso: number; componente: number }
  | { tipo: "modo"; trama: TramaVybf; paso: number; periodoSegundos: number };

interface Animacion {
  desplazamiento: Float64Array;
  instante: Float64Array;
  segmentos: Float32Array;
  atributo: THREE.InterleavedBufferAttribute;
  periodoMs: number;
  inicio: number | null;
  activa: boolean;
}

const EJE_Y = new THREE.Vector3(0, 1, 0);

function lineas(posiciones: Float32Array, material: LineMaterial, colores?: Float32Array): LineSegments2 {
  const g = new LineSegmentsGeometry();
  g.setPositions(posiciones);
  if (colores) g.setColors(colores);
  return new LineSegments2(g, material);
}

function materialLinea(color: number, grosor: number, extra: Partial<{ opacidad: number; colores: boolean }> = {}): LineMaterial {
  const m = new LineMaterial({ color, linewidth: grosor, vertexColors: extra.colores ?? false, transparent: extra.opacidad !== undefined, opacity: extra.opacidad ?? 1 });
  if (extra.colores) m.color.set(0xffffff);
  return m;
}

function liberar(objeto: THREE.Object3D): void {
  objeto.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    g?.dispose();
    // las mallas instanciadas (puntas de las reacciones) tienen además sus búferes de instancias (auditoría 6fc4e37, B4)
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}

export class CapaResultados {
  readonly grupo = new THREE.Group();
  /** Avisos de cambio de contenido (encuadre, redibujo): los usa `montarVisor`. */
  readonly alCambiar = new Set<() => void>();

  private g: GeometriaAnalitica | null = null;
  private marco: MarcoEscena = MARCO_PROYECTO;
  private base: Float64Array = new Float64Array(0);
  private pares: Uint32Array = new Uint32Array(0);
  private readonly modelo = new THREE.Group();
  private readonly resultado = new THREE.Group();
  private readonly grupoReacciones = new THREE.Group();
  private barras: LineSegments2 | null = null;
  private repr: Representacion | null = null;
  private escala_ = 1;
  private anim: Animacion | null = null;
  private diagrama_: { componente: number; maximo: ExtremoDiagrama | null; minimo: ExtremoDiagrama | null } | null = null;
  private oscuro = false;
  private reacciones: { r: ReaccionNudo[]; opciones: { escalaFuerza?: number; radioMomentoMm?: number } } | null = null;
  private readonly mat = {
    barras: materialLinea(COLORES_CAPA.claro.barras, GROSORES.barras),
    deformada: materialLinea(COLORES_CAPA.claro.deformada, GROSORES.deformada),
    contorno: materialLinea(0xffffff, GROSORES.contorno, { colores: true }),
    reacciones: materialLinea(0xffffff, GROSORES.reacciones, { colores: true }),
    relleno: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    nudos: new THREE.PointsMaterial({ color: COLORES_CAPA.claro.nudos, size: 6, sizeAttenuation: false }),
    apoyos: new THREE.MeshLambertMaterial({ color: COLORES_CAPA.claro.apoyos }),
    puntas: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  };

  constructor() {
    this.grupo.name = "covillaf-simulate:resultados";
    this.modelo.name = "modelo";
    this.resultado.name = "resultado";
    this.grupoReacciones.name = "reacciones";
    this.grupo.add(this.modelo, this.resultado, this.grupoReacciones);
  }

  /** La geometría cargada (validada), o null. */
  get geometria(): GeometriaAnalitica | null {
    return this.g;
  }

  /** Marco de escena de la geometría (origen = centro de su caja, mm). */
  get marcoEscena(): MarcoEscena {
    return this.marco;
  }

  /** mm de dibujo por unidad del campo de la representación actual (1 sin representación). */
  get escala(): number {
    return this.escala_;
  }

  /** Hay una animación modal en marcha. */
  get animando(): boolean {
    return this.anim?.activa ?? false;
  }

  /** Qué se muestra: "deformada", "diagrama", "modo" o null. */
  get representacion(): "deformada" | "diagrama" | "modo" | null {
    return this.repr?.tipo ?? null;
  }

  /** Componente y valores extremos (con barra y abscisa) del diagrama mostrado, o null. */
  get diagrama(): { componente: number; maximo: ExtremoDiagrama | null; minimo: ExtremoDiagrama | null } | null {
    return this.diagrama_;
  }

  // ---------------------------------------------------------------------------------------------------
  // Modelo analítico
  // ---------------------------------------------------------------------------------------------------

  /** Dibuja barras, nudos y apoyos (y quita todo lo anterior, resultados y reacciones incluidos). */
  fijarGeometria(g: GeometriaAnalitica): void {
    this.vaciar();
    this.g = g;
    this.marco = marcoDeGeometria(g);
    this.base = puntosAEscena(posicionesEstaciones(g), this.marco);
    this.pares = paresTramos(g);
    if (this.pares.length) {
      this.barras = lineas(segmentosDePares(this.base, this.pares), this.mat.barras);
      this.barras.name = "barras";
      this.modelo.add(this.barras);
    }
    if (g.nodos.length) {
      const puntos = Float32Array.from(puntosAEscena(g.nodos.flatMap((n) => n.punto), this.marco));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(puntos, 3));
      const nudos = new THREE.Points(geo, this.mat.nudos);
      nudos.name = "nudos";
      this.modelo.add(nudos);
    }
    this.dibujarApoyos(g);
    this.avisar();
  }

  /** Quita la geometría, los resultados y las reacciones. */
  vaciar(): void {
    this.limpiarObjetosResultado();
    this.repr = null;
    this.escala_ = 1;
    this.vaciarGrupo(this.grupoReacciones);
    this.reacciones = null;
    this.vaciarGrupo(this.modelo);
    this.barras = null;
    this.g = null;
    this.marco = MARCO_PROYECTO;
    this.base = new Float64Array(0);
    this.pares = new Uint32Array(0);
    this.avisar();
  }

  private dibujarApoyos(g: GeometriaAnalitica): void {
    const simbolos = simbolosApoyos(g);
    if (!simbolos.length) return;
    const t = (FRACCION_SIMBOLO * diagonalReferencia(g)) / MM_POR_M; // m
    const geos: Record<TipoApoyo, { geo: THREE.BufferGeometry; desfase: number }[]> = {
      empotrado: [{ geo: new THREE.BoxGeometry(t, 0.35 * t, t), desfase: 0.175 * t }],
      articulado: [{ geo: new THREE.ConeGeometry(0.5 * t, 0.8 * t, 4), desfase: 0.4 * t }],
      rodillo: [
        { geo: new THREE.ConeGeometry(0.5 * t, 0.8 * t, 4), desfase: 0.4 * t },
        { geo: new THREE.BoxGeometry(t, 0.08 * t, t), desfase: 0.96 * t },
      ],
      otro: [{ geo: new THREE.OctahedronGeometry(0.35 * t), desfase: 0.35 * t }],
    };
    const apoyos = new THREE.Group();
    apoyos.name = "apoyos";
    const usadas = new Set<THREE.BufferGeometry>();
    for (const s of simbolos) {
      const centro = new THREE.Vector3(...proyectoAEscena(s.posicion, this.marco));
      const eje = new THREE.Vector3(...vectoresAEscena(s.eje)).normalize();
      const giro = new THREE.Quaternion().setFromUnitVectors(EJE_Y, eje);
      for (const { geo, desfase } of geos[s.tipo]) {
        const m = new THREE.Mesh(geo, this.mat.apoyos);
        m.position.copy(centro).addScaledVector(eje, -desfase);
        m.quaternion.copy(giro);
        m.name = `apoyo:${g.nodos[s.nodo].id}:${s.tipo}`;
        m.userData = { nodo: s.nodo, tipo: s.tipo };
        apoyos.add(m);
        usadas.add(geo);
      }
    }
    for (const lista of Object.values(geos)) for (const { geo } of lista) if (!usadas.has(geo)) geo.dispose();
    this.modelo.add(apoyos);
  }

  // ---------------------------------------------------------------------------------------------------
  // Resultados
  // ---------------------------------------------------------------------------------------------------

  private exigirGeometria(): GeometriaAnalitica {
    if (!this.g) throw new Error("no hay geometría analítica cargada (fijarGeometria)");
    return this.g;
  }

  private comprobarEscala(escala: number | undefined): void {
    if (escala !== undefined && !(Number.isFinite(escala) && escala > 0)) throw new Error(`escala no válida: ${escala} (debe ser finita y positiva)`);
  }

  /**
   * Deformada de una trama de desplazamientos (magnitud 1, mm) o de una forma modal (3), estática. Escala automática:
   * el mayor desplazamiento = 5 % de la diagonal. La geometría sin deformar queda en gris tenue.
   */
  mostrarDeformada(t: TramaVybf, opciones: OpcionesCampo = {}): void {
    const g = this.exigirGeometria();
    const paso = opciones.paso ?? 0;
    comprobarTrama(g, t, [MAGNITUD_DESPLAZAMIENTO, MAGNITUD_FORMA_MODAL], paso);
    this.comprobarEscala(opciones.escala);
    this.quitarResultado();
    this.repr = { tipo: "deformada", trama: t, paso };
    this.escala_ = opciones.escala ?? escalaAutomatica(maximaNorma(t, paso), diagonalReferencia(g), FRACCION_DEFORMADA);
    this.dibujarRepresentacion();
  }

  /**
   * Diagrama de la componente `componente` (0 N, 1 Vy, 2 Vz, 3 T, 4 My, 5 Mz) de una trama de esfuerzos (magnitud
   * 16): relleno perpendicular a la barra en su plano local (Vy y Mz en x-y; Vz, My, N y T en x-z), azul positivo y
   * rojo negativo. Escala automática: el mayor valor absoluto = 8 % de la diagonal.
   */
  mostrarDiagrama(t: TramaVybf, componente: 0 | 1 | 2 | 3 | 4 | 5, opciones: OpcionesCampo = {}): void {
    const g = this.exigirGeometria();
    const paso = opciones.paso ?? 0;
    comprobarTrama(g, t, [MAGNITUD_ESFUERZOS], paso);
    if (!Number.isInteger(componente) || componente < 0 || componente > 5) throw new Error(`componente ${componente} fuera de 0…5`);
    this.comprobarEscala(opciones.escala);
    this.quitarResultado();
    this.repr = { tipo: "diagrama", trama: t, paso, componente };
    this.escala_ = opciones.escala ?? escalaAutomatica(maximoAbsoluto(t, componente, paso), diagonalReferencia(g), FRACCION_DIAGRAMA);
    this.dibujarRepresentacion();
  }

  /**
   * Anima una forma modal (magnitud 3, φᵀMφ = 1): posición = estación + escala · sin(2π t / T) · φ, con T de pantalla
   * fijo (2 s por defecto). Escala automática: la mayor |φ| = 5 % de la diagonal. La geometría sin deformar queda tenue.
   */
  animarModo(t: TramaVybf, opciones: OpcionesCampo & { periodoSegundos?: number } = {}): void {
    const g = this.exigirGeometria();
    const paso = opciones.paso ?? 0;
    comprobarTrama(g, t, [MAGNITUD_FORMA_MODAL], paso);
    this.comprobarEscala(opciones.escala);
    const periodoSegundos = opciones.periodoSegundos ?? PERIODO_ANIMACION_S;
    if (!(Number.isFinite(periodoSegundos) && periodoSegundos > 0)) throw new Error(`periodo no válido: ${periodoSegundos}`);
    this.quitarResultado();
    this.repr = { tipo: "modo", trama: t, paso, periodoSegundos };
    this.escala_ = opciones.escala ?? escalaAutomatica(maximaNorma(t, paso), diagonalReferencia(g), FRACCION_DEFORMADA);
    this.dibujarRepresentacion();
  }

  /** Para la animación y deja la forma modal quieta con su amplitud máxima (sin(·) = 1). */
  detenerAnimacion(): void {
    const a = this.anim;
    if (!a || !a.activa) return;
    a.activa = false;
    this.escribirInstante(a, 1);
    this.avisar();
  }

  /** Cambia la escala (mm de dibujo por unidad del campo) de la representación actual y la redibuja. */
  fijarEscala(factor: number): void {
    if (!(Number.isFinite(factor) && factor > 0)) throw new Error(`escala no válida: ${factor} (debe ser finita y positiva)`);
    this.escala_ = factor;
    if (!this.repr) return;
    const activa = this.anim?.activa ?? true;
    this.limpiarObjetosResultado();
    this.dibujarRepresentacion();
    if (this.anim && !activa) {
      this.anim.activa = false;
      this.escribirInstante(this.anim, 1);
    }
  }

  /** Quita la representación de resultados (la geometría y las reacciones siguen). */
  quitarResultado(): void {
    this.limpiarObjetosResultado();
    this.repr = null;
    this.escala_ = 1;
    this.avisar();
  }

  private limpiarObjetosResultado(): void {
    this.vaciarGrupo(this.resultado);
    this.anim = null;
    this.diagrama_ = null;
    if (this.barras) this.barras.material = this.mat.barras;
  }

  private dibujarRepresentacion(): void {
    const g = this.g;
    const r = this.repr;
    if (!g || !r) return;
    if (r.tipo === "diagrama") {
      const d = construirDiagrama(g, r.trama, r.componente, this.escala_, this.marco, r.paso);
      if (d.relleno.posiciones.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(d.relleno.posiciones, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(d.relleno.colores, 3));
        const relleno = new THREE.Mesh(geo, this.mat.relleno);
        relleno.name = "diagrama:relleno";
        relleno.renderOrder = 1;
        this.resultado.add(relleno);
      }
      if (d.contorno.posiciones.length) {
        const contorno = lineas(d.contorno.posiciones, this.mat.contorno, d.contorno.colores);
        contorno.name = "diagrama:contorno";
        this.resultado.add(contorno);
      }
      this.diagrama_ = { componente: r.componente, maximo: d.maximo, minimo: d.minimo };
    } else {
      if (this.barras) this.barras.material = this.materialTenue();
      if (!this.pares.length) return this.avisar();
      const desplazamiento = vectoresAEscena(vectoresPaso(r.trama, r.paso), this.escala_);
      const instante = sumarEscalado(this.base, desplazamiento, r.tipo === "modo" ? 0 : 1);
      const segmentos = segmentosDePares(instante, this.pares);
      const obj = lineas(segmentos, this.mat.deformada);
      obj.name = r.tipo === "modo" ? "modo" : "deformada";
      this.resultado.add(obj);
      if (r.tipo === "modo") {
        obj.frustumCulled = false; // la caja cambia en cada fotograma
        const atributo = obj.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
        this.anim = { desplazamiento, instante, segmentos, atributo, periodoMs: 1000 * r.periodoSegundos, inicio: null, activa: true };
      }
    }
    this.avisar();
  }

  private tenue: LineMaterial | null = null;
  private materialTenue(): LineMaterial {
    this.tenue ??= materialLinea(COLORES_CAPA.claro.tenue, GROSORES.barras, { opacidad: 0.6 });
    this.tenue.color.set(this.oscuro ? COLORES_CAPA.oscuro.tenue : COLORES_CAPA.claro.tenue);
    return this.tenue;
  }

  private escribirInstante(a: Animacion, factor: number): void {
    sumarEscalado(this.base, a.desplazamiento, factor, a.instante);
    segmentosDePares(a.instante, this.pares, a.segmentos);
    a.atributo.data.needsUpdate = true;
  }

  /** Avanza la animación modal (lo llama el bucle de dibujo con el tiempo en ms, p. ej. `performance.now()`). */
  actualizar(tiempoMs: number): void {
    const a = this.anim;
    if (!a || !a.activa || !Number.isFinite(tiempoMs)) return;
    a.inicio ??= tiempoMs;
    this.escribirInstante(a, Math.sin((2 * Math.PI * (tiempoMs - a.inicio)) / a.periodoMs));
  }

  // ---------------------------------------------------------------------------------------------------
  // Reacciones
  // ---------------------------------------------------------------------------------------------------

  /**
   * Flechas de fuerza (acaban en el nudo, en el sentido de la reacción, largo proporcional; la mayor = 8 % de la
   * diagonal) y arcos de momento (270°, radio fijo, sentido por la regla de la mano derecha), en ejes globales. `nodo`
   * = índice en `nodos` o su id (como `campos.reacciones` del kernel). Una lista vacía las quita.
   */
  mostrarReacciones(r: readonly ReaccionNudo[], opciones: { escalaFuerza?: number; radioMomentoMm?: number } = {}): void {
    const g = this.exigirGeometria();
    const { flechas } = construirReacciones(g, r, opciones);
    this.vaciarGrupo(this.grupoReacciones);
    this.reacciones = flechas.length ? { r: [...r], opciones: { ...opciones } } : null;
    if (!flechas.length) return this.avisar();
    const colores = this.oscuro ? COLORES_CAPA.oscuro : COLORES_CAPA.claro;
    const cabeza = (FRACCION_SIMBOLO * diagonalReferencia(g)) / MM_POR_M; // m
    const segs: number[] = [];
    const cols: number[] = [];
    const puntas: { posicion: THREE.Vector3; giro: THREE.Quaternion; color: THREE.Color }[] = [];
    const c = new THREE.Color();
    for (const f of flechas) {
      c.set(f.tipo === "fuerza" ? colores.fuerza : colores.momento);
      const linea = puntosAEscena(f.linea, this.marco);
      const dir = new THREE.Vector3(...vectoresAEscena(f.direccion)).normalize();
      const punta = new THREE.Vector3(...proyectoAEscena(f.punta, this.marco));
      const n = linea.length / 3;
      for (let k = 0; k + 1 < n; k++) {
        const a = [linea[3 * k], linea[3 * k + 1], linea[3 * k + 2]];
        const b = [linea[3 * k + 3], linea[3 * k + 4], linea[3 * k + 5]];
        if (f.tipo === "fuerza") {
          // el fuste acaba donde empieza la punta (que toca el nudo)
          const largo = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          if (largo <= cabeza) continue;
          b[0] -= dir.x * cabeza;
          b[1] -= dir.y * cabeza;
          b[2] -= dir.z * cabeza;
        }
        segs.push(...a, ...b);
        cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      const centro = f.tipo === "fuerza" ? punta.clone().addScaledVector(dir, -cabeza / 2) : punta.clone();
      puntas.push({ posicion: centro, giro: new THREE.Quaternion().setFromUnitVectors(EJE_Y, dir), color: c.clone() });
    }
    if (segs.length) {
      const l = lineas(Float32Array.from(segs), this.mat.reacciones, Float32Array.from(cols));
      l.name = "reacciones:lineas";
      this.grupoReacciones.add(l);
    }
    const cono = new THREE.ConeGeometry(0.35 * cabeza, cabeza, 12);
    const inst = new THREE.InstancedMesh(cono, this.mat.puntas, puntas.length);
    inst.name = "reacciones:puntas";
    const m = new THREE.Matrix4();
    const uno = new THREE.Vector3(1, 1, 1);
    puntas.forEach((p, i) => {
      inst.setMatrixAt(i, m.compose(p.posicion, p.giro, uno));
      inst.setColorAt(i, p.color);
    });
    inst.computeBoundingBox();
    inst.computeBoundingSphere();
    this.grupoReacciones.add(inst);
    this.avisar();
  }

  // ---------------------------------------------------------------------------------------------------
  // Consulta, tema y cierre
  // ---------------------------------------------------------------------------------------------------

  /** Caja de todo lo dibujado, en escena (m, Y arriba). Vacía sin geometría. */
  caja(): THREE.Box3 {
    const caja = new THREE.Box3();
    if (!this.g) return caja;
    this.grupo.updateMatrixWorld(true);
    return caja.setFromObject(this.grupo);
  }

  /**
   * Barra bajo el rayo (el de `Raycaster.setFromCamera`): la tolerancia es ~1,25 % de la altura de la vista (≈ 10 px),
   * con la cámara del rayo (`rayo.camera`; perspectiva u ortográfica); sin cámara, `rayo.params.Line.threshold` (m).
   * Se elige sobre la geometría sin deformar. `estacion` es el índice GLOBAL (el de las tramas); `x`, la abscisa en mm.
   */
  elegir(rayo: THREE.Raycaster): (Pick<EleccionBarra, "barra" | "estacion" | "x"> & Partial<EleccionBarra>) | null {
    const g = this.g;
    if (!g) return null;
    const cam = rayo.camera as THREE.Camera | undefined;
    let tolerancia: (t: number) => number;
    if (cam && (cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const o = cam as THREE.OrthographicCamera;
      const abs = ((o.top - o.bottom) / o.zoom) * TOLERANCIA_ELECCION;
      tolerancia = () => abs;
    } else if (cam && (cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const p = cam as THREE.PerspectiveCamera;
      const rel = 2 * Math.tan(THREE.MathUtils.degToRad(p.fov) / 2) / p.zoom * TOLERANCIA_ELECCION;
      tolerancia = (t) => rel * t;
    } else {
      const abs = rayo.params.Line?.threshold ?? 0.05;
      tolerancia = () => abs;
    }
    // el grupo puede estar transformado (no lo está en montarVisor): el rayo se pasa a su espacio
    this.grupo.updateMatrixWorld(true);
    const inversa = new THREE.Matrix4().copy(this.grupo.matrixWorld).invert();
    const r = rayo.ray.clone().applyMatrix4(inversa);
    return elegirBarra(g, this.base, r.origin.toArray(), r.direction.clone().normalize().toArray(), tolerancia);
  }

  /** Tema de la interfaz: colores de barras, nudos, deformada, apoyos y reacciones. */
  fijarTema(oscuro: boolean): void {
    this.oscuro = oscuro;
    const c = oscuro ? COLORES_CAPA.oscuro : COLORES_CAPA.claro;
    this.mat.barras.color.set(c.barras);
    this.mat.deformada.color.set(c.deformada);
    this.mat.nudos.color.set(c.nudos);
    this.mat.apoyos.color.set(c.apoyos);
    this.tenue?.color.set(c.tenue);
    // los colores de las reacciones van por vértice y por instancia: se vuelven a dibujar con el tema nuevo
    if (this.reacciones && this.g) this.mostrarReacciones(this.reacciones.r, this.reacciones.opciones);
    this.avisar();
  }

  /** Quita la capa de su escena y libera geometrías y materiales. */
  dispose(): void {
    this.vaciar();
    for (const m of Object.values(this.mat)) m.dispose();
    this.tenue?.dispose();
    this.grupo.removeFromParent();
    this.alCambiar.clear();
  }

  private vaciarGrupo(grupo: THREE.Group): void {
    for (const hijo of [...grupo.children]) {
      liberar(hijo);
      grupo.remove(hijo);
    }
  }

  private avisar(): void {
    for (const f of this.alCambiar) f();
  }

  /** Punto de proyecto (mm) → escena con el marco de la capa (para etiquetas de la interfaz). */
  aEscena(p: Punto3): THREE.Vector3 {
    return new THREE.Vector3(...proyectoAEscena(p, this.marco));
  }
}
