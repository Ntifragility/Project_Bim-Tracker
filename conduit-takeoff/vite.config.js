import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { covillafWebIfc } from "viewer-core/vite-plugin";

// Resolve paths relative to the monorepo root (one level up from this config file)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function viewportWasmResolver() {
  const virtualId = "\0virtual:viewport_core.wasm";
  return {
    name: "viewport-wasm-resolver",
    // Safety net for stale absolute `/assets/...` URLs: if the built wasm is
    // missing (e.g. pre-hooks skipped), fall back to the virtual module so the
    // failure surfaces as a 404 with a clear console error instead of a
    // bundler crash. `scripts/build-viewport-wasm.mjs` normally guarantees
    // `public/assets/viewport_core.wasm` exists before dev/build.
    resolveId(id, importer) {
      if (id === "/assets/viewport_core.wasm?url" || id === "/assets/viewport_core.wasm") {
        const built = path.resolve(ROOT, "public/assets/viewport_core.wasm");
        if (!fs.existsSync(built)) {
          console.warn("[viewport-wasm-resolver] public/assets/viewport_core.wasm missing — run `npm run prebuild` or `node scripts/build-viewport-wasm.mjs`.");
          return virtualId;
        }
      }
      return null;
    },
    load(id) {
      if (id === virtualId) {
        return 'export default "/assets/viewport_core.wasm";';
      }
      return null;
    },
  };
}

export default defineConfig({
  root: ".",
  // Share the tray app's public dir (fixtures, web-ifc.wasm) so `?ifc=`
  // deep links and wasm assets resolve identically in both apps.
  publicDir: path.resolve(ROOT, "public"),
  plugins: [covillafWebIfc(), viewportWasmResolver()],
  resolve: {
    alias: {
      // Allow importing conduit-core from the packages directory
      "@conduit-core": path.resolve(ROOT, "packages/conduit-core/src"),
    },
  },
  optimizeDeps: {
    exclude: ["web-ifc", "@thatopen/components", "@thatopen/fragments", "@thatopen/components-front"],
  },
  server: {
    port: 5174, // Different port from the main app
    open: true,
    fs: {
      allow: [ROOT],
    },
  },
});
