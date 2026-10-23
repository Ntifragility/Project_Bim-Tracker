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
    resolveId(id, importer) {
      if (id.includes("viewport_core.wasm")) {
        const cleanPath = id.replace(/\?url$/, "");
        const targetPath = path.resolve(path.dirname(importer || __dirname), cleanPath);
        if (!fs.existsSync(targetPath)) {
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
