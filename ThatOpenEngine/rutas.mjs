// @ts-check
// Ventanas nativas «Abrir» / «Guardar como» y título de la ventana: lo que el proceso principal valida de la página,
// sin Electron, para probarlo en Node (test/rutas.test.ts).
//   covillaf-simulate:elegir-ruta  {modo: "abrir" | "guardar", tipo: "vyba" | "vybs" | "vybres", sugerida?}
//   covillaf-simulate:titulo       texto
// La página no escribe archivos: solo recibe la ruta absoluta que eligió el usuario y se la pasa al kernel.
import path from "node:path";

/** Tipos de archivo que la interfaz puede pedir, con su filtro y los textos de las ventanas. */
export const TIPOS_ARCHIVO = Object.freeze({
  vyba: Object.freeze({ nombre: "Ensamble de COVILLAF DESIGN", abrir: "Importar un ensamble de COVILLAF DESIGN", guardar: "Guardar el ensamble" }),
  vybs: Object.freeze({ nombre: "Modelo de simulación", abrir: "Abrir un modelo de simulación", guardar: "Guardar el modelo de simulación" }),
  vybres: Object.freeze({ nombre: "Resultados de simulación", abrir: "Abrir resultados de simulación", guardar: "Guardar los resultados" }),
});

/** @typedef {keyof typeof TIPOS_ARCHIVO} TipoArchivo */
/** @typedef {{ modo: "abrir" | "guardar", tipo: TipoArchivo, sugerida: string | null }} PeticionRuta */

/** Largo máximo del título y de una ruta sugerida que se aceptan de la página. */
export const MAX_TITULO = 300;
export const MAX_RUTA = 4096;
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROLES = /[\u0000-\u001f\u007f]/g;

/**
 * @param {unknown} tipo
 * @returns {tipo is TipoArchivo}
 */
function esTipo(tipo) {
  return typeof tipo === "string" && Object.hasOwn(TIPOS_ARCHIVO, tipo);
}

/**
 * Petición de la interfaz para la ventana nativa. `sugerida` solo se usa si es una ruta absoluta local sin caracteres
 * de control (si no, se ignora). null si la petición no es válida.
 * @param {unknown} datos
 * @returns {PeticionRuta | null}
 */
export function peticionRuta(datos) {
  if (typeof datos !== "object" || datos === null || Array.isArray(datos)) return null;
  const { modo, tipo, sugerida } = /** @type {{ modo?: unknown, tipo?: unknown, sugerida?: unknown }} */ (datos);
  if (modo !== "abrir" && modo !== "guardar") return null;
  if (!esTipo(tipo)) return null;
  // sin rutas de red (\\equipo\recurso): abrir la ventana en ellas ya conectaría por SMB (el kernel también las rechaza)
  const valida = typeof sugerida === "string" && sugerida.length > 0 && sugerida.length <= MAX_RUTA && !CONTROL.test(sugerida) && path.isAbsolute(sugerida) && !/^[\\/]{2}/.test(sugerida) && !/^[\\/]\?\?[\\/]/.test(sugerida); // ni \??\ (B8)
  return { modo, tipo, sugerida: valida ? sugerida : null };
}

/**
 * Filtros de la ventana: el del tipo pedido, sin «Todos los archivos» (el kernel rechaza otras extensiones).
 * @param {TipoArchivo} tipo
 */
export function filtros(tipo) {
  return [{ name: `${TIPOS_ARCHIVO[tipo].nombre} (*.${tipo})`, extensions: [tipo] }];
}

/**
 * Opciones de `dialog.showSaveDialog` (Windows pregunta antes de sustituir y añade la extensión si falta).
 * @param {PeticionRuta} p
 * @returns {import("electron").SaveDialogOptions}
 */
export function opcionesGuardar(p) {
  return {
    title: TIPOS_ARCHIVO[p.tipo].guardar,
    buttonLabel: "Guardar",
    filters: filtros(p.tipo),
    properties: ["showOverwriteConfirmation", "createDirectory"],
    ...(p.sugerida ? { defaultPath: p.sugerida } : {}),
  };
}

/**
 * Opciones de `dialog.showOpenDialog`: un solo archivo del tipo pedido (la ventana empieza en la carpeta sugerida).
 * @param {PeticionRuta} p
 * @returns {import("electron").OpenDialogOptions}
 */
export function opcionesAbrir(p) {
  return {
    title: TIPOS_ARCHIVO[p.tipo].abrir,
    buttonLabel: p.tipo === "vyba" ? "Importar" : "Abrir",
    filters: filtros(p.tipo),
    properties: ["openFile"],
    ...(p.sugerida ? { defaultPath: path.extname(p.sugerida) ? path.dirname(p.sugerida) : p.sugerida } : {}),
  };
}

/**
 * Título de la ventana que manda la página: sin caracteres de control y con un largo máximo; null si no es válido
 * (el proceso principal conserva el anterior).
 * @param {unknown} texto
 * @returns {string | null}
 */
export function tituloVentana(texto) {
  if (typeof texto !== "string") return null;
  const limpio = texto.replace(CONTROLES, " ").trim().slice(0, MAX_TITULO);
  return limpio || null;
}
