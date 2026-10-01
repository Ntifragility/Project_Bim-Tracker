// Lógica de los asistentes de análisis (sin DOM): valores del formulario → argumentos de la tarea del kernel, con la
// misma validación que su JSON Schema (apps/kernel/src/covillaf_sim_kernel/tareas_analisis.py) y las unidades explícitas.
import { sigmaDeFrecuencia } from "./formato.ts";

export type Resolvedor = "auto" | "superlu" | "pardiso";

export interface ValoresEstatico {
  casos: readonly string[]; // marcados
  todos: readonly string[]; // los del modelo
  deformacionCortante: boolean;
  resolvedor: Resolvedor;
}

export interface ValoresModal {
  modos: string; // texto del campo (entero 1…1000)
  masa: "consistente" | "concentrada";
  /** Frecuencia central en Hz (vacío = los primeros modos). */
  centroHz: string;
  deformacionCortante: boolean;
  sturm: boolean;
  resolvedor: Resolvedor;
}

export interface Argumentos {
  args: Record<string, unknown>;
  errores: string[];
}

export function argumentosEstatico(v: ValoresEstatico): Argumentos {
  const errores: string[] = [];
  if (v.todos.length === 0) errores.push("El modelo no tiene casos de carga: no hay nada que resolver.");
  else if (v.casos.length === 0) errores.push("Marca al menos un caso de carga.");
  const args: Record<string, unknown> = { deformacion_cortante: v.deformacionCortante };
  // Todos marcados ⇒ sin «casos» (el kernel resuelve todos, también los que se añadan): más corto en el historial.
  if (v.casos.length !== v.todos.length) args.casos = [...v.casos];
  if (v.resolvedor !== "auto") args.resolvedor = v.resolvedor;
  return { args, errores };
}

export function argumentosModal(v: ValoresModal): Argumentos {
  const errores: string[] = [];
  const texto = v.modos.trim();
  const n = Number(texto);
  if (!/^\d+$/.test(texto) || !Number.isInteger(n) || n < 1 || n > 1000) errores.push("Número de modos: un entero de 1 a 1000.");
  const args: Record<string, unknown> = {
    n_modos: Number.isInteger(n) ? n : 12,
    masa: v.masa,
    deformacion_cortante: v.deformacionCortante,
    sturm: v.sturm,
  };
  const centro = v.centroHz.trim().replace(",", ".");
  if (centro !== "") {
    const hz = Number(centro);
    if (!Number.isFinite(hz) || hz <= 0) errores.push("Frecuencia central: un número de hercios mayor que 0 (o vacío para los primeros modos).");
    else args.desplazamiento = sigmaDeFrecuencia(hz); // rad²/s²
  }
  if (v.resolvedor !== "auto") args.resolvedor = v.resolvedor;
  return { args, errores };
}
