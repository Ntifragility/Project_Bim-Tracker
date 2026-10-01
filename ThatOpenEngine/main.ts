// Arranque de la interfaz de COVILLAF SIMULATE: puente con la app de escritorio, cliente del kernel (el ClienteKernel de
// COVILLAF DESIGN, por alias: vite.config.ts) y la aplicación. El visor se carga aparte (trozo grande: three + That Open),
// después de que la interfaz ya esté dibujada y conectada.
import { ClienteKernel, type EstadoConexion } from "@covillaf-design/ui/protocolo";
import { montarAplicacion } from "./aplicacion.ts";
import "./estilos.css";
import { KernelSimulate } from "./kernel.ts";
import { puenteEscritorio } from "./puente.ts";

const raiz = document.getElementById("app");
if (!raiz) throw new Error("falta #app en index.html");

const puente = puenteEscritorio();
const cliente = new ClienteKernel({
  credenciales: () =>
    puente ? puente.kernel() : Promise.reject(new Error("sin la app de escritorio: abre COVILLAF SIMULATE con «COVILLAF SIMULATE.bat»")),
  cliente: `covillaf-simulate-ui/${puente?.version ?? "navegador"}`,
});
const kernel = new KernelSimulate(cliente);

const oyentes = new Set<(texto: string, fase: "listo" | "espera" | "error") => void>();
function avisar(texto: string, fase: "listo" | "espera" | "error"): void {
  for (const fn of oyentes) fn(texto, fase);
}
let ultimo: [string, "listo" | "espera" | "error"] = ["Conectando con el kernel…", "espera"];

function textoConexion(e: EstadoConexion): [string, "listo" | "espera" | "error"] {
  switch (e.fase) {
    case "conectado":
      return [`Kernel ${e.kernel} · protocolo ${e.protocolo}`, "listo"];
    case "conectando":
    case "autenticando":
    case "inactivo":
      return ["Conectando con el kernel…", "espera"];
    case "reconectando":
      return [`Reconectando con el kernel (intento ${e.intento})…`, "espera"];
    case "desconectado":
      return [e.motivo, e.definitivo ? "error" : "espera"];
  }
}

cliente.alEstado((e) => {
  ultimo = textoConexion(e);
  avisar(...ultimo);
});

if (puente) {
  // El kernel lo lanza y vigila el proceso principal; si se relanza, el cliente pide credenciales nuevas.
  let listoAntes = false;
  const alKernel = (e: Awaited<ReturnType<typeof puente.estadoKernel>>) => {
    if (e.fase === "error") avisar(`Kernel: ${e.mensaje}`, "error");
    else if (e.fase === "arrancando" || e.fase === "reiniciando") avisar("Arrancando el kernel…", "espera");
    if (e.fase === "listo") {
      if (listoAntes) void cliente.reconectar().catch(() => undefined);
      listoAntes = true;
    }
  };
  puente.alCambiarKernel(alKernel);
  void puente.estadoKernel().then(alKernel);
}

montarAplicacion(raiz, {
  kernel,
  puente,
  cargarVisor: () => import("virtual:covillaf-simulate/visor"),
  alEstadoConexion: (fn) => {
    oyentes.add(fn);
    fn(...ultimo);
  },
});

void cliente.conectar().catch(() => undefined); // el estado (y su motivo) llega por alEstado
