// scripts/build-suite.mjs
// Composes both independent Vite apps into a single static `dist/` folder:
//   /       -> Conduit Takeoff (primary)
//   /tray/  -> Cable Tray Viewer (secondary)
// Zero runtime coupling; both apps remain completely independent bundles.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

function runVite(args, extraEnv = {}) {
  const res = spawnSync(npxCmd, ["vite", ...args], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

console.log("[build-suite] 1/2 Building Conduit Takeoff (/) ...");
runVite(["build", "conduit-takeoff"], { VITE_APP_BASE: "/" });

console.log("[build-suite] 2/2 Building Cable Tray Viewer (/tray/) ...");
runVite(["build", "--outDir", "dist-tray"], { VITE_APP_BASE: "/tray/" });

const distDir = path.join(ROOT, "dist");
const conduitDist = path.join(ROOT, "conduit-takeoff", "dist");
const trayDist = path.join(ROOT, "dist-tray");

fs.rmSync(distDir, { recursive: true, force: true });
fs.cpSync(conduitDist, distDir, { recursive: true });
fs.cpSync(trayDist, path.join(distDir, "tray"), { recursive: true });
fs.rmSync(trayDist, { recursive: true, force: true });

console.log("[build-suite] Suite ready in dist/ (Conduit at /, Cable Tray at /tray/).");
