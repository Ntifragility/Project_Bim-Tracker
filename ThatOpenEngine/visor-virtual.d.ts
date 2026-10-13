// Módulo del visor (src/visor.ts por alias de Vite). Se declara aquí para que la comprobación de tipos de la raíz no
// siga el import hasta las fuentes de COVILLAF 3D; esas se comprueban con packages/ui/tsconfig.covillaf3d.json.
declare module "virtual:covillaf-simulate/visor" {
  import type { ModuloVisor } from "./aplicacion.ts";
  export const montar: ModuloVisor["montar"];
}
