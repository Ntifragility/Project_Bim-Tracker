// Conexión de la interfaz con el kernel de SIMULATE (docs/protocolo/rpc_simulate.md), sobre el ClienteKernel de COVILLAF
// DESIGN (consumido por alias, no copiado: vite.config.ts). Sin DOM ni alias aquí: el cliente se inyecta (las pruebas
// usan uno falso) y este módulo solo añade lo propio de SIMULATE:
// - comandos del bus y tareas (tarea.iniciar → aviso tarea.terminada, con su progreso);
// - resultados.campo: la respuesta JSON anuncia un `lote` y la trama VYBF llega DETRÁS; se emparejan por el lote de la
//   cabecera de la trama (bytes 8–11, u32 little-endian), no por el orden;
// - tiempos de espera largos para lo que calcula (un estado estático de 16 000 barras tarda ~10 s).

/** Lo que se usa del ClienteKernel de DESIGN (misma firma). */
export interface ClienteRpc {
  conectar(): Promise<void>;
  reconectar(): Promise<void>;
  solicitar(metodo: string, params?: unknown, opciones?: { tiempoEsperaMs?: number }): Promise<unknown>;
  suscribir(metodo: string, fn: (params: unknown, metodo: string) => void): () => void;
  alBinario(fn: (datos: ArrayBuffer) => void): () => void;
}

export type EstadoTarea = "en_cola" | "en_curso" | "cancelando" | "terminada" | "fallida" | "cancelada";

export interface AvisoTarea {
  id: string;
  nombre: string;
  estado: EstadoTarea;
  texto: string;
  fraccion: number | null;
  resultado?: unknown;
  error?: { detalle: string; clave?: string; id?: string };
}

export interface MetaCampo {
  tipo: "estatico" | "modal";
  magnitud: "desplazamiento" | "esfuerzos" | "forma";
  estado?: string;
  modo?: number;
  frecuencia?: number;
  lote: number;
  guid: string;
  revision: number;
  codigo: number;
  componentes: number;
  unidad: string;
  n_valores: number;
  rango: [number, number][];
  /** Desplazamiento y forma: el de mayor norma; esfuerzos: uno por componente (N, Vy, Vz, T, My, Mz). */
  maximo: MaximoCampo | MaximoCampo[];
}

export interface MaximoCampo {
  valor: number;
  barra: string | null;
  x: number | null;
}

export interface PeticionCampo {
  tipo: "estatico" | "modal";
  magnitud: "desplazamiento" | "esfuerzos" | "forma";
  estado?: string;
  modo?: number;
}

/** Tiempos de espera (ms) de lo que calcula el kernel. */
export const ESPERA_CAMPO_MS = 180_000;
export const ESPERA_COMANDO_MS = 600_000;
/** Tramas sin reclamar que se guardan (llegaron antes de que alguien las pidiera). */
const TRAMAS_GUARDADAS = 16;
const TAREAS_RECORDADAS = 200;

/** Lote de una trama binaria (VYBF o VYBM: los dos lo llevan en los bytes 8–11). */
export function loteDeTrama(datos: ArrayBuffer): number | null {
  if (datos.byteLength < 12) return null;
  return new DataView(datos).getUint32(8, true);
}

type Oyente<T> = (valor: T) => void;

export class KernelSimulate {
  private readonly tramas = new Map<number, ArrayBuffer>();
  private readonly esperandoTrama = new Map<number, { resolver: (d: ArrayBuffer) => void; rechazar: (e: Error) => void }>();
  private readonly tareas = new Map<string, AvisoTarea>();
  private readonly finales = new Map<string, { resolver: (a: AvisoTarea) => void }[]>();
  private readonly oyentesTarea = new Set<Oyente<AvisoTarea>>();
  private readonly oyentesCambios = new Set<Oyente<unknown>>();

  readonly cliente: ClienteRpc;

  constructor(cliente: ClienteRpc) {
    this.cliente = cliente;
    cliente.alBinario((datos) => this.alTrama(datos));
    cliente.suscribir("tarea.progreso", (p) => this.alProgreso(p as { id: string; texto: string; fraccion: number | null }));
    cliente.suscribir("tarea.terminada", (p) => this.alTerminada(p as AvisoTarea));
    cliente.suscribir("modelo.cambios", (p) => {
      for (const fn of this.oyentesCambios) fn(p);
    });
  }

  // --- suscripciones -------------------------------------------------------------------------------------------------

  alTarea(fn: Oyente<AvisoTarea>): () => void {
    this.oyentesTarea.add(fn);
    return () => this.oyentesTarea.delete(fn);
  }

  alCambiarModelo(fn: Oyente<unknown>): () => void {
    this.oyentesCambios.add(fn);
    return () => this.oyentesCambios.delete(fn);
  }

  /** Tareas conocidas que siguen vivas (en cola, en curso o cancelándose). */
  get activas(): AvisoTarea[] {
    return [...this.tareas.values()].filter((t) => t.estado === "en_cola" || t.estado === "en_curso" || t.estado === "cancelando");
  }

  // --- operaciones -----------------------------------------------------------------------------------------------------

  /** Comando del bus (`comando.ejecutar`): devuelve `{resultado, transaccion, cambios}`. */
  comando<T = unknown>(nombre: string, args: Record<string, unknown> = {}): Promise<{ resultado: T; transaccion: string | null }> {
    return this.cliente.solicitar("comando.ejecutar", { nombre, args }, { tiempoEsperaMs: ESPERA_COMANDO_MS }) as Promise<{
      resultado: T;
      transaccion: string | null;
    }>;
  }

  /** Inicia una tarea: devuelve su id y una promesa con su aviso final (`terminada`, `fallida` o `cancelada`). */
  async tarea(nombre: string, args: Record<string, unknown> = {}): Promise<{ id: string; fin: Promise<AvisoTarea> }> {
    const { id } = (await this.cliente.solicitar("tarea.iniciar", { nombre, args })) as { id: string };
    const conocida = this.tareas.get(id);
    if (!conocida) this.recordar({ id, nombre, estado: "en_cola", texto: "", fraccion: null });
    return { id, fin: this.esperarFin(id) };
  }

  cancelar(id: string): Promise<unknown> {
    return this.cliente.solicitar("tarea.cancelar", { id });
  }

  /**
   * Al conectar o reconectar: recupera las tareas vivas del kernel (`tarea.activas`) y cierra las que esta interfaz
   * creía vivas y el kernel ya no tiene en marcha — con su estado final si el kernel aún lo recuerda (`tarea.estado`)
   * o, si se relanzó y no la conoce, como `fallida` con la clave `perdida` —, para que nadie espere su fin para siempre.
   * También descarta las tramas sin reclamar: los lotes vuelven a empezar en un kernel relanzado (auditoría 6fc4e37,
   * M2 y B2).
   */
  async recuperarTareas(): Promise<AvisoTarea[]> {
    this.tramas.clear();
    for (const [lote, quien] of this.esperandoTrama) {
      this.esperandoTrama.delete(lote);
      quien.rechazar(new Error("se perdió la conexión con el kernel antes de recibir el campo"));
    }
    const lista = (await this.cliente.solicitar("tarea.activas")) as AvisoTarea[];
    const vivas = new Set(lista.map((t) => t.id));
    for (const t of lista) this.recordar({ ...t });
    for (const t of this.activas.filter((x) => !vivas.has(x.id))) {
      let final: AvisoTarea;
      try {
        final = { ...t, ...((await this.cliente.solicitar("tarea.estado", { id: t.id })) as AvisoTarea) };
      } catch {
        final = { ...t, estado: "fallida", error: { detalle: "se perdió el kernel (se cerró o se relanzó): la tarea no terminó", clave: "perdida" } };
      }
      if (final.estado === "en_cola" || final.estado === "en_curso" || final.estado === "cancelando") continue; // vuelve a estar viva
      this.alTerminada(final);
    }
    return lista;
  }

  geometria<T = unknown>(): Promise<T> {
    return this.cliente.solicitar("resultados.geometria", {}, { tiempoEsperaMs: ESPERA_CAMPO_MS }) as Promise<T>;
  }

  tabla<T = unknown>(tabla: string, estado?: string): Promise<T> {
    const params: Record<string, unknown> = { tabla };
    if (estado !== undefined) params.estado = estado;
    return this.cliente.solicitar("resultados.tabla", params, { tiempoEsperaMs: ESPERA_CAMPO_MS }) as Promise<T>;
  }

  /** `resultados.campo`: el JSON y la trama VYBF que llega detrás con el mismo lote. */
  async campo(peticion: PeticionCampo): Promise<{ meta: MetaCampo; trama: ArrayBuffer }> {
    const meta = (await this.cliente.solicitar("resultados.campo", peticion, { tiempoEsperaMs: ESPERA_CAMPO_MS })) as MetaCampo;
    const trama = await this.esperarTrama(meta.lote);
    return { meta, trama };
  }

  // --- interno ---------------------------------------------------------------------------------------------------------

  private esperarTrama(lote: number): Promise<ArrayBuffer> {
    const ya = this.tramas.get(lote);
    if (ya) {
      this.tramas.delete(lote);
      return Promise.resolve(ya);
    }
    return new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        this.esperandoTrama.delete(lote);
        rechazar(new Error(`no llegó la trama del lote ${lote}`));
      }, 30_000);
      this.esperandoTrama.set(lote, {
        resolver: (d) => {
          clearTimeout(temporizador);
          resolver(d);
        },
        rechazar,
      });
    });
  }

  private alTrama(datos: ArrayBuffer): void {
    const lote = loteDeTrama(datos);
    if (lote === null) return;
    const quien = this.esperandoTrama.get(lote);
    if (quien) {
      this.esperandoTrama.delete(lote);
      quien.resolver(datos);
      return;
    }
    this.tramas.set(lote, datos);
    while (this.tramas.size > TRAMAS_GUARDADAS) this.tramas.delete(this.tramas.keys().next().value as number);
  }

  private recordar(aviso: AvisoTarea): void {
    this.tareas.delete(aviso.id);
    this.tareas.set(aviso.id, aviso);
    while (this.tareas.size > TAREAS_RECORDADAS) this.tareas.delete(this.tareas.keys().next().value as string);
    for (const fn of this.oyentesTarea) fn(aviso);
  }

  private alProgreso(p: { id: string; texto: string; fraccion: number | null }): void {
    const antes = this.tareas.get(p.id);
    const estado: EstadoTarea = antes?.estado === "cancelando" ? "cancelando" : "en_curso";
    this.recordar({ id: p.id, nombre: antes?.nombre ?? "", estado, texto: p.texto, fraccion: p.fraccion });
  }

  private alTerminada(p: AvisoTarea): void {
    const antes = this.tareas.get(p.id);
    const aviso: AvisoTarea = { ...p, texto: antes?.texto ?? "", fraccion: p.estado === "terminada" ? 1 : (antes?.fraccion ?? null) };
    this.recordar(aviso);
    for (const e of this.finales.get(p.id) ?? []) e.resolver(aviso);
    this.finales.delete(p.id);
  }

  /** Marca una tarea como «cancelando» al pedirlo (el kernel lo confirma con su aviso final). */
  marcarCancelando(id: string): void {
    const t = this.tareas.get(id);
    if (t && (t.estado === "en_curso" || t.estado === "en_cola")) this.recordar({ ...t, estado: "cancelando" });
  }

  private esperarFin(id: string): Promise<AvisoTarea> {
    const t = this.tareas.get(id);
    if (t && (t.estado === "terminada" || t.estado === "fallida" || t.estado === "cancelada")) return Promise.resolve(t);
    return new Promise((resolver) => {
      const lista = this.finales.get(id) ?? [];
      lista.push({ resolver });
      this.finales.set(id, lista);
    });
  }
}
