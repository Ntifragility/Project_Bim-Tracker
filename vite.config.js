import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['web-ifc', '@thatopen/components', '@thatopen/fragments', '@thatopen/components-front']
  }
});
