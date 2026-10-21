import fs from "node:fs";
import path from "node:path";

const WEB_IFC_FILES = [
  "web-ifc.wasm",
  "web-ifc-mt.wasm",
  "web-ifc-api.js",
  "web-ifc-api-iife.js",
];

function findNodeModulesDir(subPath, startDir = process.cwd()) {
  let curr = path.resolve(startDir);
  while (true) {
    const candidate = path.join(curr, "node_modules", subPath);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(startDir, "node_modules", subPath);
}

export function copyCovillafAssets(outDir, startDir = process.cwd()) {
  const webIfcDir = findNodeModulesDir("web-ifc", startDir);
  const fragmentsWorker = findNodeModulesDir("@thatopen/fragments/dist/Worker/worker.mjs", startDir);
  const wasmDest = path.join(outDir, "covillaf", "web-ifc");
  const workerDest = path.join(outDir, "covillaf", "fragments");

  fs.mkdirSync(wasmDest, { recursive: true });
  fs.mkdirSync(workerDest, { recursive: true });

  for (const name of WEB_IFC_FILES) {
    const src = path.join(webIfcDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(wasmDest, name));
    }
  }

  if (fs.existsSync(fragmentsWorker)) {
    fs.copyFileSync(fragmentsWorker, path.join(workerDest, "worker.mjs"));
  }
}

export function covillafWebIfc(options = {}) {
  let resolvedOutDir = path.resolve("dist");
  let projectRoot = process.cwd();

  return {
    name: "covillaf-web-ifc",
    configResolved(config) {
      projectRoot = config.root || process.cwd();
      resolvedOutDir = path.resolve(projectRoot, config.build.outDir || "dist");
    },
    configureServer(server) {
      const webIfcDir = findNodeModulesDir("web-ifc", projectRoot);
      const fragmentsWorker = findNodeModulesDir("@thatopen/fragments/dist/Worker/worker.mjs", projectRoot);

      server.middlewares.use("/covillaf/web-ifc", (req, res, next) => {
        const name = path.basename(String(req.url || "").split("?")[0]);
        const file = path.join(webIfcDir, name);
        if (!WEB_IFC_FILES.includes(name) || !fs.existsSync(file)) return next();
        if (name.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        fs.createReadStream(file).pipe(res);
      });

      server.middlewares.use("/covillaf/fragments/worker.mjs", (_req, res, next) => {
        if (!fs.existsSync(fragmentsWorker)) return next();
        res.setHeader("Content-Type", "text/javascript");
        fs.createReadStream(fragmentsWorker).pipe(res);
      });
    },
    closeBundle() {
      copyCovillafAssets(resolvedOutDir, projectRoot);
      const rootDist = path.resolve(process.cwd(), "dist");
      if (rootDist !== resolvedOutDir) {
        copyCovillafAssets(rootDist, process.cwd());
      }
    },
  };
}

export const viewerCoreWebIfc = covillafWebIfc;
export default covillafWebIfc;
