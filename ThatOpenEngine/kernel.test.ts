// KernelSimulate con un cliente falso: tramas emparejadas por lote (lleguen antes o después), tareas y progreso.
import assert from "node:assert/strict";
import { test } from "node:test";
import { KernelSimulate, loteDeTrama, type ClienteRpc } from "../src/kernel.ts";

class ClienteFalso implements ClienteRpc {
  oyentes = new Map<string, ((p: unknown, m: string) => void)[]>();
  binarios: ((d: ArrayBuffer) => void)[] = [];
  respuestas = new Map<string, (params: unknown) => unknown>();
  llamadas: { metodo: string; params: unknown; opciones?: { tiempoEsperaMs?: number } }[] = [];
  conectar = async () => {};
  reconectar = async () => {};
  async solicitar(metodo: string, params?: unknown, opciones?: { tiempoEsperaMs?: number }): Promise<unknown> {
    this.llamadas.push({ metodo, params, opciones });
    const r = this.respuestas.get(metodo);
    if (!r) throw new Error(`sin respuesta para ${metodo}`);
    return r(params);
  }
  suscribir(metodo: string, fn: (p: unknown, m: string) => void): () => void {
    this.oyentes.set(metodo, [...(this.oyentes.get(metodo) ?? []), fn]);
    return () => {};
  }
  alBinario(fn: (d: ArrayBuffer) => void): () => void {
    this.binarios.push(fn);
    return () => {};
  }
  notificar(metodo: string, params: unknown): void {
    for (const fn of this.oyentes.get(metodo) ?? []) fn(params, metodo);
  }
  binario(d: ArrayBuffer): void {
    for (const fn of this.binarios) fn(d);
  }
}

function trama(lote: number, relleno = 0): ArrayBuffer {
  const b = new ArrayBuffer(64);
  const v = new DataView(b);
  v.setUint32(8, lote, true);
  v.setUint32(60, relleno, true);
  return b;
}

test("loteDeTrama lee los bytes 8–11 en little-endian", () => {
  assert.equal(loteDeTrama(trama(0x01020304)), 0x01020304);
  assert.equal(loteDeTrama(new ArrayBuffer(8)), null);
});

test("campo: la trama que llega detrás se empareja por su lote, no por el orden", async () => {
  const c = new ClienteFalso();
  const k = new KernelSimulate(c);
  c.respuestas.set("resultados.campo", (p) => {
    const lote = (p as { estado: string }).estado === "A" ? 7 : 8;
    queueMicrotask(() => setTimeout(() => c.binario(trama(lote, lote * 10)), 0));
    return { lote };
  });
  const [a, b] = await Promise.all([
    k.campo({ tipo: "estatico", magnitud: "desplazamiento", estado: "A" }),
    k.campo({ tipo: "estatico", magnitud: "desplazamiento", estado: "B" }),
  ]);
  assert.equal(new DataView(a.trama).getUint32(60, true), 70);
  assert.equal(new DataView(b.trama).getUint32(60, true), 80);
  assert.ok((c.llamadas[0].opciones?.tiempoEsperaMs ?? 0) >= 60_000, "tiempo de espera largo para los campos");
});

test("campo: una trama que llegó antes de pedirla se guarda y se entrega", async () => {
  const c = new ClienteFalso();
  const k = new KernelSimulate(c);
  c.binario(trama(42, 1));
  c.respuestas.set("resultados.campo", () => ({ lote: 42 }));
  const { trama: t } = await k.campo({ tipo: "modal", magnitud: "forma", modo: 1 });
  assert.equal(new DataView(t).getUint32(60, true), 1);
});

test("tarea: progreso, cancelando y aviso final", async () => {
  const c = new ClienteFalso();
  const k = new KernelSimulate(c);
  const vistos: string[] = [];
  k.alTarea((t) => vistos.push(`${t.estado}:${t.fraccion}`));
  c.respuestas.set("tarea.iniciar", () => ({ id: "T1" }));
  c.respuestas.set("tarea.cancelar", () => ({ id: "T1", estado: "cancelando" }));
  const { id, fin } = await k.tarea("analisis.modal", { n_modos: 3 });
  assert.equal(id, "T1");
  c.notificar("tarea.progreso", { id, texto: "preparar las barras", fraccion: 0.1 });
  assert.equal(k.activas.length, 1);
  k.marcarCancelando(id);
  c.notificar("tarea.progreso", { id, texto: "ensamblar", fraccion: 0.2 });
  assert.equal(k.activas[0].estado, "cancelando", "un aviso de progreso no deshace el «cancelando»");
  c.notificar("tarea.terminada", { id, nombre: "analisis.modal", estado: "cancelada" });
  const aviso = await fin;
  assert.equal(aviso.estado, "cancelada");
  assert.equal(k.activas.length, 0);
  assert.deepEqual(vistos, ["en_cola:null", "en_curso:0.1", "cancelando:0.1", "cancelando:0.2", "cancelada:0.2"]);
});

test("tarea: el aviso final que llega antes de esperar también se entrega", async () => {
  const c = new ClienteFalso();
  const k = new KernelSimulate(c);
  c.respuestas.set("tarea.iniciar", () => {
    queueMicrotask(() => c.notificar("tarea.terminada", { id: "T2", nombre: "x.y", estado: "terminada", resultado: { ok: 1 } }));
    return { id: "T2" };
  });
  const { fin } = await k.tarea("x.y");
  assert.deepEqual((await fin).resultado, { ok: 1 });
});

test("al reconectar, las tareas que el kernel ya no tiene vivas se cierran y el fin llega (M2)", async () => {
  const c = new ClienteFalso();
  const k = new KernelSimulate(c);
  let n = 0;
  c.respuestas.set("tarea.iniciar", () => ({ id: `T${++n}` }));
  const a = await k.tarea("analisis.estatico");
  const b = await k.tarea("analisis.modal");
  c.notificar("tarea.progreso", { id: a.id, texto: "factorizar", fraccion: 0.4 });
  // kernel relanzado: no conoce ninguna; el primero lo recuerda terminado (misma sesión del kernel), el segundo no
  c.respuestas.set("tarea.activas", () => []);
  c.respuestas.set("tarea.estado", (p) => {
    if ((p as { id: string }).id === "T1") return { id: "T1", nombre: "analisis.estatico", estado: "terminada", resultado: { ok: 1 } };
    throw new Error("tarea desconocida");
  });
  const esperando = k.campo({ tipo: "modal", magnitud: "forma", modo: 1 }).catch((e: Error) => e.message);
  c.respuestas.set("resultados.campo", () => ({ lote: 5 }));
  await k.recuperarTareas();
  assert.equal((await a.fin).estado, "terminada");
  const fb = await b.fin;
  assert.equal(fb.estado, "fallida");
  assert.equal(fb.error?.clave, "perdida");
  assert.equal(k.activas.length, 0);
  void esperando;
});

test("al reconectar se descartan las tramas del kernel anterior (B2: los lotes vuelven a empezar)", async () => {
  const c = new ClienteFalso();
  const k = new KernelSimulate(c);
  c.binario(trama(1, 111)); // sin reclamar, del kernel anterior
  c.respuestas.set("tarea.activas", () => []);
  await k.recuperarTareas();
  c.respuestas.set("resultados.campo", () => {
    setTimeout(() => c.binario(trama(1, 222)), 0);
    return { lote: 1 };
  });
  const { trama: t } = await k.campo({ tipo: "estatico", magnitud: "desplazamiento", estado: "D" });
  assert.equal(new DataView(t).getUint32(60, true), 222);
});

test("recuperarTareas registra las activas del kernel", async () => {
  const c = new ClienteFalso();
  const k = new KernelSimulate(c);
  c.respuestas.set("tarea.activas", () => [{ id: "T3", nombre: "analisis.estatico", estado: "en_curso", texto: "factorizar", fraccion: 0.4 }]);
  await k.recuperarTareas();
  assert.equal(k.activas[0].texto, "factorizar");
});

