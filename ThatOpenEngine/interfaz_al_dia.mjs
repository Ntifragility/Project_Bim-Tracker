// ¿Está al día la interfaz compilada (packages/ui/dist)? Sale con 0 si dist/index.html es más nuevo que todas las fuentes
// que entran en la compilación —las de SIMULATE (packages/ui, packages/viewer) y las que se consumen por alias de los
// hermanos (web/src de COVILLAF 3D y packages/ui/src de DESIGN)— y con 1 si falta o hay alguna más nueva (la dice).
// Lo usa «COVILLAF SIMULATE.bat» para recompilar solo cuando hace falta (auditoría del commit 6fc4e37, B6).
//   node tools/interfaz_al_dia.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESIGN = path.resolve(process.env.COVILLAF_DESIGN_ROOT ?? path.join(RAIZ, "..", "07.34 COVILLAF DESIGN"));
const COVILLAF3D = path.resolve(process.env.COVILLAF3D_APP ?? path.join(RAIZ, "..", "07.33 COVILLAF 3D", "01_trimble-connect", "app"));
const EXTENSIONES = new Set([".ts", ".mts", ".js", ".mjs", ".css", ".html", ".json", ".png"]);
const FUENTES = [
  path.join(RAIZ, "packages", "ui", "src"),
  path.join(RAIZ, "packages", "ui", "public"),
  path.join(RAIZ, "packages", "ui", "index.html"),
  path.join(RAIZ, "packages", "ui", "vite.config.ts"),
  path.join(RAIZ, "packages", "viewer", "src"),
  path.join(RAIZ, "packages", "viewer", "covillaf3d"),
  path.join(DESIGN, "packages", "ui", "src", "protocolo"),
  path.join(DESIGN, "packages", "ui", "src", "textos.ts"),
  path.join(DESIGN, "packages", "viewer", "src", "marcos.ts"),
  path.join(COVILLAF3D, "web", "src"),
];

/** @param {string} p @returns {{ ruta: string, t: number } | null} el archivo más nuevo bajo p */
function masNuevo(p) {
  let mejor = null;
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return null;
  }
  if (st.isFile()) return EXTENSIONES.has(path.extname(p)) ? { ruta: p, t: st.mtimeMs } : null;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const m = masNuevo(path.join(p, e.name));
    if (m && (!mejor || m.t > mejor.t)) mejor = m;
  }
  return mejor;
}

const indice = path.join(RAIZ, "packages", "ui", "dist", "index.html");
let compilada = 0;
try {
  compilada = fs.statSync(indice).mtimeMs;
} catch {
  console.log("La interfaz no está compilada.");
  process.exit(1);
}
for (const f of FUENTES) {
  const m = masNuevo(f);
  if (m && m.t > compilada) {
    console.log(`La interfaz compilada es anterior a ${path.relative(path.dirname(RAIZ), m.ruta)}.`);
    process.exit(1);
  }
}
process.exit(0);
