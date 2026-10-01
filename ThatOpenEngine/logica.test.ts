// Asistentes (formulario → argumentos de la tarea) y formato de números y unidades.
import assert from "node:assert/strict";
import { test } from "node:test";
import { argumentosEstatico, argumentosModal } from "../src/asistentes-logica.ts";
import { factorPantalla, mostrar, numero, porcentaje, sigmaDeFrecuencia } from "../src/formato.ts";

test("estático: todos los casos marcados ⇒ sin «casos»; algunos ⇒ la lista; ninguno ⇒ error", () => {
  const base = { todos: ["D", "L"], deformacionCortante: true, resolvedor: "auto" as const };
  assert.deepEqual(argumentosEstatico({ ...base, casos: ["D", "L"] }), { args: { deformacion_cortante: true }, errores: [] });
  assert.deepEqual(argumentosEstatico({ ...base, casos: ["L"], resolvedor: "pardiso" }).args, { deformacion_cortante: true, casos: ["L"], resolvedor: "pardiso" });
  assert.equal(argumentosEstatico({ ...base, casos: [] }).errores.length, 1);
  assert.equal(argumentosEstatico({ ...base, todos: [], casos: [] }).errores.length, 1);
});

test("modal: número de modos, frecuencia central en Hz → σ = (2πf)² y errores", () => {
  const base = { masa: "consistente" as const, deformacionCortante: true, sturm: true, resolvedor: "auto" as const };
  const a = argumentosModal({ ...base, modos: "6", centroHz: "" });
  assert.deepEqual(a, { args: { n_modos: 6, masa: "consistente", deformacion_cortante: true, sturm: true }, errores: [] });
  const b = argumentosModal({ ...base, modos: "4", centroHz: "2,5" });
  assert.ok(Math.abs((b.args.desplazamiento as number) - (2 * Math.PI * 2.5) ** 2) < 1e-9);
  for (const malo of ["0", "1001", "3.5", "abc", ""]) assert.equal(argumentosModal({ ...base, modos: malo, centroHz: "" }).errores.length, 1, malo);
  for (const malo of ["-1", "0", "x"]) assert.equal(argumentosModal({ ...base, modos: "3", centroHz: malo }).errores.length, 1, malo);
});

test("formato: kN y kN·m con la unidad siempre visible", () => {
  assert.equal(mostrar(12345, "N"), "12,35 kN");
  assert.equal(mostrar(2.5e6, "N.mm"), "2,5 kN·m");
  assert.equal(mostrar(3.2, "mm"), "3,2 mm");
  assert.equal(mostrar(null, "mm"), "— mm");
  assert.equal(factorPantalla("N·mm"), 1e-6);
  assert.equal(numero(0), "0");
  assert.match(numero(1.5e-5), /E/);
  assert.equal(porcentaje(null), "…");
  assert.equal(porcentaje(0.426), "43 %");
  assert.ok(Math.abs(sigmaDeFrecuencia(1) - 4 * Math.PI ** 2) < 1e-12);
});
