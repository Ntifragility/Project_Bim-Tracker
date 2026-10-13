// Contrato del puente que expone el preload de la app de escritorio (apps/desktop/preload.cjs) como
// `window.covillafSimulate`. Sin él (la interfaz abierta en un navegador) no hay kernel: se avisa.

export type TipoArchivo = "vyba" | "vybs" | "vybres";

export type EstadoKernelEscritorio =
  | { fase: "detenido" }
  | { fase: "arrancando"; intento?: number }
  | { fase: "listo"; kernel?: string; protocolo?: number; pid?: number; puerto?: number }
  | { fase: "reiniciando"; motivo?: string; stderr?: string }
  | { fase: "error"; mensaje: string; stderr?: string; reintentable?: boolean };

export interface PuenteEscritorio {
  escritorio: true;
  version: string;
  diagnostico: boolean;
  kernel(): Promise<{ puerto: number; token: string }>;
  estadoKernel(): Promise<EstadoKernelEscritorio>;
  alCambiarKernel(fn: (e: EstadoKernelEscritorio) => void): () => void;
  reiniciarKernel(): Promise<void>;
  elegirRuta(modo: "abrir" | "guardar", tipo: TipoArchivo, sugerida?: string): Promise<string | null>;
  info(): Promise<Record<string, unknown>>;
  titulo(texto: string): Promise<void> | void;
}

declare global {
  interface Window {
    covillafSimulate?: PuenteEscritorio;
  }
}

export function puenteEscritorio(): PuenteEscritorio | null {
  const p = typeof window !== "undefined" ? window.covillafSimulate : undefined;
  return p && p.escritorio === true ? p : null;
}
