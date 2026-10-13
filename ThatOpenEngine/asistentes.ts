// Asistentes de análisis (diálogos): piden lo mínimo con valores por defecto sensatos, explican cada opción con su
// unidad y devuelven los argumentos de la tarea (asistentes-logica.ts), o null si se cancela.
import { argumentosEstatico, argumentosModal, type Argumentos, type Resolvedor } from "./asistentes-logica.ts";
import { h } from "./dom.ts";

function dialogo(titulo: string, ayuda: string, cuerpo: HTMLElement[], leer: () => Argumentos, textoAceptar: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolver) => {
    const errores = h("ul", { class: "errores", role: "alert" });
    const aceptar = h("button", { type: "submit", class: "boton primario" }, textoAceptar);
    const cancelar = h("button", { type: "button", class: "boton" }, "Cancelar");
    const formulario = h("form", { method: "dialog" }, h("h2", {}, titulo), h("p", { class: "ayuda" }, ayuda), ...cuerpo, errores,
      h("div", { class: "acciones" }, cancelar, aceptar));
    const d = h("dialog", { class: "asistente", "aria-label": titulo }, formulario);
    let resultado: Record<string, unknown> | null = null;
    const comprobar = (): Argumentos => {
      const a = leer();
      errores.replaceChildren(...a.errores.map((e) => h("li", {}, e)));
      aceptar.disabled = a.errores.length > 0;
      return a;
    };
    formulario.addEventListener("input", comprobar);
    formulario.addEventListener("change", comprobar);
    formulario.addEventListener("submit", (e) => {
      const a = comprobar();
      if (a.errores.length) {
        e.preventDefault();
        return;
      }
      resultado = a.args;
    });
    cancelar.addEventListener("click", () => d.close());
    d.addEventListener("close", () => {
      d.remove();
      resolver(resultado);
    });
    document.body.append(d);
    comprobar();
    d.showModal();
  });
}

function casilla(nombre: string, texto: string, marcada: boolean, titulo = ""): HTMLLabelElement {
  return h("label", { title: titulo }, h("input", { type: "checkbox", name: nombre, checked: marcada }), " ", texto);
}

function selectorResolvedor(): HTMLElement {
  return h("label", { class: "fila" }, "Sistema lineal",
    h("select", { name: "resolvedor", title: "auto: SuperLU por debajo de 5 000 GDL y MKL PARDISO desde ahí (F0-27)" },
      h("option", { value: "auto" }, "Automático"), h("option", { value: "superlu" }, "SuperLU"), h("option", { value: "pardiso" }, "MKL PARDISO")));
}

function valor(f: HTMLElement, nombre: string): string {
  return (f.querySelector(`[name="${nombre}"]`) as HTMLInputElement | HTMLSelectElement).value;
}

function marcada(f: HTMLElement, nombre: string): boolean {
  return (f.querySelector(`[name="${nombre}"]`) as HTMLInputElement).checked;
}

/** Asistente del estático lineal: casos a resolver, deformación por cortante y sistema lineal. */
export function asistenteEstatico(casos: readonly string[]): Promise<Record<string, unknown> | null> {
  const lista = h("div", { class: "casos" }, ...casos.map((c) => h("label", {}, h("input", { type: "checkbox", name: "caso", value: c, checked: true }), " ", c)));
  const cuerpo = h("div", {},
    h("fieldset", {}, h("legend", {}, `Casos de carga (${casos.length})`), casos.length ? lista : h("p", { class: "ayuda" }, "El modelo no tiene casos.")),
    h("fieldset", {}, h("legend", {}, "Opciones"),
      casilla("cortante", "Deformación por cortante (Timoshenko)", true, "Con las áreas a cortante de las secciones; sin ella, Euler-Bernoulli"),
      selectorResolvedor()));
  const leer = (): Argumentos =>
    argumentosEstatico({
      casos: [...cuerpo.querySelectorAll<HTMLInputElement>('input[name="caso"]:checked')].map((e) => e.value),
      todos: casos,
      deformacionCortante: marcada(cuerpo, "cortante"),
      resolvedor: valor(cuerpo, "resolvedor") as Resolvedor,
    });
  return dialogo("Análisis estático lineal",
    "Resuelve K·u = F para cada caso sobre una sola factorización. Las combinaciones lineales se forman al consultar los resultados.",
    [cuerpo], leer, "Analizar");
}

/** Asistente del modal: número de modos, tipo de masa, frecuencia central opcional, Sturm y sistema lineal. */
export function asistenteModal(): Promise<Record<string, unknown> | null> {
  const cuerpo = h("div", {},
    h("fieldset", {}, h("legend", {}, "Modos"),
      h("label", { class: "fila" }, "Número de modos", h("input", { type: "text", name: "modos", value: "12", inputmode: "numeric", size: 6 })),
      h("label", { class: "fila", title: "Vacío: los primeros modos. Con un valor: los más próximos a esa frecuencia" }, "Frecuencia central (Hz, opcional)",
        h("input", { type: "text", name: "centro", value: "", inputmode: "decimal", placeholder: "primeros modos", size: 10 })),
      h("label", { class: "fila" }, "Masa",
        h("select", { name: "masa" }, h("option", { value: "consistente" }, "Consistente"), h("option", { value: "concentrada" }, "Concentrada en los nudos")))),
    h("fieldset", {}, h("legend", {}, "Opciones"),
      casilla("sturm", "Certificado de Sturm (comprueba que no falta ningún modo)", true, "Una factorización más; recomendado"),
      casilla("cortante", "Deformación por cortante (Timoshenko)", true),
      selectorResolvedor()));
  const leer = (): Argumentos =>
    argumentosModal({
      modos: valor(cuerpo, "modos"),
      centroHz: valor(cuerpo, "centro"),
      masa: valor(cuerpo, "masa") as "consistente" | "concentrada",
      sturm: marcada(cuerpo, "sturm"),
      deformacionCortante: marcada(cuerpo, "cortante"),
      resolvedor: valor(cuerpo, "resolvedor") as Resolvedor,
    });
  return dialogo("Análisis modal",
    "Frecuencias, formas normalizadas a masa unidad, masas participativas y error regresivo de cada modo. La masa sale de la fuente de masa del modelo.",
    [cuerpo], leer, "Analizar");
}
