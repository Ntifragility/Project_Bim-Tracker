import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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

      server.middlewares.use("/covillaf/convert-frag", (req, res, next) => {
        if (req.method !== "POST") return next();
        const urlObj = new URL(req.url || "/", "http://localhost");
        const rawName = path.basename(urlObj.searchParams.get("name") || "model.ifc");
        const safeBase = rawName.replace(/\.ifc$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "model";
        const converterScript = path.resolve(projectRoot, "scripts", "convert-ifc-to-frag.mjs");
        if (!fs.existsSync(converterScript)) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "convert-ifc-to-frag.mjs not found" }));
          return;
        }

        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const tempIfc = path.join(os.tmpdir(), `${safeBase}-${stamp}.ifc`);
        const tempFrag = path.join(os.tmpdir(), `${safeBase}-${stamp}.frag`);
        const cacheDir = path.join(projectRoot, ".cache", "frag");
        const cachedFrag = path.join(cacheDir, `${safeBase}.frag`);

        const cleanup = () => {
          try { if (fs.existsSync(tempIfc)) fs.unlinkSync(tempIfc); } catch { /* noop */ }
          try { if (fs.existsSync(tempFrag)) fs.unlinkSync(tempFrag); } catch { /* noop */ }
        };

        const ws = fs.createWriteStream(tempIfc);
        req.pipe(ws);
        ws.on("error", (err) => {
          cleanup();
          res.statusCode = 500;
          res.end(JSON.stringify({ error: `Stream write failed: ${err.message}` }));
        });
        ws.on("finish", () => {
          const child = spawn(
            process.execPath,
            ["--max-old-space-size=12288", converterScript, tempIfc, tempFrag],
            { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
          );
          let stderr = "";
          child.stderr.on("data", (chunk) => { stderr += String(chunk); });
          child.on("close", (code) => {
            if (code !== 0 || !fs.existsSync(tempFrag)) {
              cleanup();
              res.statusCode = 500;
              res.end(JSON.stringify({ error: stderr || `Converter exited with code ${code}` }));
              return;
            }
            try {
              fs.mkdirSync(cacheDir, { recursive: true });
              fs.copyFileSync(tempFrag, cachedFrag);
            } catch { /* non-fatal cache copy */ }

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("X-Frag-Cache-Path", cachedFrag);
            const rs = fs.createReadStream(tempFrag);
            rs.on("close", cleanup);
            rs.on("error", cleanup);
            rs.pipe(res);
          });
        });
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
