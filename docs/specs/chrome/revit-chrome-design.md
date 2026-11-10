# Universal Revit-style chrome — design

Status: draft | Branch: `spec/ribbon-chrome` | Owner decision (2026-11-10):
one shared feature used by both modules; Revit-faithful; ribbon owns commands.

## Goal

Replace the per-app dark-glass tab shells with one shared, Revit-faithful
ribbon framework. Both apps (tray viewer + conduit takeoff) consume it; each
module supplies its own command adapters. Light ribbon chrome, dark viewport
canvas (option B, decided: light chrome + dark canvas, no full dark theme).

Non-goal: no behaviour change in Rust cores, wasm bindings, geometry, or
`viewer-core`. Chrome-only rewrite of the two ribbon shells.

## Package: `packages/ribbon-chrome/`

Framework only. Zero product logic. Zero imports from apps, cores, bindings,
`viewer-core`, or `excel-io`. May import shared SVG sprite + design tokens
it ships itself.

### Public interface

```ts
createRibbon(host: HTMLElement, def: RibbonDef, ctx: Ctx): RibbonApi
```

```ts
type RibbonDef = {
  appId: 'tray' | 'conduit';
  tabs: RibbonTab[];            // fixed tabs
  contextual: ContextualTab[];  // selection/tool-driven, hidden by default
  qat: CommandRef[];            // quick-access toolbar (save/undo/redo)
};
type RibbonTab = { id: string; label: string; groups: RibbonGroup[] };
type RibbonGroup = {
  id: string; label: string;                    // caption bar text
  launcher?: { tooltip: string; run(ctx): void }; // dialog launcher ↗
  big: Command[];     // 32px stacked icon + wrapped label
  small: Command[][]; // rows of 16px icon + label, max 3 rows
};
type Command = {
  id: string; label: string; icon: IconName; size: 'big' | 'small';
  run(ctx): void | Promise<void>;
  enabled?(ctx): boolean; visible?(ctx): boolean;
  keytip?: string; tooltip?: string; extendedHelp?: string;
};
```

`RibbonApi`: `setTab(id)`, `showContextual(id)` / `hideContextual()`,
`refresh()` (re-evaluate enabled/visible), `setKeytipsVisible(bool)`,
`collapse()` / `expand()` / `toggle()`, `destroy()`.

### Rules

- **R1: ribbon owns the commands.** No `data-forward` proxies, no
  `appendChild` moves of wired subtrees. The ribbon renders its own buttons
  and calls `command.run(ctx)` directly through the app-supplied adapter.
- **R2: shared renders, apps adapt.** `ribbon-chrome` knows tabs, groups,
  buttons, QAT, KeyTips, contextual-tab host, collapse. It never knows what
  "assign tag" or "finish run" does — the adapter maps command ids to the
  existing handler functions.
- **R3: light chrome, dark canvas.** Ribbon/QAT/status bar/properties use the
  light token set. The 3D viewport keeps its dark background. No dual-theme
  maintenance at launch; a dark-chrome toggle is out of scope.
- **R4: old controls stay until proven.** During migration each app keeps its
  existing dock buttons wired as fallback (hidden or in an "Advanced"
  overflow), removed only after the headed validation pass.
- **R5: ESC matrix preserved.** Both apps' existing ESC chains
  (`src/ui/escape-handler.js`, conduit `project-io.js handleEscape`) keep
  their exact precedence; the ribbon adds one layer only: open KeyTip overlay
  / open gallery dismisses first.
- **R6: SVG only.** No emoji in chrome. Monochrome line icons, 16px + 32px.
- **R7: ≤ 2 clicks.** Every pre-existing command reachable in at most one tab
  switch + one button press.
- **R8: accessibility.** `role=tablist/tab/tabpanel`, `aria-selected`,
  focus-visible rings, KeyTips are real buttons, dialogs trap focus.

### Visual language (Revit-faithful, scoped)

- Tab strip: light gray, active tab = white panel with top accent edge
  (not a glowing pill).
- Groups: bordered cluster with centered caption label + optional ↗ launcher.
- Buttons: big (32px icon over two-line label) and small (16px icon + label)
  variants; split buttons where the old UI had paired actions
  (finish/cancel run); no full-width 100% buttons.
- QAT above tabs: save, undo, redo (+ app-specific 1–2 pinned commands).
- Status bar at bottom: cursor coords / selection count / workplane state /
  backend flag (`js`/`wasm`) — conduit already has `#status-bar`, tray gains one.
- Properties palette (right dock): tray keeps element properties display;
  conduit keeps run/summary displays. Commands leave the dock; displays stay.
- Contextual tab host: hidden by default; e.g. conduit `Modify | Run` while a
  run is active; tray `Modify | Tray System` while a system is selected.
- KeyTips: `Alt` shows keytip badges; typing the sequence runs the command;
  `Esc` dismisses the overlay (new first layer in R5).

## Apps consume it

- `app/tray-ribbon-chrome`: owns `index.html`, `src/style.css` (tray part),
  `src/ui/viewer-chrome.js`, `src/ui/escape-handler.js`, tray command
  adapters. Retires `setupRibbonShell` move-logic. Populates or deletes the
  reserved `#options-bar-slot` (open question O1).
- `app/conduit-ribbon-chrome`: owns `conduit-takeoff/index.html`,
  `conduit-takeoff/src/style.css`, `conduit-takeoff/src/ui/*` adapters.
  Retires `data-forward` proxies. Contextual options bar becomes a true
  contextual tab (hidden unless tracing).
- Neither branch touches `src/main.js` wiring order except the one-line
  ribbon bootstrap callsite, `viewer-core`, Rust, or CI.

## Acceptance criteria

- [ ] Both apps boot with zero console errors; every old button from the
  command maps reachable in ≤ 2 clicks with identical outcome.
- [ ] KeyTips cover 100% of ribbon commands; `Alt`, sequence, `Esc` behave
  per R5.
- [ ] Contextual tabs appear/disappear on the specified triggers, never
  persist.
- [ ] Collapse/expand (`Ctrl+F1` + chevron) works; state persists per session.
- [ ] QAT undo/redo mirror the app undo stacks (disabled states in sync).
- [ ] `npm test` passes incl. new `ribbon-chrome` unit tests; both app
  builds pass; boundary check passes with the new package rule.
- [ ] Headed pass: `docs/VALIDATION-RUNBOOK.md` Gate A1 (tray) + A2 (conduit)
  re-ticked on the ribbon build; screenshots at 1440px attached to the PR.

## Test plan

- Unit (`packages/ribbon-chrome/test/`): tab switching, contextual
  show/hide, enabled/visible refresh, KeyTip sequence dispatch, collapse
  state, adapter contract violation (unknown command id throws a typed
  error, never a panic-through).
- Integration (per app): command-map walk — invoke every mapped command id
  through `RibbonApi` in jsdom/headless and assert the same handler ran
  (spy on adapter), plus the ESC matrix from the old specs.
- Manual: runbook Gates A1/A2 + screenshot comparison.

## Open questions

- O1 (tray): populate reserved `#options-bar-slot` as the tray contextual
  host, or delete it? Recommendation: reuse as contextual host.
- O2: exact QAT contents per app (default: save/export, undo, redo).
- O3: conduit hidden-button leak — adapters read live state, so proxies'
  hidden-click problem disappears; confirm during implementation.
- O4: dark-chrome toggle — explicitly deferred, not in acceptance.

## Parity reference

- Tray: `docs/specs/tray/revit-ribbon.md` (move-table, ESC chain) —
  superseded by this spec + `command-map-tray.md` on merge.
- Conduit: `docs/specs/conduit/revit-ribbon.md` (proxy-table, ESC chain) —
  superseded by this spec + `command-map-conduit.md` on merge.
- Runtime: `src/ui/viewer-chrome.js`, `src/ui/escape-handler.js`,
  `conduit-takeoff/src/ui/viewer-chrome.js`,
  `conduit-takeoff/src/ui/project-io.js` (`handleEscape`).

## Branch plan (one spec = one branch, AGENTS.md)

1. `spec/ribbon-chrome` (this): `docs/specs/chrome/*` only. Owner approves
   design.md before code.
2. `viewer/ribbon-chrome`: new `packages/ribbon-chrome/` framework + tests.
3. `app/tray-ribbon-chrome` + 4. `app/conduit-ribbon-chrome`: parallel,
   separate worktrees, owned app files only.
5. `infra/ribbon-boundaries`: ownership row + `check-boundaries.py` rule for
   the new package (owner-merge, before 3/4 merge).
