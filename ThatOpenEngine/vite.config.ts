// La interfaz vive en packages/ui y se compila a packages/ui/dist, que la app de escritorio sirve por
// app://covillaf-simulate/ (apps/desktop/main.mjs). Rutas relativas (base "./"). Todo local: sin CDN.
//
// Lo que se consume de los hermanos, por alias (nunca copiado; huellas en packages/viewer/covillaf3d/huella-hermanos.json
// y apps/desktop/familia.mjs):
// - el visor de COVILLAF 3D y marcos.ts de DESIGN: configuracionVisor() de @covillaf-simulate/viewer;
// - el cliente JSON-RPC del kernel de DESIGN (packages/ui/src/protocolo): «@covillaf-design/ui/protocolo».
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import { RAIZ_DESIGN, RAIZ_SIMULATE, configuracionVisor } from "../viewer/covillaf3d/vite.alias.ts";

const raiz = fileURLToPath(new URL(".", import.meta.url));
const barras = (p: string) => p.split(path.sep).join("/");
const protocoloDesign = path.join(RAIZ_DESIGN, "packages", "ui", "src");
if (!fs.existsSync(path.join(protocoloDesign, "protocolo", "index.ts"))) {
  throw new Error(`No se encuentra el cliente del kernel de COVILLAF DESIGN en «${protocoloDesign}» (carpeta hermana «07.34 COVILLAF DESIGN»).`);
}

export default defineConfig(
  mergeConfig(
    {
      root: raiz,
      base: "./",
      publicDir: "public",
      cacheDir: path.join(RAIZ_SIMULATE, "node_modules", ".vite", "ui"),
      resolve: {
        alias: [
          { find: /^@covillaf-design\/ui\/protocolo$/, replacement: barras(path.join(protocoloDesign, "protocolo", "index.ts")) },
          // el adaptador del visor: sus tipos (fuentes de COVILLAF 3D) se comprueban con tsconfig.covillaf3d.json, no en la raíz
          { find: /^virtual:covillaf-simulate\/visor$/, replacement: barras(path.join(raiz, "src", "visor.ts")) },
        ],
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        // Electron 44 = Chromium 152: sin transpilar CSS moderno (light-dark(), color-mix())
        target: "chrome140",
        cssTarget: "chrome140",
        assetsInlineLimit: 0,
        // el visor (three + That Open) es un trozo aparte de varios MB que se carga después de la interfaz
        chunkSizeWarningLimit: 8000,
      },
      // el cliente de DESIGN y lo que arrastra (sus textos) viven en su packages/ui/src
      server: { host: "127.0.0.1", port: 5184, strictPort: true, fs: { allow: [barras(protocoloDesign)] } },
      preview: { host: "127.0.0.1", port: 5185, strictPort: true },
    },
    configuracionVisor({ raizSimulate: RAIZ_SIMULATE }),
  ),
);
