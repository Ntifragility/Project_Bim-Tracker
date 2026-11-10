import { defineConfig } from "vite";
import { covillafWebIfc } from "viewer-core/vite-plugin";

export default defineConfig({
  plugins: [covillafWebIfc()],
  optimizeDeps: {
    exclude: ["web-ifc", "@thatopen/components", "@thatopen/fragments", "@thatopen/components-front"],
  },
});
