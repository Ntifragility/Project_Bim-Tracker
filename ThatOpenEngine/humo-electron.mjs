// @ts-check
// Prueba de humo de la app de escritorio de COVILLAF SIMULATE: abre Electron en modo pruebas (perfil temporal,
// COVILLAF_SIMULATE_PRUEBAS=1, --remote-debugging-port=0), se conecta por el protocolo de DevTools (CDP) y comprueba que
// la página app://covillaf-simulate/ carga, que el puente window.covillafSimulate existe y no expone Node, que hay CSP, que
// window.open está bloqueado, que el kernel real llega a «listo» y que la PÁGINA se autentica con él (su WebSocket
// lleva Origin app://covillaf-simulate), que no hay errores de consola; guarda una captura y cierra la app comprobando que
// no queda ningún proceso vivo (Electron, sus hijos, el lanzador del kernel y el kernel).
//
//   node apps/desktop/test/humo-electron.mjs                   con la interfaz compilada (packages/ui/dist)
//   node apps/desktop/test/humo-electron.mjs --ui-minima       con una página mínima generada en la carpeta temporal
//                                                              (prueba el armazón sin la interfaz: protocolo, CSP,
//                                                              puente, kernel, cierre)
//   opciones: --capturas <carpeta> (por defecto %TEMP%\covillaf-simulate-humo) · --eco (muestra el registro de la app)
//             · --sin-kernel-roto (salta el escenario del kernel que no arranca)
//
// No es un *.test.ts: no entra en «npm test» (abre ventanas). Sale con 0 si todo va bien, 1 si algo falla y 2 si falta
// la interfaz compilada.
//
// GANCHO PARA ESCENARIOS DE INTERFAZ: ver la sección «Escenarios de interfaz» (ESCENARIOS_INTERFAZ) más abajo. Cada
// escenario recibe la app lanzada (con el kernel real listo) y `comprobar`; se ejecutan en orden antes del cierre.
// Este archivo también se puede importar (exporta lanzar, comprobar, comprobarCierre…): principal() solo corre
// cuando se ejecuta directamente.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ESCRITORIO = path.resolve(DIR, "..");
const RAIZ = path.resolve(ESCRITORIO, "..", "..");
const args = process.argv.slice(2);
const ECO = args.includes("--eco");
const iCapturas = args.indexOf("--capturas");
const CAPTURAS = path.resolve(iCapturas >= 0 && args[iCapturas + 1] ? args[iCapturas + 1] : path.join(os.tmpdir(), "covillaf-simulate-humo"));
export const ORIGEN = "app://covillaf-simulate";
/** Texto del console.error deliberado que comprueba que los errores de consola llegan al registro. */
const SONDA_CONSOLA = "covillaf-simulate-sonda-consola";

/** @param {number} ms */
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {{ escenario: string, nombre: string, ok: boolean, detalle: string }[]} */
export const resultados = [];
/**
 * @param {string} escenario
 * @param {string} nombre
 * @param {unknown} ok
 * @param {string} [detalle]
 */
export function comprobar(escenario, nombre, ok, detalle = "") {
  resultados.push({ escenario, nombre, ok: Boolean(ok), detalle });
  console.log(`  ${ok ? "✔" : "✖"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

// ---------------------------------------------------------------------------------------------
// Cliente CDP mínimo (WebSocket global de Node)
// ---------------------------------------------------------------------------------------------
/** @param {string} url */
async function conectarCdp(url) {
  const ws = new WebSocket(url);
  await new Promise((resolver, rechazar) => {
    ws.addEventListener("open", resolver, { once: true });
    ws.addEventListener("error", () => rechazar(new Error(`No se pudo conectar por CDP a ${url}`)), { once: true });
  });
  let siguiente = 1;
  /** @type {Map<number, { resolver: (v: any) => void, rechazar: (e: Error) => void, metodo: string }>} */
  const pendientes = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id === undefined) return;
    const p = pendientes.get(m.id);
    if (!p) return;
    pendientes.delete(m.id);
    if (m.error) p.rechazar(new Error(`${p.metodo}: ${m.error.message}`));
    else p.resolver(m.result ?? {});
  });
  ws.addEventListener("close", () => {
    for (const p of pendientes.values()) p.rechazar(new Error(`${p.metodo}: CDP cerrado`));
    pendientes.clear();
  });
  /**
   * @param {string} metodo
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<any>}
   */
  const enviar = (metodo, params = {}) =>
    new Promise((resolver, rechazar) => {
      const id = siguiente++;
      pendientes.set(id, { resolver, rechazar, metodo });
      ws.send(JSON.stringify({ id, method: metodo, params }));
    });
  /** @param {string} expresion @returns {Promise<any>} */
  const evaluar = async (expresion) => {
    const r = await enviar("Runtime.evaluate", { expression: expresion, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  /** @param {string} expresion @param {number} [ms] @returns {Promise<any>} */
  const esperar = async (expresion, ms = 30_000) => {
    const fin = Date.now() + ms;
    /** @type {Error | null} */
    let ultimo = null;
    for (;;) {
      try {
        const v = await evaluar(expresion);
        if (v) return v;
      } catch (e) {
        ultimo = /** @type {Error} */ (e);
      }
      if (Date.now() > fin) throw new Error(`Tiempo agotado esperando: ${expresion}${ultimo ? ` (${ultimo.message})` : ""}`);
      await espera(200);
    }
  };
  /** @param {string} nombre */
  const captura = async (nombre) => {
    const { data } = await enviar("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(CAPTURAS, { recursive: true });
    const ruta = path.join(CAPTURAS, nombre);
    fs.writeFileSync(ruta, Buffer.from(data, "base64"));
    return ruta;
  };
  return { enviar, evaluar, esperar, captura, cerrar: () => ws.close() };
}

// ---------------------------------------------------------------------------------------------
// Procesos (Windows): árbol de la app para comprobar que no queda nada vivo al cerrar
// ---------------------------------------------------------------------------------------------
/** @param {number | undefined} pid */
function matarArbol(pid) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ya no existe */
    }
  }
}

/** @param {number} pid */
function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Procesos descendientes de `raiz` (incluida). Solo en Windows (en otros sistemas, []).
 * @param {number | undefined} raiz
 * @returns {{ pid: number, nombre: string }[]}
 */
function arbolProcesos(raiz) {
  if (process.platform !== "win32" || !raiz) return [];
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  /** @type {{ ProcessId: number, ParentProcessId: number, Name: string }[]} */
  let lista = [];
  try {
    lista = JSON.parse(r.stdout);
  } catch {
    return [];
  }
  const salida = [];
  const vistos = new Set();
  const cola = lista.filter((p) => p.ProcessId === raiz);
  while (cola.length) {
    const p = /** @type {(typeof lista)[number]} */ (cola.shift());
    if (vistos.has(p.ProcessId)) continue;
    vistos.add(p.ProcessId);
    salida.push({ pid: p.ProcessId, nombre: p.Name });
    cola.push(...lista.filter((q) => q.ParentProcessId === p.ProcessId));
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------
// Lanzar y cerrar la app
// ---------------------------------------------------------------------------------------------
/**
 * Lanza la app en modo pruebas con un perfil temporal y se conecta a su página por CDP.
 * @param {Record<string, string>} entorno variables extra (COVILLAF_SIMULATE_UI, COVILLAF_SIMULATE_KERNEL_MODULO…)
 */
export async function lanzar(entorno = {}) {
  const electron = /** @type {string} */ (createRequire(import.meta.url)("electron"));
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "covillaf-simulate-humo-perfil-"));
  // PYTHONDONTWRITEBYTECODE: ni .pyc del kernel ni de los paquetes de DESIGN que importa por ruta
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", COVILLAF_SIMULATE_PRUEBAS: "1", COVILLAF_SIMULATE_PERFIL: perfil, COVILLAF_SIMULATE_VENTANA: "1440x900", ...entorno };
  delete env.ELECTRON_RUN_AS_NODE;
  const proceso = spawn(electron, [ESCRITORIO, "--remote-debugging-port=0"], { env, stdio: ["ignore", "pipe", "pipe"] });
  /** @type {string[]} */
  const lineas = [];
  /** @param {unknown} t */
  const alTexto = (t) => {
    for (const l of String(t).split(/\r?\n/)) {
      if (!l.trim()) continue;
      lineas.push(l);
      if (ECO) console.log(`    [app] ${l}`);
    }
  };
  proceso.stdout.on("data", alTexto);
  proceso.stderr.on("data", alTexto);
  /** @type {number | null} */
  let salida = null;
  proceso.once("exit", (codigo) => (salida = codigo ?? -1));
  const fin = Date.now() + 60_000;
  let puertoCdp = 0;
  while (!puertoCdp) {
    if (salida !== null) throw new Error(`La app terminó al arrancar (código ${salida}):\n${lineas.slice(-20).join("\n")}`);
    if (Date.now() > fin) throw new Error("Tiempo agotado esperando el puerto de DevTools");
    try {
      const n = Number(fs.readFileSync(path.join(perfil, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]);
      if (n > 0) puertoCdp = n;
    } catch {
      await espera(150);
    }
  }
  /** @type {{ url: string, webSocketDebuggerUrl: string } | null} */
  let pagina = null;
  while (!pagina) {
    if (salida !== null) throw new Error(`La app terminó al arrancar (código ${salida}):\n${lineas.slice(-20).join("\n")}`);
    if (Date.now() > fin) throw new Error(`Tiempo agotado esperando la página ${ORIGEN}/`);
    try {
      /** @type {{ type: string, url: string, webSocketDebuggerUrl: string }[]} */
      const lista = await (await fetch(`http://127.0.0.1:${puertoCdp}/json/list`)).json();
      pagina = lista.find((t) => t.type === "page" && String(t.url).startsWith(`${ORIGEN}/`)) ?? null;
    } catch {
      /* aún no responde */
    }
    if (!pagina) await espera(150);
  }
  const cdp = await conectarCdp(pagina.webSocketDebuggerUrl);
  await cdp.enviar("Runtime.enable");
  await cdp.enviar("Page.enable");

  async function cerrar() {
    // el árbol de procesos antes de cerrar (Electron, sus hijos, el lanzador del kernel y el kernel)
    const arbol = arbolProcesos(proceso.pid);
    // cierre ordenado: se cierra la ventana → la app detiene el kernel y termina
    try {
      await cdp.evaluar("setTimeout(() => window.close(), 50), true");
    } catch {
      /* la página ya no responde */
    }
    cdp.cerrar();
    const t = Date.now() + 15_000;
    while (salida === null && Date.now() < t) await espera(100);
    const ordenado = salida !== null;
    if (!ordenado) matarArbol(proceso.pid);
    let restantes = arbol.filter((p) => vivo(p.pid));
    for (let i = 0; i < 30 && restantes.length; i++) {
      await espera(100);
      restantes = restantes.filter((p) => vivo(p.pid));
    }
    fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return { ordenado, codigo: salida, arbol, restantes };
  }
  return { cdp, lineas, cerrar, pagina, proceso };
}

/** @typedef {Awaited<ReturnType<typeof lanzar>>} AppLanzada */

/** Errores de consola de la página (los registra el proceso principal en modo pruebas). @param {AppLanzada} app */
export function erroresConsola(app) {
  return app.lineas.filter((l) => l.includes("[página:error]"));
}

/**
 * @param {string} e
 * @param {Awaited<ReturnType<AppLanzada["cerrar"]>>} c
 */
export function comprobarCierre(e, c) {
  comprobar(e, "cierre ordenado de la app", c.ordenado, `código ${c.codigo}`);
  const nombres = [...new Set(c.arbol.map((p) => p.nombre))].join(", ");
  comprobar(
    e,
    "ningún proceso huérfano (Electron, sus hijos y el kernel)",
    process.platform !== "win32" || (c.arbol.length > 0 && c.restantes.length === 0),
    process.platform !== "win32" ? "solo se comprueba en Windows" : `${c.arbol.length} procesos antes de cerrar (${nombres}); vivos después: ${c.restantes.map((p) => `${p.nombre} ${p.pid}`).join(", ") || "ninguno"}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Comprobaciones del armazón (independientes de la interfaz)
// ---------------------------------------------------------------------------------------------
/** @param {string} e @param {AppLanzada} app */
export async function comprobarArmazon(e, app) {
  const { cdp } = app;
  // la lista de CDP puede dar ya la URL de la app mientras el documento es aún about:blank: se espera al origen propio
  await cdp.esperar(`location.origin === '${ORIGEN}' && document.readyState === 'complete'`, 20_000);
  const r = await cdp.evaluar(`(() => ({
    origen: location.origin,
    url: location.href,
    puente: typeof window.covillafSimulate === 'object' && window.covillafSimulate !== null && window.covillafSimulate.escritorio === true,
    funciones: ['kernel','estadoKernel','alCambiarKernel','reiniciarKernel','elegirRuta','info','titulo'].filter((f) => typeof window.covillafSimulate?.[f] !== 'function'),
    version: window.covillafSimulate?.version,
    diagnostico: window.covillafSimulate?.diagnostico,
    sinNode: typeof window.require === 'undefined' && typeof window.process === 'undefined' && typeof window.module === 'undefined' && typeof window.Buffer === 'undefined',
    sinDesign: typeof window.covillafDesign === 'undefined',
  }))()`);
  comprobar(e, `la página ${ORIGEN}/ carga (location.origin = ${ORIGEN})`, r.origen === ORIGEN, `${r.url}`);
  comprobar(e, "puente window.covillafSimulate con sus 7 funciones (y sin window.covillafDesign)", r.puente && r.funciones.length === 0 && r.sinDesign, `versión ${r.version} · diagnóstico ${r.diagnostico}${r.funciones.length ? ` · faltan ${r.funciones.join(", ")}` : ""}`);
  comprobar(e, "la página no ve Node (require, process, module, Buffer)", r.sinNode);
  const csp = await cdp.evaluar(`fetch('${ORIGEN}/index.html').then(r => r.headers.get('content-security-policy'))`);
  comprobar(e, `cabecera CSP en las respuestas de ${ORIGEN}`, typeof csp === "string" && csp.includes("connect-src 'self' blob: data: ws://127.0.0.1:*") && !csp.includes("'unsafe-eval'"), csp ? `${csp.slice(0, 70)}…` : "sin cabecera");
  const fuera = await cdp.evaluar(`fetch('${ORIGEN}/..%5c..%5c..%5cWindows%5cwin.ini').then(r => r.status, (e) => 'error ' + e.message)`);
  comprobar(e, "el protocolo no sirve archivos fuera de la interfaz (../)", fuera === 404 || String(fuera).startsWith("error"), `respuesta ${fuera}`);
  const abierta = await cdp.evaluar("window.open('https://example.com') === null");
  comprobar(e, "window.open a un sitio externo bloqueado", abierta === true && app.lineas.some((l) => l.includes("[seguridad] window.open bloqueado")));
  const info = await cdp.evaluar("window.covillafSimulate.info()");
  comprobar(e, "info(): versiones de la app, Electron, Chromium y Node", info?.nombre === "COVILLAF SIMULATE" && Boolean(info.version && info.electron && info.chrome && info.node) && typeof info.kernel?.fase === "string", `${info?.nombre} ${info?.version} · Electron ${info?.electron} · Chromium ${info?.chrome} · Node ${info?.node} · kernel ${info?.kernel?.fase} · DESIGN ${info?.design?.huella}`);
  const titulo = await cdp.evaluar("window.covillafSimulate.titulo('COVILLAF SIMULATE — humo').then(() => 'ok', (e) => e.message)");
  const tituloMalo = await cdp.evaluar("window.covillafSimulate.titulo('   ').then(() => 'aceptado', (e) => e.message)");
  comprobar(e, "titulo(): acepta un texto y rechaza uno vacío", titulo === "ok" && tituloMalo === "Título no válido.", `${titulo} · vacío: ${tituloMalo}`);
  const ruta = await cdp.evaluar("window.covillafSimulate.elegirRuta('borrar', 'vybs').then(() => 'aceptada', (e) => e.message)");
  comprobar(e, "elegirRuta(): una petición no válida se rechaza sin abrir ventana", ruta === "Petición no válida.", ruta);
  const familia = app.lineas.find((l) => l.includes("[familia]")) ?? "";
  comprobar(e, "módulos de COVILLAF DESIGN cargados por ruta antes de «ready» y con la huella esperada", /huella coincide/.test(familia) && /antes de ready/.test(familia), familia.replace(/^\S+ /, ""));
}

// ---------------------------------------------------------------------------------------------
// Escenarios de interfaz (GANCHO para el orquestador)
// ---------------------------------------------------------------------------------------------
// Cada escenario: { nombre, requiereInterfaz, ejecutar(app, e) }. Se ejecutan en orden en el escenario «kernel real»,
// después de las comprobaciones del armazón y del kernel y antes del cierre. `requiereInterfaz: true` los salta con
// --ui-minima. Usar `comprobar(e, nombre, ok, detalle)` para cada comprobación y `app.cdp` (evaluar, esperar, captura,
// enviar) para mover la página. Ejemplos por añadir: abrir un .vybs sintético (coordenadas EPSG:32755, E 520 000 ·
// N 8 100 000 · H 100), lanzar analisis.estatico, ver la deformada en el visor.
/** @typedef {{ nombre: string, requiereInterfaz: boolean, ejecutar: (app: AppLanzada, e: string) => Promise<void> }} EscenarioInterfaz */
/** @type {EscenarioInterfaz[]} */
export const ESCENARIOS_INTERFAZ = [
  { nombre: "abrir el PR-01 sintético, analizar y ver los resultados en el visor", requiereInterfaz: true, ejecutar: escenarioResultados },
];

/**
 * .vybs del PR-01a sintético (tests/fixtures/pr01.py: coordenadas de ejemplo EPSG:32755) escrito con el Python del
 * proyecto en una carpeta temporal. @returns {string}
 */
function vybsSintetico() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "covillaf-simulate-humo-modelo-"));
  const ruta = path.join(carpeta, "pr01a.vybs");
  const codigo = [
    "import importlib.util, sys",
    "e = importlib.util.spec_from_file_location('pr01_humo', r'" + path.join(RAIZ, "tests", "fixtures", "pr01.py") + "')",
    "m = importlib.util.module_from_spec(e); e.loader.exec_module(m)",
    "from covillaf.sim.io import escribir_vybs",
    "s = {'fecha': '2026-09-24T12:00:00Z', 'autor': 'humo', 'aplicacion': 'COVILLAF SIMULATE (pruebas)'}",
    "escribir_vybs(sys.argv[1], m.pr01('a'), guid='2Pc61mKOzJ4uF_OilAct2b', nombre='PR-01a', creado=s)",
  ].join("\n");
  const python = path.join(RAIZ, ".venv", "Scripts", "python.exe");
  const r = spawnSync(python, ["-c", codigo, ruta], { cwd: RAIZ, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  if (r.status !== 0) throw new Error(`no se pudo escribir el .vybs sintético: ${r.stderr}`);
  return ruta;
}

/** @param {AppLanzada} app @param {string} e */
async function escenarioResultados(app, e) {
  const ruta = vybsSintetico();
  try {
    await recorridoResultados(app, e, ruta);
  } finally {
    fs.rmSync(path.dirname(ruta), { recursive: true, force: true }); // su carpeta temporal (auditoría 6fc4e37, B5)
  }
}

/** @param {AppLanzada} app @param {string} e @param {string} ruta */
async function recorridoResultados(app, e, ruta) {
  const { cdp } = app;
  await cdp.esperar("document.querySelector('.estado')?.textContent.includes('Kernel 0.1.0')", 60_000);
  comprobar(e, "la interfaz se conecta con el kernel", true, await cdp.evaluar("document.querySelector('.estado').textContent"));
  const orden = async (/** @type {string} */ texto) =>
    cdp.evaluar(`(() => { document.querySelector('.inferior-pestanas [data-id=consola]').click();
      const i = document.querySelector('.consola input'); i.value = ${JSON.stringify(texto)};
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return true; })()`);
  const pestana = (/** @type {string} */ nombre) => cdp.evaluar(`(() => { [...document.querySelectorAll('.pestana')].find((b) => b.textContent === ${JSON.stringify(nombre)})?.click(); return true; })()`);
  const pulsar = (/** @type {string} */ accion) => cdp.evaluar(`(() => { const b = document.querySelector('[data-accion=${accion}]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  const leyenda = () => cdp.evaluar("(() => { const l = document.querySelector('.leyenda'); return l && !l.hidden ? l.textContent : ''; })()");

  await orden(`modelo.abrir_vybs ${JSON.stringify({ ruta })}`);
  const ficha = await cdp.esperar("(() => { const t = document.querySelector('aside.panel')?.textContent ?? ''; return t.includes('PR-01a') && t; })()", 60_000);
  comprobar(e, "modelo.abrir_vybs desde la consola: el navegador muestra el PR-01a", /Barras\s*64/.test(ficha), ficha.slice(0, 120));
  comprobar(e, "el visor de COVILLAF 3D tiene su lienzo WebGL", await cdp.esperar("!!document.querySelector('#visor canvas')", 60_000));

  await orden("analisis.estatico {}");
  await pestana("Resultados");
  await cdp.esperar("(() => { const b = document.querySelector('[data-accion=deformada]'); return b && !b.disabled; })()", 120_000);
  comprobar(e, "analisis.estatico termina y habilita los resultados", true);
  comprobar(e, "la tarea aparece terminada en el panel de tareas", await cdp.evaluar(`(() => { document.querySelector('.inferior-pestanas [data-id=tareas]').click();
    return [...document.querySelectorAll('.tarea')].some((t) => t.textContent.includes('Análisis estático · terminada')); })()`));
  comprobar(e, "botón Deformada", await pulsar("deformada"));
  const deformada = await cdp.esperar("(() => { const l = document.querySelector('.leyenda'); return l && !l.hidden && l.textContent.includes('Deformada') && l.textContent; })()", 60_000);
  comprobar(e, "la deformada se dibuja con su leyenda (desplazamiento máximo en mm)", /mm/.test(deformada), deformada);
  console.log(`  captura: ${await cdp.captura("escritorio-deformada.png")}`);
  comprobar(e, "botón My (diagrama de flectores)", await pulsar("diagrama_My"));
  const diagrama = await cdp.esperar("(() => { const l = document.querySelector('.leyenda'); return l && !l.hidden && l.textContent.includes('Flector My') && l.textContent; })()", 60_000);
  comprobar(e, "el diagrama My se dibuja con su rango en kN·m", /kN·m/.test(diagrama), diagrama);
  console.log(`  captura: ${await cdp.captura("escritorio-diagrama-my.png")}`);

  await orden('analisis.modal {"n_modos": 4}');
  await pestana("Resultados");
  await cdp.esperar("(() => { const b = document.querySelector('[data-accion=animar]'); return b && !b.disabled; })()", 120_000);
  comprobar(e, "botón Animar modo", await pulsar("animar"));
  const modo = await cdp.esperar("(() => { const l = document.querySelector('.leyenda'); return l && !l.hidden && l.textContent.includes('Modo 1') && l.textContent; })()", 60_000);
  comprobar(e, "el modo 1 se anima con su frecuencia en Hz", /Hz/.test(modo), modo);
  await espera(700);
  console.log(`  captura: ${await cdp.captura("escritorio-modo-1.png")}`);

  const filas = await cdp.evaluar(`(async () => { document.querySelector('.inferior-pestanas [data-id=tablas]').click();
    const s = document.querySelector('select[aria-label=Tabla]'); s.value = 'reacciones';
    [...document.querySelectorAll('.barra-tabla button')].find((b) => b.textContent === 'Mostrar').click();
    for (let i = 0; i < 100; i++) { const n = document.querySelectorAll('.tabla-datos tbody tr').length; if (n) return n; await new Promise((r) => setTimeout(r, 100)); }
    return 0; })()`);
  comprobar(e, "la tabla de reacciones tiene una fila por apoyo", filas > 0, `${filas} filas`);
  void leyenda;
}

// ---------------------------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------------------------
/** @param {Record<string, string>} entornoUi @param {boolean} minima */
async function escenarioKernelReal(entornoUi, minima) {
  const e = "kernel real";
  console.log(`\n▶ Escenario «${e}» (python -m covillaf_sim_kernel)`);
  const app = await lanzar(entornoUi);
  /** @type {number[]} */
  let pids = [];
  try {
    await comprobarArmazon(e, app);
    const { cdp } = app;
    // el kernel llega a «listo» (el puente espera a que lo esté)
    const estado = await cdp.evaluar("window.covillafSimulate.kernel().then(async (c) => ({ puerto: c.puerto, token: typeof c.token === 'string' && /^[0-9a-f]{64}$/.test(c.token), estado: await window.covillafSimulate.estadoKernel() }), (err) => ({ error: err.message }))");
    comprobar(e, "el kernel llega a «listo» y el puente da {puerto, token}", estado.estado?.fase === "listo" && estado.token === true && estado.puerto > 0, estado.error ?? `v${estado.estado?.kernel} · protocolo ${estado.estado?.protocolo} · pid ${estado.estado?.pid} · 127.0.0.1:${estado.puerto}`);
    comprobar(e, "el estado del kernel no lleva el token", estado.estado && !("token" in estado.estado));
    // la página habla con el kernel: su WebSocket lleva Origin app://covillaf-simulate (el kernel cierra con 4403 cualquier otro)
    const rpc = await cdp.evaluar(`window.covillafSimulate.kernel().then((c) => new Promise((resolver) => {
      const ws = new WebSocket('ws://127.0.0.1:' + c.puerto + '/');
      const r = {};
      const t = setTimeout(() => { ws.close(); resolver({ ...r, error: 'tiempo agotado' }); }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sesion.autenticar', params: { token: c.token, cliente: 'humo del escritorio' } }));
      ws.onclose = (ev) => { clearTimeout(t); resolver({ ...r, cierre: ev.code }); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === 1) { r.autenticar = m.result ?? m.error; ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'sistema.ping', params: { eco: 'humo' } })); }
        else if (m.id === 2) { r.ping = m.result ?? m.error; ws.close(1000); }
      };
    }))`);
    comprobar(e, `la página se autentica con el kernel (Origin ${ORIGEN}) y sistema.ping responde`, rpc.autenticar?.producto === "covillaf-simulate" && rpc.ping?.eco === "humo", JSON.stringify({ autenticar: rpc.autenticar, ping: rpc.ping, cierre: rpc.cierre, error: rpc.error }));
    // ---- escenarios de interfaz (gancho) ----
    for (const esc of ESCENARIOS_INTERFAZ) {
      if (esc.requiereInterfaz && minima) {
        console.log(`  · ${esc.nombre}: saltado (--ui-minima)`);
        continue;
      }
      console.log(`  ▷ ${esc.nombre}`);
      try {
        await esc.ejecutar(app, e);
      } catch (err) {
        comprobar(e, esc.nombre, false, err instanceof Error ? err.message : String(err));
      }
    }
    await espera(300);
    console.log(`  captura: ${await cdp.captura(`escritorio-${minima ? "ui-minima" : "interfaz"}.png`)}`);
    // control: un console.error deliberado tiene que llegar al registro (si no, «0 errores» no demostraría nada)
    await cdp.evaluar(`console.error('${SONDA_CONSOLA}'), true`);
    await espera(300);
    const sonda = app.lineas.some((l) => l.includes("[página:error]") && l.includes(SONDA_CONSOLA));
    const errores = erroresConsola(app).filter((l) => !l.includes(SONDA_CONSOLA));
    comprobar(
      e,
      "0 errores de consola en la página (la sonda deliberada sí se registra)",
      errores.length === 0 && sonda,
      errores.slice(0, 3).join(" | ") || `sonda registrada: ${sonda} · ${app.lineas.filter((l) => l.includes("[página:")).length} mensajes de consola en total`,
    );
  } finally {
    pids = app.lineas.map((l) => /\[kernel\] listo: .*· pid (\d+) ·/.exec(l)).filter((m) => m !== null).map((m) => Number(m[1]));
    const c = await app.cerrar();
    comprobarCierre(e, c);
    await espera(300);
    const vivos = pids.filter(vivo);
    comprobar(e, "el kernel se detuvo al cerrar la app", pids.length > 0 && vivos.length === 0, `pid ${pids.join(", ") || "desconocido"}${vivos.length ? ` · vivos: ${vivos.join(", ")}` : ""}`);
  }
}

/** Módulo Python inexistente: el kernel no arranca; la app sigue viva y el error llega con el final de stderr. */
/** @param {Record<string, string>} entornoUi */
async function escenarioKernelRoto(entornoUi) {
  const e = "kernel que no arranca";
  console.log(`\n▶ Escenario «${e}» (módulo Python inexistente)`);
  const app = await lanzar({ ...entornoUi, COVILLAF_SIMULATE_KERNEL_MODULO: "covillaf_sim_kernel_inexistente_humo", COVILLAF_SIMULATE_KERNEL_ESPERA_MS: "15000" });
  try {
    await app.cdp.esperar(`location.origin === '${ORIGEN}' && document.readyState === 'complete' && typeof window.covillafSimulate === 'object'`, 20_000);
    const r = await app.cdp.evaluar("window.covillafSimulate.kernel().then(() => ({ ok: true }), async (err) => ({ mensaje: err.message, estado: await window.covillafSimulate.estadoKernel() }))");
    const stderr = (r.estado?.stderr ?? []).join("\n");
    comprobar(e, "kernel() se rechaza con un mensaje claro y el final de stderr (sin colgarse)", !r.ok && r.estado?.fase === "error" && /terminó al arrancar/.test(r.mensaje) && /No module named/.test(stderr), `${r.mensaje} · ${stderr.split("\n").at(-1)}`);
    const arranques = app.lineas.filter((l) => l.includes("[kernel] arrancando")).length;
    comprobar(e, "se relanzó una sola vez", arranques === 2, `${arranques} arranques`);
    const vivo = await app.cdp.evaluar("window.covillafSimulate.info().then((i) => i.kernel.fase)");
    comprobar(e, "la página sigue respondiendo", vivo === "error", `kernel ${vivo}`);
  } finally {
    comprobarCierre(e, await app.cerrar());
  }
}

/** Página mínima (sin scripts: la CSP no admite scripts en línea) para probar el armazón sin la interfaz compilada. */
function crearUiMinima() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covillaf-simulate-ui-minima-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>COVILLAF SIMULATE · página mínima de la prueba de humo</title>
<style>body{font:16px system-ui;margin:48px;background:#e8eaed;color:#151618}h1{font-weight:600}</style></head>
<body><h1>COVILLAF SIMULATE</h1><p>Página mínima de la prueba de humo del escritorio (sin la interfaz compilada).</p></body>
</html>
`,
  );
  return dir;
}

async function principal() {
  const minima = args.includes("--ui-minima");
  /** @type {Record<string, string>} */
  const entornoUi = {};
  /** @type {string | null} */
  let dirMinima = null;
  if (minima) {
    dirMinima = crearUiMinima();
    entornoUi.COVILLAF_SIMULATE_UI = dirMinima;
    console.log(`Interfaz: página mínima en ${dirMinima}`);
  } else if (!fs.existsSync(path.join(RAIZ, "packages", "ui", "dist", "index.html"))) {
    console.error("Falta la interfaz compilada (packages/ui/dist/index.html): npm run build --workspace @covillaf-simulate/ui (o usa --ui-minima).");
    process.exit(2);
  }
  try {
    await escenarioKernelReal(entornoUi, minima);
    if (!args.includes("--sin-kernel-roto")) await escenarioKernelRoto(entornoUi);
  } finally {
    if (dirMinima) fs.rmSync(dirMinima, { recursive: true, force: true });
  }
  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\nResultado: ${resultados.length - fallos.length}/${resultados.length} comprobaciones correctas. Capturas en ${CAPTURAS}`);
  if (fallos.length) {
    for (const f of fallos) console.log(`  ✖ [${f.escenario}] ${f.nombre}: ${f.detalle}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  principal().catch((e) => {
    console.error(`\n✖ La prueba de humo falló: ${e?.stack || e}`);
    process.exit(1);
  });
}
