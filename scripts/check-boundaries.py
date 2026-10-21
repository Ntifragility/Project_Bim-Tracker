#!/usr/bin/env python3
"""Boundary check for the BIM Tracker rewrite (ARCHITECTURE.md sections 2 and 8).

Enforces, on every PR:
  R1. Crate dependency direction is downward only (allowed edges below).
  R2. Cores (`crates/*`) are pure: no `wasm-bindgen` / `web-sys` / `js-sys`.
      Only `bindings/*` may touch the wasm bridge.
  R3. Every `path =` dependency resolves inside the repo and is allow-listed.
  R4. Tray and conduit never import each other (Rust side).
  T1. `packages/excel-io` imports nothing else from this repo (standalone plugin).
  T2. `packages/viewer-core` imports no product core, app, or plugin.
  T3. New apps never cross-import the other product line
      (`apps/tray-viewer` <-> `apps/conduit-takeoff`).
  `legacy/` is the frozen reference and is excluded from every check.

Exit 0 when all boundaries hold, 1 with a violation list otherwise.
"""
from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# --- Rust: allowed in-repo `path =` dependencies per workspace member (R1/R4) ---
ALLOWED_PATH_DEPS: dict[str, set[str]] = {
    "geom-core": set(),
    "ifc-io": {"geom-core"},
    "tray-tagging": {"geom-core", "ifc-io"},
    "tray-routing": {"geom-core"},
    "conduit-core": {"geom-core", "ifc-io"},
    "conduit-wasm": {"conduit-core"},
    "tray-wasm": {"tray-tagging", "tray-routing"},
}

# Crates that must stay pure: direct deps on these fail the check (R2).
FORBIDDEN_IN_CORES = {"wasm-bindgen", "web-sys", "js-sys"}

# name in Cargo.toml [package] -> manifest path, for workspace members only.
MEMBER_MANIFESTS = {
    **{p.parent.name: p for p in (ROOT / "crates").glob("*/Cargo.toml")},
    **{p.parent.name: p for p in (ROOT / "bindings").glob("*/Cargo.toml")},
}

# --- TypeScript: scoped import-edge rules (T1/T2/T3) ---
# Directories never scanned (frozen reference, build output, vendored code).
TS_EXCLUDE_DIRS = {"legacy", "node_modules", "dist", "target", "pkg", "archive"}
TS_EXTENSIONS = {".js", ".mjs", ".cjs", ".ts", ".tsx"}

# (owner_dir, forbidden import-path fragment, reason)
TS_RULES = [
    (
        "packages/excel-io",
        ("packages/", "apps/", "crates/", "bindings/", "src/", "conduit-takeoff/"),
        "excel-io is standalone; apps import it, never the reverse (D4)",
    ),
    (
        "packages/viewer-core",
        (
            "conduit-core",
            "routing-core",
            "conduit-takeoff",
            "tray-viewer",
            "excel-io",
            "bindings/",
        ),
        "viewer-core wraps That Open only; no product cores, apps or plugins",
    ),
    (
        "apps/tray-viewer",
        ("conduit",),
        "tray and conduit never import each other",
    ),
    (
        "apps/conduit-takeoff",
        ("packages/routing-core", "tray", "src/tagging", "src/routing", "src/ifc"),
        "tray and conduit never import each other",
    ),
]

IMPORT_RE = re.compile(r"""(?:import|export)\s[^'"]*?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)""")


def check_rust(errors: list[str]) -> None:
    manifests = {name: ROOT / ("bindings" if (ROOT / "bindings" / name / "Cargo.toml").exists()
                               else "crates") / name / "Cargo.toml"
                 for name in ALLOWED_PATH_DEPS}
    # Sanity: every allow-listed member has a manifest, and vice versa.
    on_disk = set(MEMBER_MANIFESTS)
    if set(ALLOWED_PATH_DEPS) != on_disk:
        errors.append(
            f"R0: allow-list {sorted(ALLOWED_PATH_DEPS)} != workspace members {sorted(on_disk)}; "
            "update scripts/check-boundaries.py"
        )
    for name, manifest in manifests.items():
        if not manifest.exists():
            errors.append(f"R0: missing manifest for member {name}")
            continue
        with manifest.open("rb") as f:
            data = tomllib.load(f)
        pkg_name = data.get("package", {}).get("name", name)
        deps = data.get("dependencies", {})
        is_binding = manifest.parent.parent.name == "bindings"
        for dep, spec in deps.items():
            if not isinstance(spec, dict) or "path" not in spec:
                # External crates.io dep: only purity matters (R2).
                if not is_binding and dep in FORBIDDEN_IN_CORES:
                    errors.append(
                        f"R2: core `{pkg_name}` depends on `{dep}`; "
                        "cores must not touch wasm-bindgen/web-sys/js-sys"
                    )
                continue
            target = Path(spec["path"]).name
            # Resolve the path dep to a repo member name via its manifest.
            resolved = (manifest.parent / spec["path"]).resolve()
            try:
                rel = resolved.relative_to(ROOT)
            except ValueError:
                errors.append(f"R3: `{pkg_name}` path-dep `{dep}` points outside the repo")
                continue
            target_manifest = resolved / "Cargo.toml"
            if target_manifest.exists():
                with target_manifest.open("rb") as f:
                    target = tomllib.load(f).get("package", {}).get("name", target)
            if not is_binding and dep in FORBIDDEN_IN_CORES:
                errors.append(f"R2: core `{pkg_name}` depends on `{dep}`; cores stay pure")
            if target not in ALLOWED_PATH_DEPS.get(pkg_name, set()):
                errors.append(
                    f"R1/R4: `{pkg_name}` depends on `{target}` "
                    f"(allowed: {sorted(ALLOWED_PATH_DEPS.get(pkg_name, set())) or 'none'})"
                )
        # R2 also covers renamed/forbidden crates pulled under another key.
        for dep in deps:
            if not is_binding and dep in FORBIDDEN_IN_CORES and not isinstance(deps[dep], dict):
                errors.append(f"R2: core `{pkg_name}` depends on `{dep}`; cores stay pure")


def iter_ts_files(owner: str):
    base = ROOT / owner
    if not base.exists():
        return
    for path in base.rglob("*"):
        if path.suffix not in TS_EXTENSIONS or not path.is_file():
            continue
        if any(part in TS_EXCLUDE_DIRS for part in path.relative_to(ROOT).parts):
            continue
        yield path


def check_ts(errors: list[str]) -> None:
    for owner, fragments, reason in TS_RULES:
        for path in iter_ts_files(owner):
            try:
                text = path.read_text(encoding="utf-8", errors="strict")
            except (OSError, UnicodeError):
                continue
            rel = path.relative_to(ROOT).as_posix()
            for m in IMPORT_RE.finditer(text):
                target = m.group(1) or m.group(2) or ""
                # Bare self-package and relative imports inside the owner are fine,
                # except excel-io which must not reach out of itself at all.
                if target.startswith("."):
                    if owner == "packages/excel-io" and "/../" in f"/{target}/":
                        errors.append(f"T1: `{rel}` imports `{target}`; {reason}")
                    continue
                if any(frag in target for frag in fragments):
                    errors.append(f"TS: `{rel}` imports `{target}`; {reason}")


def main() -> int:
    errors: list[str] = []
    check_rust(errors)
    check_ts(errors)
    if errors:
        print("boundary check FAILED:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("boundary check OK: Rust edges + TS import rules hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
