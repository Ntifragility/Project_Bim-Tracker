// Pruebas de seguridad de la app de escritorio de SIMULATE (apps/desktop/seguridad.mjs): origen app://covillaf-simulate,
// CSP (la de DESIGN por ruta, sin su excepción del resolvedor), archivos, navegación y permisos.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import {
  ESQUEMA,
  HOST_APP,
  ORIGEN_APP,
  PERMISOS_PERMITIDOS,
  cabecerasSeguridad,
  origenDesarrollo,
  permisoPermitido,
  politicaCsp,
  resolverRecurso,
  tipoMime,
  urlPermitida,
} from "../seguridad.mjs";

describe("origen propio", () => {
  test("app://covillaf-simulate (el único Origin fijo que acepta el kernel de SIMULATE)", () => {
    assert.equal(ESQUEMA, "app");
    assert.equal(HOST_APP, "covillaf-simulate");
    assert.equal(ORIGEN_APP, "app://covillaf-simulate");
    // (en Node un esquema no especial tiene origin "null"; en Electron, registrado como estándar, es app://covillaf-simulate:
    // lo comprueba la prueba de humo con location.origin)
    assert.equal(new URL(`${ORIGEN_APP}/index.html`).host, "covillaf-simulate");
  });
});

describe("CSP", () => {
  const csp = politicaCsp();
  const directivas = new Map(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([nombre, ...valores]) => [nombre, valores]));

  test("directivas básicas cerradas", () => {
    assert.deepEqual(directivas.get("default-src"), ["'self'"]);
    assert.deepEqual(directivas.get("object-src"), ["'none'"]);
    assert.deepEqual(directivas.get("base-uri"), ["'none'"]);
    assert.deepEqual(directivas.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(directivas.get("form-action"), ["'none'"]);
  });

  test("sin orígenes remotos ni https:, sin 'unsafe-eval': solo 'self', blob:, data: y el kernel en ws://127.0.0.1", () => {
    for (const [nombre, valores] of directivas) {
      for (const v of valores) {
        const permitido = v.startsWith("'") || v === "blob:" || v === "data:" || v === "ws://127.0.0.1:*";
        assert.ok(permitido, `${nombre}: ${v}`);
      }
    }
    assert.ok(!csp.includes("https:"), csp);
    assert.ok(!csp.includes("'unsafe-eval'"), csp);
    assert.ok(!/http:|\*\.|\s\*(\s|;|$)/.test(csp), csp);
    assert.ok(directivas.get("connect-src")?.includes("ws://127.0.0.1:*"));
    assert.deepEqual(directivas.get("frame-src"), ["'none'"], "SIMULATE no usa marcos (auditoría 6fc4e37, B7)");
    assert.ok(!directivas.get("script-src")?.includes("'unsafe-inline'"));
  });

  test("la misma CSP para todas las rutas: la excepción de DESIGN para /resolvedor.html no existe aquí", () => {
    const c = cabecerasSeguridad();
    assert.equal(c["Content-Security-Policy"], csp);
    assert.equal(c["X-Content-Type-Options"], "nosniff");
    assert.equal(c["Referrer-Policy"], "no-referrer");
    assert.equal(politicaCsp.length, 0, "politicaCsp() no recibe la ruta");
    assert.ok(!politicaCsp().includes("'unsafe-eval'"));
  });
});

describe("archivos de la interfaz (app://covillaf-simulate)", () => {
  const base = path.resolve("D:/ui/dist");
  const casos: [string, string | null][] = [
    ["/", path.join(base, "index.html")],
    ["/index.html", path.join(base, "index.html")],
    ["/assets/index-abc.js", path.join(base, "assets", "index-abc.js")],
    ["/marca/covillaf%20simulate.png", path.join(base, "marca", "covillaf simulate.png")],
    ["/../secreto.txt", null],
    ["/%2e%2e/secreto.txt", null],
    ["/assets/../../secreto.txt", null],
    ["/..%5c..%5cWindows%5cwin.ini", null],
    ["/C:/Windows/win.ini", null],
    ["/a%00b", null],
    ["/%E0%A4%A", null],
  ];
  for (const [pathname, esperado] of casos) {
    test(`«${pathname}» → ${esperado === null ? "rechazado" : path.relative(base, esperado)}`, () => {
      assert.equal(resolverRecurso(base, pathname), esperado);
    });
  }

  test("tipos MIME", () => {
    assert.equal(tipoMime("a/index.html"), "text/html; charset=utf-8");
    assert.equal(tipoMime("x.JS"), "text/javascript; charset=utf-8");
    assert.equal(tipoMime("x.wasm"), "application/wasm");
    assert.equal(tipoMime("x.exe"), "application/octet-stream");
  });
});

describe("navegación y permisos", () => {
  test("urlPermitida: app://covillaf-simulate sí; app://covillaf (DESIGN) no", () => {
    assert.equal(urlPermitida(`${ORIGEN_APP}/index.html`), true);
    assert.equal(urlPermitida("app://covillaf-simulate/"), true);
    assert.equal(urlPermitida("app://covillaf/index.html"), false, "el origen de DESIGN no pasa");
    assert.equal(urlPermitida("app://covillaf-simulate.evil/"), false);
    assert.equal(urlPermitida("app://otro/index.html"), false);
    assert.equal(urlPermitida("https://example.com/"), false);
    assert.equal(urlPermitida("http://127.0.0.1:5184/"), false, "sin modo desarrollo");
    assert.equal(urlPermitida("http://127.0.0.1:5184/", "http://127.0.0.1:5184"), true);
    assert.equal(urlPermitida("http://127.0.0.1:9999/", "http://127.0.0.1:5184"), false);
    assert.equal(urlPermitida("file:///C:/Windows/"), false);
    assert.equal(urlPermitida("javascript:alert(1)"), false);
    assert.equal(urlPermitida("no es una url"), false);
    assert.equal(urlPermitida(undefined), false);
    assert.equal(urlPermitida(null), false);
  });

  test("origenDesarrollo: solo http en el bucle local con puerto, normalizado sin «/» final", () => {
    assert.equal(origenDesarrollo("http://127.0.0.1:5184/"), "http://127.0.0.1:5184");
    assert.equal(origenDesarrollo("http://localhost:5184"), "http://localhost:5184");
    assert.equal(origenDesarrollo("http://192.168.1.10:5184"), null);
    assert.equal(origenDesarrollo("https://127.0.0.1:5184"), null);
    assert.equal(origenDesarrollo("http://127.0.0.1"), null);
    assert.equal(origenDesarrollo(undefined), null);
  });

  test("permisos: solo la lista corta y solo para app://covillaf-simulate", () => {
    for (const p of PERMISOS_PERMITIDOS) {
      assert.equal(permisoPermitido(p, "app://covillaf-simulate/index.html"), true, p);
      assert.equal(permisoPermitido(p, "app://covillaf/index.html"), false, `${p} para el origen de DESIGN`);
    }
    for (const p of ["media", "geolocation", "notifications", "clipboard-read", "openExternal", "hid", "usb", "serial"]) {
      assert.equal(permisoPermitido(p, "app://covillaf-simulate/index.html"), false, p);
    }
    assert.equal(permisoPermitido("fullscreen", "https://example.com"), false);
    assert.equal(permisoPermitido("fullscreen", "http://127.0.0.1:5184/", "http://127.0.0.1:5184"), true);
  });
});
