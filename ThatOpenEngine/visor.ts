// Adaptador del visor para la aplicación (VisorApp): el visor de COVILLAF 3D por alias con la capa de resultados de
// @covillaf-simulate/viewer. Las tramas VYBF se decodifican aquí (y se validan contra la geometría cargada en la capa); la
// escala de la interfaz es relativa a la automática de cada campo. Es un trozo aparte (three + That Open): main.ts lo
// carga con import() después de dibujar la interfaz.
import { decodificarVybf, validarGeometria, valorVybf, type TramaVybf } from "@covillaf-simulate/viewer";
import { montarVisor } from "@covillaf-simulate/viewer/covillaf3d";
import type { GeometriaJson, ModuloVisor, VisorApp } from "./aplicacion.ts";

export async function montar(contenedor: HTMLElement, oyentes: Parameters<ModuloVisor["montar"]>[1]): Promise<VisorApp> {
  const control = await montarVisor(contenedor, { alElegir: (e) => oyentes.alElegir(e) });
  const capa = control.capa;
  let trama: TramaVybf | null = null;
  let escalaAutomatica = 1;

  const mostrado = (t: TramaVybf) => {
    trama = t;
    escalaAutomatica = capa.escala;
  };

  return {
    fijarGeometria(g: GeometriaJson) {
      capa.fijarGeometria(validarGeometria(g));
      trama = null;
    },
    vaciarResultados() {
      // sin modelo (o sin geometría): la capa entera; las reacciones exigen geometría cargada
      capa.vaciar();
      trama = null;
    },
    mostrarDeformada(datos) {
      const t = decodificarVybf(datos);
      capa.mostrarReacciones([]);
      capa.mostrarDeformada(t);
      mostrado(t);
    },
    mostrarDiagrama(datos, componente) {
      const t = decodificarVybf(datos);
      capa.mostrarReacciones([]);
      capa.mostrarDiagrama(t, componente as 0 | 1 | 2 | 3 | 4 | 5);
      mostrado(t);
    },
    animarModo(datos) {
      const t = decodificarVybf(datos);
      capa.mostrarReacciones([]);
      capa.animarModo(t);
      mostrado(t);
    },
    mostrarReacciones(r) {
      capa.quitarResultado();
      trama = null;
      capa.mostrarReacciones(r);
    },
    fijarEscalaRelativa(factor) {
      if (trama) capa.fijarEscala(escalaAutomatica * factor);
    },
    valorEn(estacion) {
      const t = trama;
      if (!t || estacion < 0 || estacion >= t.nValores) return null;
      return Array.from({ length: t.componentes }, (_, k) => valorVybf(t, 0, estacion, k));
    },
    encuadrar: () => control.encuadrar(),
    vista: (v) => control.vista(v),
    fijarTema: (oscuro) => control.fijarTema(oscuro),
    dispose: () => control.dispose(),
  };
}
