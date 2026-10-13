import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const WEB_IFC_DIR = path.resolve("node_modules/web-ifc");
const FRAGMENTS_WORKER = path.resolve("node_modules/@thatopen/fragments/dist/Worker/worker.mjs");
const WEB_IFC_FILES = [
  "web-ifc.wasm",
  "web-ifc-mt.wasm",
  "web-ifc-api.js",
  "web-ifc-api-iife.js",
];

function copyCovillafAssets(outDir) {
  const wasmDest = path.join(outDir, "covillaf", "web-ifc");
  const workerDest = path.join(outDir, "covillaf", "fragments");
  fs.mkdirSync(wasmDest, { recursive: true });
  fs.mkdirSync(workerDest, { recursive: true });
  for (const name of WEB_IFC_FILES) {
    fs.copyFileSync(path.join(WEB_IFC_DIR, name), path.join(wasmDest, name));
  }
  fs.copyFileSync(FRAGMENTS_WORKER, path.join(workerDest, "worker.mjs"));
}

function covillafWebIfc() {
  return {
    name: "covillaf-web-ifc",
    configureServer(server) {
      server.middlewares.use("/covillaf/web-ifc", (req, res, next) => {
        const name = path.basename(String(req.url || "").split("?")[0]);
        const file = path.join(WEB_IFC_DIR, name);
        if (!WEB_IFC_FILES.includes(name) || !fs.existsSync(file)) return next();
        if (name.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        fs.createReadStream(file).pipe(res);
      });
      server.middlewares.use("/covillaf/fragments/worker.mjs", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        fs.createReadStream(FRAGMENTS_WORKER).pipe(res);
      });
    },
    closeBundle() {
      copyCovillafAssets(path.resolve("dist"));
    },
  };
}

export default defineConfig({
  plugins: [covillafWebIfc()],
  optimizeDeps: {
    exclude: ["web-ifc", "@thatopen/components", "@thatopen/fragments", "@thatopen/components-front"],
  },
});
