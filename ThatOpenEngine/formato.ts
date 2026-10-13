// Números y unidades para la interfaz (sin DOM). El kernel trabaja en N · mm · s · t (F0-06); la interfaz muestra
// siempre la unidad y pasa fuerzas y momentos a kN y kN·m, que es como se leen en planta. Nada de factores ocultos:
// `mostrar` devuelve el valor ya convertido con su unidad.

const NUMERO = new Intl.NumberFormat("es", { maximumSignificantDigits: 4 });
const CIENTIFICO = new Intl.NumberFormat("es", { notation: "scientific", maximumSignificantDigits: 4 });

/** Conversión de la unidad interna a la de pantalla: [factor, unidad]. */
const PANTALLA: Readonly<Record<string, readonly [number, string]>> = {
  N: [1e-3, "kN"],
  "N.mm": [1e-6, "kN·m"],
  "N·mm": [1e-6, "kN·m"],
  mm: [1, "mm"],
  rad: [1, "rad"],
  Hz: [1, "Hz"],
  s: [1, "s"],
  MPa: [1, "MPa"],
  "1": [1, ""],
};

/** Número corto en español (4 cifras significativas; científico si es muy grande o muy pequeño). */
export function numero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  if (valor === 0) return "0";
  const a = Math.abs(valor);
  return a >= 1e6 || a < 1e-3 ? CIENTIFICO.format(valor) : NUMERO.format(valor);
}

/** Valor en la unidad interna → texto en la unidad de pantalla («12,35 kN»). */
export function mostrar(valor: number | null | undefined, unidadInterna: string): string {
  const [factor, unidad] = PANTALLA[unidadInterna] ?? [1, unidadInterna];
  const texto = numero(valor === null || valor === undefined ? valor : valor * factor);
  return unidad ? `${texto} ${unidad}` : texto;
}

/** Unidad de pantalla de una unidad interna. */
export function unidadPantalla(unidadInterna: string): string {
  return (PANTALLA[unidadInterna] ?? [1, unidadInterna])[1];
}

/** Factor de pantalla de una unidad interna. */
export function factorPantalla(unidadInterna: string): number {
  return (PANTALLA[unidadInterna] ?? [1, unidadInterna])[0];
}

/** σ (rad²/s²) del desplazamiento del modal a partir de una frecuencia en Hz: σ = (2πf)². */
export function sigmaDeFrecuencia(hz: number): number {
  return (2 * Math.PI * hz) ** 2;
}

/** Componentes de los esfuerzos (magnitud 16 de VYBF) con su unidad interna. */
export const ESFUERZOS = [
  { id: "N", titulo: "Axil N", unidad: "N" },
  { id: "Vy", titulo: "Cortante Vy", unidad: "N" },
  { id: "Vz", titulo: "Cortante Vz", unidad: "N" },
  { id: "T", titulo: "Torsor T", unidad: "N.mm" },
  { id: "My", titulo: "Flector My", unidad: "N.mm" },
  { id: "Mz", titulo: "Flector Mz", unidad: "N.mm" },
] as const;

/** Texto de un porcentaje de progreso (null = indeterminado). */
export function porcentaje(fraccion: number | null | undefined): string {
  return fraccion === null || fraccion === undefined ? "…" : `${Math.round(Math.min(1, Math.max(0, fraccion)) * 100)} %`;
}
