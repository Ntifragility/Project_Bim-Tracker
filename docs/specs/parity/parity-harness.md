# parity / parity-harness: executable gate checklist (task 8.1-dry)

Status: draft | Branch: `spec/parity-harness` | Owner folders: `scripts/parity-*` (new), this file (new)

## Goal
Run the 10 checks from `docs/specs/parity/parity-gate.md` with one command and
print PASS/FAIL/SKIP per item, so the 8.1-real gate (`infra/remove-legacy`,
owner merges) is a re-run, not an investigation.

## Public interface
- `node scripts/parity-harness.mjs [--quick] [--expect-fail=<ids>] [--allow-expected]`
- `--quick`: skips `wasm-pack` and vite builds; checks manifests instead.
- Exit code 0 iff no FAIL (or only expected FAILs with `--allow-expected`).

## Rules
- R1: harness READS everything, WRITES nothing (its own files only).
- R2: no new dependencies (node builtins only).
- R3: each check maps 1:1 to a parity-gate.md row; SKIP is explicit with a reason.
- R4: never deletes `legacy/` (dry run only).

## Acceptance criteria
| Check | Expected |
|---|---|
| `node scripts/parity-harness.mjs --quick` | prints 10 `[PASS/FAIL/SKIP]` lines + summary |
| failing items pre-7.4 | check 9 SKIP (no synthetic fixture yet) is acceptable |
| full mode on green main | exit 0 |

## Out of scope
- Real deletion (`infra/remove-legacy`); browser smoke (headless: fixture presence only).
