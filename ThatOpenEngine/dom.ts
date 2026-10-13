// Creación de elementos sin plantillas de texto (nada de innerHTML con datos: los nombres vienen de archivos del usuario).

type Hijo = Node | string | number | null | undefined | false;
type Atributos = Record<string, string | number | boolean | null | undefined | EventListener>;

/** `h("button", {class: "x", onclick: fn}, "texto")`. Los atributos `on…` son oyentes; `false`/`null` no se ponen. */
export function h<K extends keyof HTMLElementTagNameMap>(etiqueta: K, atributos: Atributos = {}, ...hijos: Hijo[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave.startsWith("on") && typeof valor === "function") e.addEventListener(clave.slice(2), valor as EventListener);
    else if (valor === true) e.setAttribute(clave, "");
    else e.setAttribute(clave, String(valor));
  }
  for (const hijo of hijos) if (hijo !== null && hijo !== undefined && hijo !== false) e.append(typeof hijo === "number" ? String(hijo) : hijo);
  return e;
}

/** Icono SVG propio (trazos de 24 × 24, `currentColor`). */
export function icono(trazos: string, clase = "icono"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", clase);
  svg.setAttribute("aria-hidden", "true");
  for (const d of trazos.split("|")) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
