import { defineConfig } from "vite";
import { covillafWebIfc } from "viewer-core/vite-plugin";

export default defineConfig({
  base: process.env.VITE_APP_BASE || "/",
  plugins: [covillafWebIfc()],
  optimizeDeps: {
    include: ["xlsx"],
    exclude: ["web-ifc", "@thatopen/components", "@thatopen/fragments", "@thatopen/components-front"],
  },
});
