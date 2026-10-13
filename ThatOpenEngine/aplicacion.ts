// Interfaz de COVILLAF SIMULATE: cinta (Inicio, Análisis, Resultados, Vista), navegador del modelo y los resultados,
// visor de COVILLAF 3D con la capa de resultados, propiedades, y panel inferior (tareas, tablas, verificación, consola).
// Todo lo que cambia el modelo o calcula es un comando o una tarea del kernel (H-04): la consola los acepta por nombre.
import { asistenteEstatico, asistenteModal } from "./asistentes.ts";
import { h, icono } from "./dom.ts";
import { ESFUERZOS, mostrar, numero, porcentaje } from "./formato.ts";
import type { AvisoTarea, KernelSimulate, MaximoCampo, MetaCampo } from "./kernel.ts";
import type { PuenteEscritorio, TipoArchivo } from "./puente.ts";

// --- contratos -----------------------------------------------------------------------------------------------------------

/** Lo que la aplicación necesita del visor (lo implementa visor.ts sobre @covillaf-simulate/viewer). */
export interface VisorApp {
  fijarGeometria(g: GeometriaJson): void;
  vaciarResultados(): void;
  mostrarDeformada(trama: ArrayBuffer): void;
  mostrarDiagrama(trama: ArrayBuffer, componente: number): void;
  animarModo(trama: ArrayBuffer): void;
  mostrarReacciones(r: { nodo: number; valores: number[] }[]): void;
  /** Multiplica la escala automática del último campo (1 = automática). */
  fijarEscalaRelativa(factor: number): void;
  /** Valores del campo mostrado en una estación (null si no hay campo). */
  valorEn(estacion: number): number[] | null;
  encuadrar(): void;
  vista(v: "iso" | "planta" | "alzado" | "lateral"): void;
  fijarTema(oscuro: boolean): void;
  dispose(): void;
}

export interface ModuloVisor {
  montar(contenedor: HTMLElement, oyentes: { alElegir(e: { barra: string; estacion: number; x: number } | null): void }): Promise<VisorApp>;
}

export interface GeometriaJson {
  guid: string;
  nombre: string;
  unidad: "mm";
  caja: [number[], number[]];
  nodos: { id: string; punto: number[] }[];
  barras: { id: string; nodos: [number, number]; extremos: number[][]; ejes: number[][]; estaciones: number[] }[];
  apoyos: { nodo: number; restricciones: boolean[] }[];
  huella: string;
  revision: number;
  n_estaciones: number;
  estados: {
    estatico: { casos: string[]; combinaciones: { id: string; tipo: string }[]; fecha: string } | null;
    modal: { modos: { modo: number; frecuencia: number; periodo: number | null }[]; fecha: string } | null;
  };
}

interface Resumen {
  cargado: boolean;
  modificado: boolean;
  guid?: string;
  nombre?: string;
  nodos?: number;
  barras?: number;
  apoyos?: number;
  materiales?: number;
  secciones?: number;
  casos?: string[];
  combinaciones?: string[];
  problemas?: string[];
  avisos?: string[];
  archivo: { ruta: string; al_dia: boolean; solo_lectura: boolean } | null;
  resultados: Record<string, { estado: "al_dia" | "desactualizado"; fecha: string }>;
}

type Vista =
  | { tipo: "modelo" }
  | { tipo: "deformada"; estado: string }
  | { tipo: "diagrama"; estado: string; componente: number }
  | { tipo: "reacciones"; estado: string }
  | { tipo: "modo"; modo: number };

interface Tabla {
  columnas: { id: string; titulo: string; unidad: string }[];
  filas: (string | number | null)[][];
}

// Iconos propios (24 × 24).
const I = {
  importar: "M12 3v12|M7 10l5 5 5-5|M4 17v3h16v-3",
  abrir: "M3 7h6l2 2h10v10H3z",
  guardar: "M5 3h11l3 3v15H5z|M8 3v6h8V3|M8 21v-7h8v7",
  deshacer: "M9 7L4 12l5 5|M4 12h11a5 5 0 0 1 0 10h-3",
  rehacer: "M15 7l5 5-5 5|M20 12H9a5 5 0 0 0 0 10h3",
  estatico: "M3 20h18|M6 20V9|M18 20V9|M6 9h12|M12 4v5|M10 6l2-2 2 2",
  modal: "M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0",
  verificar: "M4 12l5 5L20 6",
  deformada: "M4 18V8|M20 18V8|M4 8c4 5 12 5 16 0",
  diagrama: "M3 16h18|M5 16c2-8 12-8 14 0",
  reacciones: "M12 3v12|M8 11l4 4 4-4|M5 21h14",
  animar: "M8 5v14l11-7z",
  encuadrar: "M4 9V4h5|M20 9V4h-5|M4 15v5h5|M20 15v5h-5",
  iso: "M12 3l8 4.5v9L12 21l-8-4.5v-9z|M12 12l8-4.5|M12 12v9|M12 12L4 7.5",
  planta: "M4 4h16v16H4z|M4 12h16|M12 4v16",
  alzado: "M4 20h16|M6 20V8h12v12|M6 8l6-4 6 4",
  vybres: "M5 3h11l3 3v15H5z|M8 14l3-3 2 2 3-4",
};

/** El máximo de un campo de una sola unidad (los esfuerzos traen uno por componente: se toma el primero). */
function unico(m: MaximoCampo | MaximoCampo[]): MaximoCampo {
  return Array.isArray(m) ? m[0] : m;
}

function textoError(e: unknown): string {
  const d = (e as { datos?: unknown })?.datos as { detalle?: unknown; clave?: unknown } | undefined;
  if (d && typeof d.detalle === "string" && d.detalle) return d.detalle;
  return e instanceof Error ? e.message : String(e);
}

// --- aplicación -----------------------------------------------------------------------------------------------------------

export interface OpcionesAplicacion {
  kernel: KernelSimulate;
  puente: PuenteEscritorio | null;
  cargarVisor: () => Promise<ModuloVisor>;
  alEstadoConexion: (fn: (texto: string, fase: "listo" | "espera" | "error") => void) => void;
}

export function montarAplicacion(raiz: HTMLElement, o: OpcionesAplicacion): void {
  const { kernel, puente } = o;
  let resumen: Resumen | null = null;
  let geometria: GeometriaJson | null = null;
  let visor: VisorApp | null = null;
  let vista: Vista = { tipo: "modelo" };
  let meta: MetaCampo | null = null;
  let seleccion: { barra: string; estacion: number; x: number } | null = null;
  let nombresTareas = new Set<string>(["analisis.estatico", "analisis.modal", "resultados.guardar_vybres", "verificacion.ejecutar"]);
  let peticion = 0; // la última petición de campo gana (clics rápidos)
  let ultimoCampo: { clave: string; meta: MetaCampo; trama: ArrayBuffer } | null = null;

  // ---------- consola (se usa para informar de todo) ----------
  const salida = h("pre", { class: "consola-salida", "aria-live": "polite" });
  function escribir(texto: string, clase: "" | "error" | "eco" = ""): void {
    salida.append(h("span", { class: clase }, `${texto}\n`));
    while (salida.childNodes.length > 400) salida.firstChild?.remove();
    salida.scrollTop = salida.scrollHeight;
  }
  function fallo(accion: string, e: unknown): void {
    escribir(`${accion}: ${textoError(e)}`, "error");
    mostrarInferior("consola");
  }

  // ---------- cinta ----------
  const selectorEstado = h("select", { "aria-label": "Caso o combinación", disabled: true });
  const selectorModo = h("select", { "aria-label": "Modo", disabled: true });
  const escala = h("input", { type: "range", min: "-3", max: "3", step: "0.05", value: "0", "aria-label": "Escala", disabled: true });
  const textoEscala = h("span", { class: "dato" }, "×1");
  const selectorTema = h("select", { "aria-label": "Tema" }, h("option", { value: "sistema" }, "Sistema"), h("option", { value: "claro" }, "Claro"),
    h("option", { value: "oscuro" }, "Oscuro"));

  const botones = new Map<string, HTMLButtonElement>();
  function boton(id: string, texto: string, trazos: string, accion: () => void, titulo = texto): HTMLButtonElement {
    const b = h("button", { class: "boton-cinta", type: "button", title: titulo, "data-accion": id }, icono(trazos, "icono icono-grande"), texto);
    b.addEventListener("click", accion);
    botones.set(id, b);
    return b;
  }
  const grupo = (titulo: string, ...hijos: HTMLElement[]) =>
    h("div", { class: "grupo" }, h("div", { class: "grupo-botones" }, ...hijos), h("div", { class: "grupo-titulo" }, titulo));

  const pestanas: Record<string, HTMLElement> = {
    Inicio: h("div", { class: "cinta-grupos" },
      grupo("Archivo",
        boton("importar", "Importar .vyba", I.importar, () => void importarVyba(), "Derivar el modelo analítico de un ensamble de COVILLAF DESIGN"),
        boton("abrir", "Abrir .vybs", I.abrir, () => void abrirVybs()),
        boton("guardar", "Guardar", I.guardar, () => void guardarVybs(false)),
        boton("guardar_como", "Guardar como", I.guardar, () => void guardarVybs(true))),
      grupo("Edición", boton("deshacer", "Deshacer", I.deshacer, () => void transaccion("deshacer")),
        boton("rehacer", "Rehacer", I.rehacer, () => void transaccion("rehacer")))),
    Análisis: h("div", { class: "cinta-grupos" },
      grupo("Analizar", boton("estatico", "Estático lineal", I.estatico, () => void analizarEstatico()),
        boton("modal", "Modal", I.modal, () => void analizarModal())),
      grupo("Calidad", boton("verificacion", "Casos de verificación", I.verificar, () => void verificacion(),
        "Ejecutar los casos de verificación del motor (soluciones de referencia con tolerancia declarada)")),
      grupo("Resultados", boton("vybres", "Guardar .vybres", I.vybres, () => void guardarVybres()))),
    Resultados: h("div", { class: "cinta-grupos" },
      grupo("Estático",
        h("div", { class: "grupo-controles" }, h("label", {}, "Estado", selectorEstado)),
        boton("deformada", "Deformada", I.deformada, () => void verDeformada()),
        ...ESFUERZOS.map((c, k) => boton(`diagrama_${c.id}`, c.id, I.diagrama, () => void verDiagrama(k), c.titulo)),
        boton("reacciones", "Reacciones", I.reacciones, () => void verReacciones())),
      grupo("Modal", h("div", { class: "grupo-controles" }, h("label", {}, "Modo", selectorModo)),
        boton("animar", "Animar modo", I.animar, () => void verModo())),
      grupo("Escala", h("div", { class: "grupo-controles" }, h("label", {}, escala, textoEscala),
        h("button", { type: "button", class: "boton", onclick: () => { escala.value = "0"; aplicarEscala(); } }, "Automática")))),
    Vista: h("div", { class: "cinta-grupos" },
      grupo("Encuadre", boton("encuadrar", "Encuadrar", I.encuadrar, () => visor?.encuadrar()),
        boton("iso", "Isométrica", I.iso, () => visor?.vista("iso")), boton("planta", "Planta", I.planta, () => visor?.vista("planta")),
        boton("alzado", "Alzado", I.alzado, () => visor?.vista("alzado")), boton("lateral", "Lateral", I.alzado, () => visor?.vista("lateral"))),
      grupo("Tema", h("div", { class: "grupo-controles" }, selectorTema))),
  };
  const barraPestanas = h("div", { class: "cinta-pestanas", role: "tablist" },
    h("div", { class: "marca" }, h("img", { src: "./marca/covillaf-simulate-icono-256.png", alt: "" }), "COVILLAF SIMULATE"));
  const contenidoCinta = h("div", {});
  function mostrarPestana(nombre: string): void {
    for (const b of barraPestanas.querySelectorAll<HTMLButtonElement>(".pestana")) b.setAttribute("aria-selected", String(b.textContent === nombre));
    contenidoCinta.replaceChildren(pestanas[nombre]);
  }
  for (const nombre of Object.keys(pestanas)) {
    barraPestanas.append(h("button", { class: "pestana", role: "tab", type: "button", onclick: () => mostrarPestana(nombre) }, nombre));
  }
  mostrarPestana("Inicio");

  // ---------- navegador, propiedades, visor ----------
  const navegador = h("aside", { class: "panel", "aria-label": "Modelo" });
  const propiedades = h("aside", { class: "panel", "aria-label": "Propiedades" });
  const contenedorVisor = h("div", { class: "visor", id: "visor", role: "region", "aria-label": "Visor 3D", tabindex: "-1" });
  const leyenda = h("div", { class: "leyenda", hidden: true });
  const avisoVisor = h("div", { class: "aviso-visor", hidden: true, role: "status" });
  const zonaVisor = h("main", { class: "zona-visor" }, contenedorVisor, leyenda, avisoVisor);

  // ---------- panel inferior ----------
  const listaTareas = h("ul", { class: "tareas", "aria-label": "Tareas" });
  const zonaTablas = h("div", {});
  const zonaVerificacion = h("div", {}, h("p", { class: "vacio" }, "Ejecuta los casos de verificación desde la pestaña Análisis."));
  const entrada = h("input", { type: "text", placeholder: "Comando o tarea: p. ej.  analisis.modal {\"n_modos\": 6}   ·   ayuda", "aria-label": "Línea de comandos", spellcheck: "false" });
  const cuerpos: Record<string, HTMLElement> = {
    tareas: h("div", {}, listaTareas),
    tablas: zonaTablas,
    verificacion: zonaVerificacion,
    consola: h("div", { class: "consola" }, salida, entrada),
  };
  const titulosInferior: Record<string, string> = { tareas: "Tareas", tablas: "Tablas", verificacion: "Verificación", consola: "Consola" };
  const pestanasInferior = h("div", { class: "inferior-pestanas", role: "tablist" });
  const cuerpoInferior = h("div", { class: "inferior-cuerpo" });
  function mostrarInferior(nombre: string): void {
    for (const b of pestanasInferior.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-selected", String(b.dataset.id === nombre));
    cuerpoInferior.replaceChildren(cuerpos[nombre]);
    if (nombre === "consola") salida.scrollTop = salida.scrollHeight; // al mostrarla, lo último a la vista (B9)
  }
  for (const [id, titulo] of Object.entries(titulosInferior)) {
    pestanasInferior.append(h("button", { type: "button", role: "tab", "data-id": id, onclick: () => mostrarInferior(id) }, titulo));
  }
  mostrarInferior("tareas");

  const puntoEstado = h("span", { class: "punto" });
  const textoEstado = h("span", {}, "Conectando con el kernel…");
  const reintentar = h("button", { type: "button", hidden: true, onclick: () => void puente?.reiniciarKernel() }, "Reintentar");
  const textoArchivo = h("span", {});
  const barraEstado = h("footer", { class: "estado" }, h("span", {}, puntoEstado, textoEstado), reintentar, textoArchivo,
    h("span", { class: "derecha" }, "N · mm · s · t (se muestra en kN y kN·m)"));

  raiz.replaceChildren(h("div", { class: "app" }, h("header", { class: "cinta" }, barraPestanas, contenidoCinta),
    h("div", { class: "espacio" }, navegador, h("div", { class: "centro" }, zonaVisor, h("section", { class: "inferior" }, pestanasInferior, cuerpoInferior)),
      propiedades), barraEstado));

  // ---------- tema ----------
  const clave = "covillaf-simulate:tema";
  function aplicarTema(): void {
    const t = selectorTema.value;
    document.documentElement.dataset.tema = t;
    try {
      localStorage.setItem(clave, t);
    } catch {
      /* sin almacenamiento: solo esta sesión */
    }
    const oscuro = t === "oscuro" || (t === "sistema" && matchMedia("(prefers-color-scheme: dark)").matches);
    visor?.fijarTema(oscuro);
  }
  try {
    selectorTema.value = localStorage.getItem(clave) ?? "sistema";
  } catch {
    selectorTema.value = "sistema";
  }
  selectorTema.addEventListener("change", aplicarTema);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", aplicarTema);
  aplicarTema();

  // ---------- conexión ----------
  let conectado = false;
  o.alEstadoConexion((texto, fase) => {
    textoEstado.textContent = texto;
    puntoEstado.className = `punto ${fase === "listo" ? "listo" : fase === "error" ? "error" : ""}`;
    reintentar.hidden = fase !== "error" || !puente;
    const antes = conectado;
    conectado = fase === "listo";
    actualizarBotones();
    if (conectado && !antes) void alConectar();
  });

  async function alConectar(): Promise<void> {
    try {
      const lista = (await kernel.cliente.solicitar("tarea.listar")) as { nombre: string }[];
      nombresTareas = new Set(lista.map((t) => t.nombre));
      for (const t of await kernel.recuperarTareas()) pintarTarea(t);
    } catch (e) {
      fallo("tareas", e);
    }
    await refrescar();
  }

  // ---------- estado del modelo ----------
  async function refrescar(): Promise<void> {
    peticion++; // el modelo pudo cambiar: ningún campo pedido antes se dibuja ya (A1)
    ultimoCampo = null;
    try {
      resumen = (await kernel.comando<Resumen>("modelo.resumen")).resultado;
    } catch (e) {
      fallo("modelo.resumen", e);
      return;
    }
    geometria = null;
    if (resumen.cargado) {
      try {
        geometria = await kernel.geometria<GeometriaJson>();
      } catch (e) {
        fallo("resultados.geometria", e);
      }
    }
    if (geometria) visor?.fijarGeometria(geometria);
    else visor?.vaciarResultados();
    vista = { tipo: "modelo" };
    meta = null;
    rellenarSelectores();
    pintarNavegador();
    pintarPropiedades();
    pintarLeyenda();
    actualizarBotones();
    const titulo = resumen.cargado ? `${resumen.nombre}${resumen.modificado ? " •" : ""} — COVILLAF SIMULATE` : "COVILLAF SIMULATE";
    document.title = titulo;
    void puente?.titulo(titulo);
    textoArchivo.textContent = resumen.archivo ? `${resumen.archivo.ruta}${resumen.archivo.solo_lectura ? " (solo lectura)" : ""}` : "";
  }
  kernel.alCambiarModelo(() => void refrescar());

  function rellenarSelectores(): void {
    const e = geometria?.estados.estatico;
    selectorEstado.replaceChildren(...(e ? [
      h("optgroup", { label: "Casos" }, ...e.casos.map((c) => h("option", { value: c }, c))),
      h("optgroup", { label: "Combinaciones" }, ...e.combinaciones.filter((c) => c.tipo === "lineal").map((c) => h("option", { value: c.id }, c.id))),
    ] : []));
    const m = geometria?.estados.modal;
    selectorModo.replaceChildren(...(m ? m.modos.map((x) => h("option", { value: String(x.modo) }, `${x.modo} · ${numero(x.frecuencia)} Hz`)) : []));
  }
  selectorEstado.addEventListener("change", () => {
    if (vista.tipo === "deformada") void verDeformada();
    else if (vista.tipo === "diagrama") void verDiagrama(vista.componente);
    else if (vista.tipo === "reacciones") void verReacciones();
  });
  selectorModo.addEventListener("change", () => {
    if (vista.tipo === "modo") void verModo();
  });

  function actualizarBotones(): void {
    const cargado = conectado && !!resumen?.cargado;
    const hayEstatico = cargado && !!geometria?.estados.estatico;
    const hayModal = cargado && !!geometria?.estados.modal;
    for (const [id, b] of botones) {
      let activo = conectado;
      if (["guardar", "guardar_como", "estatico", "modal", "vybres"].includes(id)) activo = cargado;
      if (id === "deformada" || id.startsWith("diagrama_") || id === "reacciones") activo = hayEstatico;
      if (id === "animar") activo = hayModal;
      if (["encuadrar", "iso", "planta", "alzado", "lateral"].includes(id)) activo = !!visor;
      b.disabled = !activo;
    }
    selectorEstado.disabled = !hayEstatico;
    selectorModo.disabled = !hayModal;
    escala.disabled = vista.tipo === "modelo" || vista.tipo === "reacciones";
    const pulsado = vista.tipo === "deformada" ? "deformada" : vista.tipo === "diagrama" ? `diagrama_${ESFUERZOS[vista.componente].id}`
      : vista.tipo === "reacciones" ? "reacciones" : vista.tipo === "modo" ? "animar" : "";
    for (const [id, b] of botones) if (id === "deformada" || id.startsWith("diagrama_") || id === "reacciones" || id === "animar") b.setAttribute("aria-pressed", String(id === pulsado));
  }

  // ---------- navegador y propiedades ----------
  function pintarNavegador(): void {
    const r = resumen;
    if (!r?.cargado) {
      navegador.replaceChildren(h("h2", {}, "Modelo"), h("p", { class: "vacio" }, "Sin modelo. Importa un ensamble .vyba de COVILLAF DESIGN o abre un modelo .vybs."));
      return;
    }
    const estadoRes = (tipo: string) => {
      const x = r.resultados[tipo];
      return x ? h("span", { class: `etiqueta ${x.estado === "al_dia" ? "ok" : "mal"}` }, x.estado === "al_dia" ? "al día" : "desactualizado")
        : h("span", { class: "etiqueta" }, "sin analizar");
    };
    const modal = geometria?.estados.modal;
    navegador.replaceChildren(
      h("h2", {}, "Modelo"),
      h("dl", { class: "ficha" }, h("dt", {}, "Nombre"), h("dd", {}, r.nombre ?? ""), h("dt", {}, "Nudos"), h("dd", {}, r.nodos ?? 0),
        h("dt", {}, "Barras"), h("dd", {}, r.barras ?? 0), h("dt", {}, "Apoyos"), h("dd", {}, r.apoyos ?? 0),
        h("dt", {}, "Materiales"), h("dd", {}, r.materiales ?? 0), h("dt", {}, "Secciones"), h("dd", {}, r.secciones ?? 0),
        h("dt", {}, "Estado"), h("dd", {}, r.modificado ? "con cambios sin guardar" : "guardado")),
      h("h2", {}, `Casos (${r.casos?.length ?? 0})`),
      h("ul", { class: "lista" }, ...(r.casos ?? []).map((c) => h("li", {}, h("button", { type: "button", "aria-pressed": String(vista.tipo !== "modo" && vista.tipo !== "modelo" && "estado" in vista && vista.estado === c),
        onclick: () => { selectorEstado.value = c; void verDeformada(); } }, h("span", {}, c))))),
      h("h2", {}, `Combinaciones (${r.combinaciones?.length ?? 0})`),
      h("ul", { class: "lista" }, ...(r.combinaciones ?? []).map((c) => h("li", {}, h("span", {}, c)))),
      h("h2", {}, "Resultados"),
      h("dl", { class: "ficha" }, h("dt", {}, "Estático"), h("dd", {}, estadoRes("estatico")), h("dt", {}, "Modal"), h("dd", {}, estadoRes("modal"))),
      ...(modal ? [h("ul", { class: "lista", "aria-label": "Modos" }, ...modal.modos.map((m) => h("li", {}, h("button", { type: "button",
        "aria-pressed": String(vista.tipo === "modo" && vista.modo === m.modo),
        onclick: () => { selectorModo.value = String(m.modo); void verModo(); } }, h("span", {}, `Modo ${m.modo}`),
        h("span", { class: "dato" }, `${numero(m.frecuencia)} Hz · T ${m.periodo === null ? "∞" : numero(m.periodo)} s`)))))] : []),
    );
  }

  function pintarPropiedades(): void {
    const partes: HTMLElement[] = [h("h2", {}, "Selección")];
    if (seleccion && geometria) {
      const b = geometria.barras.find((x) => x.id === seleccion?.barra);
      const largo = b ? Math.hypot(...b.extremos[1].map((v, k) => v - b.extremos[0][k])) : 0;
      const fila = (t: string, v: string) => [h("dt", {}, t), h("dd", {}, v)];
      const datos = [...fila("Barra", seleccion.barra), ...fila("Longitud", mostrar(largo, "mm")), ...fila("x", mostrar(seleccion.x, "mm"))];
      if (b) datos.push(...fila("Nudos", `${geometria.nodos[b.nodos[0]].id} → ${geometria.nodos[b.nodos[1]].id}`));
      const v = meta ? visor?.valorEn(seleccion.estacion) : null;
      if (v && meta) {
        if (meta.magnitud === "esfuerzos") ESFUERZOS.forEach((c, k) => datos.push(...fila(c.titulo, mostrar(v[k], c.unidad))));
        else ["X", "Y", "Z"].forEach((c, k) => datos.push(...fila(`${meta?.magnitud === "forma" ? "φ" : "u"}${c}`, meta?.magnitud === "forma" ? numero(v[k]) : mostrar(v[k], "mm"))));
      }
      partes.push(h("dl", { class: "ficha" }, ...datos));
    } else partes.push(h("p", { class: "vacio" }, "Pulsa una barra en el visor."));
    if (meta) {
      partes.push(h("h2", {}, "Resultado mostrado"));
      const titulo = meta.tipo === "modal" ? `Modo ${meta.modo} · ${numero(meta.frecuencia)} Hz` : `${meta.magnitud} · ${meta.estado}`;
      const ficha: HTMLElement[] = [h("dt", {}, "Qué"), h("dd", {}, titulo)];
      if (meta.magnitud === "esfuerzos") {
        // el «máximo» del kernel es la norma de las 6 componentes (N y N·mm mezclados): aquí, el rango de la dibujada
        const k = vista.tipo === "diagrama" ? vista.componente : 0;
        const c = ESFUERZOS[k];
        ficha.push(h("dt", {}, `${c.id} mínimo`), h("dd", {}, mostrar(meta.rango[k][0], c.unidad)), h("dt", {}, `${c.id} máximo`),
          h("dd", {}, mostrar(meta.rango[k][1], c.unidad)));
      } else {
        ficha.push(h("dt", {}, "Máximo"), h("dd", {}, meta.magnitud === "forma" ? numero(unico(meta.maximo).valor) : mostrar(unico(meta.maximo).valor, "mm")),
          h("dt", {}, "En"), h("dd", {}, unico(meta.maximo).barra ? `${unico(meta.maximo).barra}, x = ${mostrar(unico(meta.maximo).x, "mm")}` : "—"));
      }
      ficha.push(h("dt", {}, "Estaciones"), h("dd", {}, meta.n_valores));
      partes.push(h("dl", { class: "ficha" }, ...ficha));
    }
    const avisos = [...(resumen?.problemas ?? []), ...(resumen?.avisos ?? [])];
    if (avisos.length) partes.push(h("h2", {}, `Avisos del modelo (${avisos.length})`), h("ul", { class: "aviso-lista" }, ...avisos.slice(0, 50).map((a) => h("li", {}, a))));
    propiedades.replaceChildren(...partes);
  }

  function pintarLeyenda(): void {
    if (!meta || vista.tipo === "modelo") {
      leyenda.hidden = true;
      return;
    }
    let titulo = "";
    let detalle = "";
    if (vista.tipo === "deformada") {
      titulo = `Deformada · ${vista.estado}`;
      detalle = `desplazamiento máximo ${mostrar(unico(meta.maximo).valor, "mm")}`;
    } else if (vista.tipo === "diagrama") {
      const c = ESFUERZOS[vista.componente];
      const [mn, mx] = meta.rango[vista.componente];
      titulo = `${c.titulo} · ${vista.estado}`;
      detalle = `de ${mostrar(mn, c.unidad)} a ${mostrar(mx, c.unidad)} · positivo azul, negativo rojo`;
    } else if (vista.tipo === "reacciones") {
      titulo = `Reacciones · ${vista.estado}`;
    } else if (vista.tipo === "modo") {
      titulo = `Modo ${vista.modo} · ${numero(meta.frecuencia)} Hz`;
      detalle = "forma normalizada a masa unidad (escala de dibujo)";
    }
    leyenda.replaceChildren(h("strong", {}, titulo), detalle ? h("span", {}, detalle) : "",
      vista.tipo === "diagrama" ? h("div", { class: "escala" }, h("span", {}, "−"), h("span", { class: "barra-color" }), h("span", {}, "+")) : "");
    leyenda.hidden = false;
  }

  // ---------- resultados en el visor ----------
  async function pedirCampo(nueva: Vista, params: Parameters<KernelSimulate["campo"]>[0], aplicar: (t: ArrayBuffer) => void): Promise<void> {
    if (!visor) return;
    const esta = ++peticion;
    avisoVisor.hidden = false;
    avisoVisor.className = "aviso-visor";
    avisoVisor.textContent = "Calculando el campo en el kernel…";
    try {
      // Los 6 diagramas de un estado salen de la misma trama de esfuerzos: se reutiliza la última (M5).
      const clave = `${geometria?.revision}|${JSON.stringify(params)}`;
      const { meta: m, trama } = ultimoCampo?.clave === clave ? ultimoCampo : await kernel.campo(params);
      ultimoCampo = { clave, meta: m, trama };
      // Otra vista o un modelo nuevo desde que se pidió: esta respuesta ya no vale (auditoría 6fc4e37, A1 y M1).
      if (esta !== peticion) return;
      if (!geometria || m.revision !== geometria.revision) {
        escribir("El campo recibido es de otra geometría (el modelo cambió): no se dibuja.", "error");
        return;
      }
      aplicar(trama); // si la capa lo rechaza, lanza y el estado de la interfaz no cambia (B1)
      meta = m;
      vista = nueva;
      aplicarEscala();
    } catch (e) {
      if (esta === peticion) fallo("resultados.campo", e);
    } finally {
      if (esta === peticion) avisoVisor.hidden = true;
    }
    pintarLeyenda();
    pintarPropiedades();
    pintarNavegador();
    actualizarBotones();
  }

  async function verDeformada(): Promise<void> {
    const estado = selectorEstado.value;
    if (estado) await pedirCampo({ tipo: "deformada", estado }, { tipo: "estatico", magnitud: "desplazamiento", estado }, (t) => visor?.mostrarDeformada(t));
  }
  async function verDiagrama(componente: number): Promise<void> {
    const estado = selectorEstado.value;
    if (estado) await pedirCampo({ tipo: "diagrama", estado, componente }, { tipo: "estatico", magnitud: "esfuerzos", estado }, (t) => visor?.mostrarDiagrama(t, componente));
  }
  async function verModo(): Promise<void> {
    const modo = Number(selectorModo.value);
    if (modo >= 1) await pedirCampo({ tipo: "modo", modo }, { tipo: "modal", magnitud: "forma", modo }, (t) => visor?.animarModo(t));
  }
  async function verReacciones(): Promise<void> {
    const estado = selectorEstado.value;
    if (!estado || !geometria || !visor) return;
    const esta = ++peticion; // invalida cualquier campo pedido antes (M1)
    try {
      const t = await kernel.tabla<Tabla>("reacciones", estado);
      if (esta !== peticion || !geometria || !visor) return;
      const indice = new Map(geometria.nodos.map((n, k) => [n.id, k]));
      visor.mostrarReacciones(t.filas.map((f) => ({ nodo: indice.get(String(f[0])) ?? -1, valores: f.slice(1).map(Number) })).filter((r) => r.nodo >= 0));
      vista = { tipo: "reacciones", estado };
      meta = null;
      pintarTabla("reacciones", t);
    } catch (e) {
      fallo("reacciones", e);
    }
    pintarLeyenda();
    actualizarBotones();
  }

  function aplicarEscala(): void {
    const factor = 10 ** Number(escala.value);
    textoEscala.textContent = `×${numero(factor)}`;
    visor?.fijarEscalaRelativa(factor);
  }
  escala.addEventListener("input", aplicarEscala);

  // ---------- tablas ----------
  const selectorTabla = h("select", { "aria-label": "Tabla" }, h("option", { value: "reacciones" }, "Reacciones"),
    h("option", { value: "desplazamientos" }, "Desplazamientos de los nudos"), h("option", { value: "esfuerzos" }, "Esfuerzos en los extremos"),
    h("option", { value: "modos" }, "Modos"));
  const cuerpoTabla = h("div", {}, h("p", { class: "vacio" }, "Elige una tabla (necesita resultados al día)."));
  zonaTablas.append(h("div", { class: "barra-tabla" }, selectorTabla, h("button", { type: "button", class: "boton", onclick: () => void cargarTabla() }, "Mostrar"),
    h("span", { class: "dato" }, "fuerzas en kN, momentos en kN·m, desplazamientos en mm")), cuerpoTabla);
  async function cargarTabla(): Promise<void> {
    const nombre = selectorTabla.value;
    try {
      const t = await kernel.tabla<Tabla>(nombre, nombre === "modos" ? undefined : selectorEstado.value || undefined);
      pintarTabla(nombre, t);
    } catch (e) {
      fallo(`tabla ${nombre}`, e);
    }
  }
  function pintarTabla(nombre: string, t: Tabla): void {
    selectorTabla.value = nombre;
    const cabeza = h("tr", {}, ...t.columnas.map((c) => {
      const u = c.unidad === "N" ? "kN" : c.unidad === "N·mm" ? "kN·m" : c.unidad === "1" ? "" : c.unidad;
      return h("th", { scope: "col" }, u ? `${c.titulo} (${u})` : c.titulo);
    }));
    const filas = t.filas.slice(0, 5000).map((f) => h("tr", {}, ...f.map((v, k) => {
      const u = t.columnas[k]?.unidad ?? "";
      const texto = typeof v === "number" ? (u === "N" ? numero(v / 1e3) : u === "N·mm" ? numero(v / 1e6) : numero(v)) : String(v ?? "—");
      return h("td", {}, texto);
    })));
    cuerpoTabla.replaceChildren(h("table", { class: "tabla-datos" }, h("thead", {}, cabeza), h("tbody", {}, ...filas)),
      t.filas.length > 5000 ? h("p", { class: "vacio" }, `Se muestran 5 000 de ${t.filas.length} filas.`) : "");
    mostrarInferior("tablas");
  }

  // ---------- tareas ----------
  const filasTarea = new Map<string, HTMLLIElement>();
  const NOMBRES: Record<string, string> = {
    "analisis.estatico": "Análisis estático", "analisis.modal": "Análisis modal", "resultados.guardar_vybres": "Guardar resultados",
    "verificacion.ejecutar": "Casos de verificación",
  };
  function pintarTarea(t: AvisoTarea): void {
    let li = filasTarea.get(t.id);
    if (!li) {
      li = h("li", { class: "tarea" });
      filasTarea.set(t.id, li);
      listaTareas.prepend(li);
      while (listaTareas.children.length > 30) listaTareas.lastElementChild?.remove();
    }
    const vivo = t.estado === "en_cola" || t.estado === "en_curso" || t.estado === "cancelando";
    const cancelar = h("button", { type: "button", class: "boton", disabled: !vivo || t.estado === "cancelando",
      onclick: () => { kernel.marcarCancelando(t.id); void kernel.cancelar(t.id).catch((e) => fallo("cancelar", e)); } }, "Cancelar");
    const estado = { en_cola: "en cola", en_curso: porcentaje(t.fraccion), cancelando: "cancelando…", terminada: "terminada", fallida: "fallida",
      cancelada: "cancelada" }[t.estado];
    const barra = h("div", { class: `progreso${vivo && t.fraccion === null ? " indeterminado" : ""}` },
      h("i", { style: `width:${Math.round((t.estado === "terminada" ? 1 : (t.fraccion ?? 0)) * 100)}%` }));
    li.className = `tarea ${t.estado}`;
    li.replaceChildren(h("strong", {}, `${NOMBRES[t.nombre] ?? t.nombre} · ${estado}`), vivo ? cancelar : h("span", {}),
      h("span", { class: "texto" }, t.estado === "fallida" ? (t.error?.detalle ?? "") : t.texto), barra);
  }
  kernel.alTarea(pintarTarea);

  async function lanzar(nombre: string, args: Record<string, unknown>): Promise<AvisoTarea | null> {
    try {
      mostrarInferior("tareas");
      escribir(`> ${nombre} ${JSON.stringify(args)}`, "eco");
      const { fin } = await kernel.tarea(nombre, args);
      const aviso = await fin;
      if (aviso.estado === "fallida") fallo(NOMBRES[nombre] ?? nombre, { datos: aviso.error });
      else escribir(`${NOMBRES[nombre] ?? nombre}: ${aviso.estado}`);
      return aviso;
    } catch (e) {
      fallo(nombre, e);
      return null;
    }
  }

  // ---------- acciones ----------
  async function elegir(modo: "abrir" | "guardar", tipo: TipoArchivo): Promise<string | null> {
    if (!puente) {
      escribir("Sin la app de escritorio no hay diálogos de archivo: usa la consola con una ruta absoluta.", "error");
      mostrarInferior("consola");
      return null;
    }
    return puente.elegirRuta(modo, tipo);
  }
  async function ejecutar(nombre: string, args: Record<string, unknown> = {}): Promise<unknown> {
    escribir(`> ${nombre} ${JSON.stringify(args)}`, "eco");
    try {
      const r = await kernel.comando(nombre, args);
      return r.resultado;
    } catch (e) {
      fallo(nombre, e);
      return undefined;
    }
  }
  async function importarVyba(): Promise<void> {
    const ruta = await elegir("abrir", "vyba");
    if (!ruta) return;
    const r = (await ejecutar("modelo.importar_vyba", { ruta })) as { nodos: number; barras: number; avisos: string[] } | undefined;
    if (r) escribir(`Importado: ${r.nodos} nudos, ${r.barras} barras${r.avisos.length ? `, ${r.avisos.length} avisos (panel derecho)` : ""}.`);
  }
  async function abrirVybs(): Promise<void> {
    const ruta = await elegir("abrir", "vybs");
    if (ruta) await ejecutar("modelo.abrir_vybs", { ruta });
  }
  async function guardarVybs(como: boolean): Promise<void> {
    const args: Record<string, unknown> = {};
    if (como || !resumen?.archivo || resumen.archivo.solo_lectura) {
      const ruta = await elegir("guardar", "vybs");
      if (!ruta) return;
      args.ruta = ruta;
    }
    const r = (await ejecutar("modelo.guardar_vybs", args)) as { ruta: string } | undefined;
    if (r) {
      escribir(`Guardado en ${r.ruta}`);
      await refrescar();
    }
  }
  async function guardarVybres(): Promise<void> {
    const ruta = await elegir("guardar", "vybres");
    if (!ruta) return;
    const a = await lanzar("resultados.guardar_vybres", { ruta });
    if (a?.estado === "terminada") escribir(`Resultados guardados en ${(a.resultado as { ruta: string }).ruta}`);
  }
  async function transaccion(cual: "deshacer" | "rehacer"): Promise<void> {
    try {
      const r = (await kernel.cliente.solicitar(`transaccion.${cual}`)) as { transaccion: string | null };
      if (r.transaccion === null) escribir(`Nada que ${cual}.`);
    } catch (e) {
      fallo(cual, e);
    }
  }
  async function analizarEstatico(): Promise<void> {
    const args = await asistenteEstatico(resumen?.casos ?? []);
    if (!args) return;
    const a = await lanzar("analisis.estatico", args);
    if (a?.estado !== "terminada") return;
    const r = a.resultado as { casos: { caso: string; desplazamiento_maximo: { valor: number; nodo: string } }[]; metadatos: { segundos: number; resolvedor: string } };
    for (const c of r.casos) escribir(`  ${c.caso}: desplazamiento máximo ${mostrar(c.desplazamiento_maximo.valor, "mm")} en ${c.desplazamiento_maximo.nodo}`);
    escribir(`  ${numero(r.metadatos.segundos)} s · ${r.metadatos.resolvedor}`);
    await refrescar();
    mostrarPestana("Resultados");
    if (selectorEstado.options.length) {
      selectorEstado.value = r.casos[0]?.caso ?? selectorEstado.options[0].value;
      await verDeformada();
    }
  }
  async function analizarModal(): Promise<void> {
    const args = await asistenteModal();
    if (!args) return;
    const a = await lanzar("analisis.modal", args);
    if (a?.estado !== "terminada") return;
    const r = a.resultado as { frecuencias: number[]; certificado: boolean; avisos: string[] };
    escribir(`  ${r.frecuencias.length} modos: ${r.frecuencias.slice(0, 6).map((f) => `${numero(f)} Hz`).join(", ")}${r.frecuencias.length > 6 ? "…" : ""}`);
    escribir(`  certificado (Sturm y error regresivo): ${r.certificado ? "sí" : "no"}`, r.certificado ? "" : "error");
    for (const av of r.avisos) escribir(`  ${av}`);
    await refrescar();
    mostrarPestana("Resultados");
    if (selectorModo.options.length) {
      selectorModo.value = "1";
      await verModo();
    }
  }
  async function verificacion(): Promise<void> {
    const a = await lanzar("verificacion.ejecutar", {});
    if (a?.estado !== "terminada") return;
    const r = a.resultado as { casos: number; comprobaciones: number; fallos: number; valido: boolean; tabla: string };
    zonaVerificacion.replaceChildren(
      h("p", { class: "barra-tabla" }, h("span", { class: `etiqueta ${r.valido ? "ok" : "mal"}` }, r.valido ? "todo cumple" : `${r.fallos} fallos`),
        `${r.casos} casos · ${r.comprobaciones} comprobaciones (solución de referencia y tolerancia declaradas antes de ejecutar)`),
      h("pre", { class: "consola-salida" }, r.tabla));
    mostrarInferior("verificacion");
  }

  // ---------- consola ----------
  const historial: string[] = [];
  let posicion = 0;
  entrada.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && posicion > 0) entrada.value = historial[--posicion];
    else if (e.key === "ArrowDown" && posicion < historial.length) entrada.value = historial[++posicion] ?? "";
    else if (e.key === "Enter") {
      const texto = entrada.value.trim();
      entrada.value = "";
      if (texto) {
        historial.push(texto);
        posicion = historial.length;
        void orden(texto);
      }
    }
  });
  async function orden(texto: string): Promise<void> {
    if (texto === "ayuda") {
      const comandos = (await kernel.cliente.solicitar("comando.listar")) as { nombre: string; descripcion: string }[];
      escribir("Comandos del modelo (comando.ejecutar):");
      for (const c of comandos) escribir(`  ${c.nombre} — ${c.descripcion}`);
      escribir(`Tareas (tarea.iniciar): ${[...nombresTareas].join(", ")}`);
      escribir("Métodos directos: resultados.geometria, resultados.tabla {\"tabla\": …}, sistema.version, tarea.activas…");
      return;
    }
    const espacio = texto.search(/\s/);
    const nombre = espacio < 0 ? texto : texto.slice(0, espacio);
    let args: Record<string, unknown> = {};
    if (espacio >= 0) {
      try {
        args = JSON.parse(texto.slice(espacio + 1));
      } catch {
        escribir(`${nombre}: los argumentos deben ser un objeto JSON`, "error");
        return;
      }
    }
    if (nombresTareas.has(nombre)) {
      const a = await lanzar(nombre, args);
      if (a?.resultado !== undefined) escribir(JSON.stringify(a.resultado, null, 1).slice(0, 4000));
      if (a?.estado === "terminada" && nombre.startsWith("analisis.")) await refrescar();
      return;
    }
    const directo = /^(sistema|resultados|tarea|transaccion|comando)\./.test(nombre);
    escribir(`> ${texto}`, "eco");
    try {
      const r = directo ? await kernel.cliente.solicitar(nombre, args, { tiempoEsperaMs: 180_000 }) : (await kernel.comando(nombre, args)).resultado;
      escribir(JSON.stringify(r, null, 1).slice(0, 4000));
    } catch (e) {
      fallo(nombre, e);
    }
  }

  // ---------- visor ----------
  o.cargarVisor()
    .then((modulo) => modulo.montar(contenedorVisor, {
      alElegir: (e) => {
        seleccion = e;
        pintarPropiedades();
      },
    }))
    .then((v) => {
      visor = v;
      aplicarTema();
      if (geometria) v.fijarGeometria(geometria);
      actualizarBotones();
    })
    .catch((e) => {
      avisoVisor.hidden = false;
      avisoVisor.className = "aviso-visor error";
      avisoVisor.textContent = `No se pudo iniciar el visor 3D: ${textoError(e)}`;
    });

  pintarNavegador();
  pintarPropiedades();
  actualizarBotones();
  escribir("COVILLAF SIMULATE · escribe «ayuda» para ver los comandos y tareas del kernel.");
}
