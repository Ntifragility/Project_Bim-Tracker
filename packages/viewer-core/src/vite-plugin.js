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

function findProjectFile(relPath, startDir = process.cwd()) {
  let curr = path.resolve(startDir);
  while (true) {
    const candidate = path.join(curr, relPath);
    if (fs.existsSync(candidate)) return { filePath: candidate, rootDir: curr };
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
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

      const jobs = new Map();

      server.middlewares.use("/covillaf/convert-frag", (req, res, next) => {
        req.setTimeout(0);
        res.setTimeout(0);
        const urlObj = new URL(req.url || "/", "http://localhost");
        const subRoute = urlObj.pathname.replace(/^\/+/, "");

        const jsonRes = (code, payload) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        };

        if (req.method === "POST" && subRoute === "init") {
          const rawName = path.basename(urlObj.searchParams.get("name") || "model.ifc");
          const expectedSize = Number(urlObj.searchParams.get("size") || 0);
          const safeBase = rawName.replace(/\.ifc$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "model";
          const found = findProjectFile(path.join("scripts", "convert-ifc-to-frag.mjs"), projectRoot)
            || findProjectFile(path.join("scripts", "convert-ifc-to-frag.mjs"), process.cwd());
          if (!found) return jsonRes(500, { error: "convert-ifc-to-frag.mjs not found" });

          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const cacheDir = path.join(found.rootDir, ".cache", "frag");
          const cachedFrag = path.join(cacheDir, `${safeBase}.frag`);
          const metaPath = `${cachedFrag}.meta.json`;

          // Instant cache hit if .cache/frag/<model>.frag already exists and size matches (or no conflicting meta)
          if (fs.existsSync(cachedFrag)) {
            let sizeMatch = true;
            if (expectedSize > 0 && fs.existsSync(metaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
                if (meta.inputSize && meta.inputSize !== expectedSize) sizeMatch = false;
              } catch { /* ignore */ }
            }
            if (sizeMatch) {
              jobs.set(id, {
                id,
                safeBase,
                tempFrag: cachedFrag,
                cachedFrag,
                keepCache: true,
                status: "done",
                progress: 1,
                detail: "Loaded from local .frag cache",
                error: null,
              });
              return jsonRes(200, { id, cached: true });
            }
          }

          const tempIfc = path.join(os.tmpdir(), `${safeBase}-${id}.ifc`);
          const tempFrag = path.join(os.tmpdir(), `${safeBase}-${id}.frag`);
          fs.writeFileSync(tempIfc, Buffer.alloc(0));

          jobs.set(id, {
            id,
            safeBase,
            expectedSize,
            converterScript: found.filePath,
            repoRoot: found.rootDir,
            tempIfc,
            tempFrag,
            cacheDir,
            cachedFrag,
            metaPath,
            keepCache: false,
            bytesReceived: 0,
            status: "uploading",
            progress: 0,
            detail: "Receiving IFC chunks...",
            error: null,
          });
          return jsonRes(200, { id, cached: false });
        }

        if (req.method === "POST" && subRoute === "chunk") {
          const id = urlObj.searchParams.get("id");
          const job = jobs.get(id);
          if (!job) return jsonRes(404, { error: "Unknown conversion job id" });

          const ws = fs.createWriteStream(job.tempIfc, { flags: "a" });
          req.on("data", (chunk) => { job.bytesReceived += chunk.length; });
          req.pipe(ws);
          ws.on("finish", () => jsonRes(200, { ok: true, bytesReceived: job.bytesReceived }));
          ws.on("error", (err) => {
            try { if (fs.existsSync(job.tempIfc)) fs.unlinkSync(job.tempIfc); } catch { /* noop */ }
            jobs.delete(id);
            jsonRes(500, { error: `Chunk write failed: ${err.message}` });
          });
          return;
        }

        if (req.method === "POST" && subRoute === "start") {
          const id = urlObj.searchParams.get("id");
          const job = jobs.get(id);
          if (!job) return jsonRes(404, { error: "Unknown conversion job id" });

          job.status = "converting";
          job.progress = 0.05;
          job.detail = "Running 64-bit web-ifc -> .frag compiler...";

          const child = spawn(
            process.execPath,
            ["--max-old-space-size=12288", job.converterScript, job.tempIfc, job.tempFrag],
            { cwd: job.repoRoot, stdio: ["ignore", "pipe", "pipe"] },
          );
          let stderr = "";
          child.stdout.on("data", (chunk) => {
            const text = String(chunk);
            const m = text.match(/(\d+)%/);
            if (m) {
              const pct = Math.min(99, Math.max(5, Number(m[1])));
              job.progress = pct / 100;
              job.detail = `Compiling .frag geometry (${pct}%)...`;
            }
          });
          child.stderr.on("data", (chunk) => { stderr += String(chunk); });
          child.on("close", (code) => {
            try { if (fs.existsSync(job.tempIfc)) fs.unlinkSync(job.tempIfc); } catch { /* noop */ }
            if (code !== 0 || !fs.existsSync(job.tempFrag)) {
              job.status = "error";
              job.error = stderr.trim() || `Converter exited with code ${code}`;
              return;
            }
            try {
              fs.mkdirSync(job.cacheDir, { recursive: true });
              fs.copyFileSync(job.tempFrag, job.cachedFrag);
              if (job.metaPath) {
                fs.writeFileSync(job.metaPath, JSON.stringify({
                  inputSize: job.expectedSize || job.bytesReceived,
                  outputBytes: fs.statSync(job.cachedFrag).size,
                }));
              }
            } catch { /* non-fatal */ }
            job.status = "done";
            job.progress = 1;
            job.detail = "Compiled .frag ready";
          });
          return jsonRes(200, { ok: true, id });
        }

        if (req.method === "GET" && subRoute === "status") {
          const id = urlObj.searchParams.get("id");
          const job = jobs.get(id);
          if (!job) return jsonRes(404, { error: "Unknown conversion job id" });
          return jsonRes(200, {
            status: job.status,
            progress: job.progress,
            detail: job.detail,
            cachePath: job.cachedFrag,
            error: job.error,
          });
        }

        if (req.method === "GET" && subRoute === "result") {
          const id = urlObj.searchParams.get("id");
          const job = jobs.get(id);
          if (!job || job.status !== "done" || !fs.existsSync(job.tempFrag)) {
            return jsonRes(404, { error: "Compiled .frag not ready" });
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("X-Frag-Cache-Path", job.cachedFrag);
          const rs = fs.createReadStream(job.tempFrag);
          const cleanup = () => {
            if (!job.keepCache) {
              try { if (fs.existsSync(job.tempFrag)) fs.unlinkSync(job.tempFrag); } catch { /* noop */ }
            }
            jobs.delete(id);
          };
          rs.on("close", cleanup);
          rs.on("error", cleanup);
          rs.pipe(res);
          return;
        }

        return next();
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
