// @ts-check
// Seguridad de la app de escritorio de COVILLAF SIMULATE: origen propio app://covillaf-simulate (el ÚNICO Origin fijo que
// acepta el kernel, rpc_simulate.md §1: app://covillaf de DESIGN da 4403), CSP estricta sin orígenes remotos, resolución
// segura de archivos de la interfaz, reglas de navegación y permisos. Funciones puras (sin Electron): se prueban en
// test/seguridad.test.ts.
//
// Lo que no depende del host se toma de COVILLAF DESIGN POR RUTA (familia.mjs): CSP, cabeceras, tipos MIME, resolverRecurso,
// origenDesarrollo y la lista de permisos. urlPermitida y permisoPermitido llevan en DESIGN el host «covillaf» fijo: aquí
// van propios, con «covillaf-simulate».
//
// La CSP es la de la página principal de DESIGN (politicaCsp("/")) para CUALQUIER ruta: la excepción de DESIGN para su
// documento aislado del resolvedor de bocetos (/resolvedor.html, con 'unsafe-eval') no existe en SIMULATE.
import { DESIGN } from "./familia.mjs";

const S = DESIGN.seguridad;

/** Esquema propio (registrado como estándar y seguro): la interfaz se sirve en app://covillaf-simulate/. */
export const ESQUEMA = "app";
export const HOST_APP = "covillaf-simulate";
export const ORIGEN_APP = `${ESQUEMA}://${HOST_APP}`;

/** Tipo MIME por extensión (DESIGN). */
export const tipoMime = S.tipoMime;
/** Ruta absoluta dentro de la carpeta de la interfaz, o null si se sale de ella (DESIGN). */
export const resolverRecurso = S.resolverRecurso;
/** Origen del servidor de desarrollo (solo http://127.0.0.1|localhost:<puerto>, sin «/» final), o null (DESIGN). */
export const origenDesarrollo = S.origenDesarrollo;
/** Permisos que la interfaz puede usar para su propio origen (DESIGN). */
export const PERMISOS_PERMITIDOS = S.PERMISOS_PERMITIDOS;

/**
 * CSP de la interfaz (la misma para todas las rutas): nada remoto; solo la app, blob:/data: locales y el kernel en
 * ws://127.0.0.1 (cualquier puerto).
 */
export function politicaCsp() {
  // SIMULATE no usa marcos (DESIGN los necesita para su resolvedor de bocetos): frame-src 'none' (auditoría 6fc4e37, B7)
  return S.politicaCsp("/").replace("frame-src 'self'", "frame-src 'none'");
}

/** Cabeceras de seguridad de cada respuesta de app://covillaf-simulate. */
export function cabecerasSeguridad() {
  return { ...S.cabecerasSeguridad("/"), "Content-Security-Policy": politicaCsp() };
}

/**
 * ¿Puede la ventana de la app navegar a esta URL? Solo app://covillaf-simulate/… (y el servidor de desarrollo si se
 * arrancó con COVILLAF_SIMULATE_DEV_URL).
 * @param {string | undefined | null} url
 * @param {string | null} [desarrollo] origen de desarrollo permitido
 */
export function urlPermitida(url, desarrollo = null) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol === `${ESQUEMA}:` && u.host === HOST_APP) return true;
    return desarrollo !== null && u.origin === desarrollo;
  } catch {
    return false;
  }
}

/**
 * @param {string} permiso
 * @param {string | undefined | null} origenSolicitante
 * @param {string | null} [desarrollo]
 */
export function permisoPermitido(permiso, origenSolicitante, desarrollo = null) {
  return PERMISOS_PERMITIDOS.includes(permiso) && urlPermitida(origenSolicitante, desarrollo);
}
