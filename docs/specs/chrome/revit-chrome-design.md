# Universal Revit-style chrome — design

Status: approved | Branch: `spec/ribbon-chrome` | Owner decision (2026-11-10):
one shared feature used by both modules; Revit-faithful; ribbon owns commands.

---

## 1. Goal

Replace the per-app dark-glass tab shells with one shared, Revit-faithful
ribbon framework. Both apps (tray viewer + conduit takeoff) consume it; each
module supplies its own command adapter. Light ribbon chrome, dark viewport
canvas (option B, decided: light chrome + dark canvas, no full dark theme).

Non-goal: no behaviour change in Rust cores, wasm bindings, geometry, or
`viewer-core`. Chrome-only rewrite of the two ribbon shells.

---

## 2. Revit UI/UX reference (complete — no external research needed)

This section is the authoritative Revit chrome reference for the implementer.
Measurements and colour values are taken from Revit 2024–2025 at 96 DPI and
Microsoft Fluent UI ribbon guidelines. A coder who has never opened Revit can
build a faithful replica from this section alone.

### 2.1 Overall layout (top-to-bottom, pixel heights)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [💾] [↩] [↪]  ·  [pinned QAT btn] ...                      [▼]   │  QAT bar     h=24px  bg=#F0F0F0  border-bottom:1px #CCCCCC
├──────────────────────────────────────────────────────────────────────┤
│  [ Model ] [ Tag ] [ Systems ] [ Edit ]              [^collapse]     │  Tab strip   h=28px  bg=#F0F0F0  (inactive tabs)
├──────────────────────────────────────────────────────────────────────┤
│  ┌─ Group ──────────────┐  ┌─ Group ───────────┐  ┌─ Group ──────┐ │
│  │ [BigBtn]  [BigBtn]   │  │ [Sm] [Sm] [Sm]    │  │ [BigBtn]     │ │  Panel       h=96px  bg=#FFFFFF  border-bottom:1px #CCCCCC
│  │ [Sm] [Sm] [Sm]       │  │ [Sm] [Sm]         │  │ [Sm] [Sm]    │ │
│  │  Group Caption    ↗  │  │  Group Caption     │  │  Group Cap.  │ │
│  └──────────────────────┘  └───────────────────┘  └──────────────┘ │
├──────────────────────────────────────────────────────────────────────┤  ← only when triggered
│  MODIFY | TRAY SYSTEM  (or MODIFY | RUN)                            │  Ctx strip   h=20px  bg=#D4E8FF  top-border:2px #0070C0
├──────────────────────────────────────────────────────────────────────┤
│  Size:[▼]  |  Elevation:[___]  [⊕]  |  System:[▼]  |  [✓][×]      │  Options bar h=28px  bg=#F0F0F0  (inside contextual panel)
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   3D viewport  (dark background, unchanged)                          │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  Selection: 3 elements  |  Level 1  |  JS mode  |  12.4, 0.0, 3.1  │  Status bar  h=22px  bg=#EEEEEE  border-top:1px #CCCCCC
└──────────────────────────────────────────────────────────────────────┘

Total chrome height (ribbon visible): QAT(24) + tabs(28) + panel(96) = 148px
Collapsed (panel hidden):             QAT(24) + tabs(28) = 52px
With contextual strip visible:        +20px above the panel (or replacing it)
```

### 2.2 Colour tokens (light chrome)

The `--rc-*` custom properties are defined in
`packages/ribbon-chrome/src/tokens.css` and scoped to `[data-rc-host]`.

| Token | Hex value | Usage |
|---|---|---|
| `--rc-chrome-bg` | `#F0F0F0` | QAT bar, tab strip inactive background, group separator |
| `--rc-panel-bg` | `#FFFFFF` | Active ribbon panel background |
| `--rc-panel-border` | `#CCCCCC` | Panel bottom border, group vertical separators |
| `--rc-tab-active-bg` | `#FFFFFF` | Active tab background (merges with panel) |
| `--rc-tab-active-top` | `#0070C0` | Active tab top-edge accent, 3px solid |
| `--rc-tab-hover-bg` | `#E0E0E0` | Tab hover state fill |
| `--rc-tab-text` | `#444444` | Tab label text, inactive |
| `--rc-tab-active-text` | `#000000` | Tab label text, active |
| `--rc-btn-hover-bg` | `#E8F0FB` | Button hover fill (light blue tint) |
| `--rc-btn-active-bg` | `#C5D9F1` | Button pressed/toggled-on fill |
| `--rc-btn-text` | `#1A1A1A` | Button label text |
| `--rc-btn-disabled-text` | `#AAAAAA` | Disabled button label |
| `--rc-btn-disabled-icon` | `#BBBBBB` | Disabled icon tint (via `opacity: 0.4`) |
| `--rc-group-caption` | `#555555` | Group caption text |
| `--rc-group-separator` | `#C8C8C8` | Vertical separator line between groups |
| `--rc-qat-bg` | `#F0F0F0` | QAT bar background (same as `--rc-chrome-bg`) |
| `--rc-ctx-strip-bg` | `#D4E8FF` | Contextual tab label strip background |
| `--rc-ctx-strip-text` | `#003A6E` | Contextual tab label text (all-caps) |
| `--rc-ctx-strip-accent` | `#0070C0` | Contextual tab top border (2px) |
| `--rc-statusbar-bg` | `#EEEEEE` | Status bar background |
| `--rc-statusbar-text` | `#444444` | Status bar text |
| `--rc-statusbar-border` | `#CCCCCC` | Status bar top border |
| `--rc-keytip-bg` | `#FFFFF0` | KeyTip badge background (pale yellow) |
| `--rc-keytip-border` | `#999900` | KeyTip badge border |
| `--rc-keytip-text` | `#333300` | KeyTip badge text |
| `--rc-focus-ring` | `#005499` | `:focus-visible` outline, 2px, offset 2px |
| `--rc-split-divider` | `#A8A8A8` | Vertical divider inside a split button |

Typography (Revit 2024, 96 DPI approximation):
- Tab labels: `Segoe UI` 9pt / 600 weight
- Button labels (big): `Segoe UI` 9pt / 400, two lines, centered
- Button labels (small): `Segoe UI` 8pt / 400, single line, left-aligned
- Group captions: `Segoe UI` 7pt / 400, all-caps via CSS `text-transform`
- QAT / status bar: `Segoe UI` 8pt / 400

### 2.3 QAT — Quick Access Toolbar

```
[ 💾 ] [ ↩ ] [ ↪ ]  |  [ ... app-pinned ... ]                  [ ▼ ]
 save   undo   redo                                           customise
```

- **Bar:** height 24px, `--rc-qat-bg`, full width, `border-bottom: 1px --rc-panel-border`.
- **Items:** icon-only buttons, 24×24px click target, 16px SVG icon centered.
  No label. Tooltip (`title`) shown after 400ms hover delay.
- **Separator:** 1px vertical `--rc-group-separator` between logical groups.
- **Hover:** `--rc-btn-hover-bg` fill, border-radius 2px.
- **Disabled:** icon at `opacity: 0.4`, `cursor: default`, `aria-disabled="true"`.
- **Customise `▼`:** right-aligned chevron button. v1: renders as a placeholder
  with tooltip "Customise Quick Access Toolbar (coming soon)". Does not open a menu.
- **QAT items reference a `Command.id`** already defined in `tabs` or `contextual`.
  The framework looks up the command and re-uses its `icon`, `tooltip`, `enabled`,
  and `run`. It does NOT duplicate the command object.

### 2.4 Tab strip

```
  [ Model ] [ Tag ] [ Systems ] [ Edit ]                       [^]
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  (panel below)
```

- **Strip:** height 28px, `--rc-chrome-bg`.
- **Active tab:** `--rc-tab-active-bg` (#FFF), 3px solid top border
  `--rc-tab-active-top`, bottom border none (tab flush with panel top).
  Font: 9pt/600, `--rc-tab-active-text`.
- **Inactive tab:** transparent on `--rc-chrome-bg`, 9pt/400,
  `--rc-tab-text`. Hover: `--rc-tab-hover-bg`.
- **Padding:** 0 12px inside each tab; first tab left-aligns with QAT left edge.
- **Collapse button `^`:** right-most element in the strip row. 28×28px.
  Tooltip: "Collapse Ribbon (Ctrl+F1)". Rotates to `v` when collapsed.
- **ARIA:** `role="tablist"` on `<nav>`; each `<button>` has `role="tab"`,
  `aria-selected="true|false"`, `aria-controls="<panel-id>"`,
  `id="rc-tab-<id>"`.

### 2.5 Ribbon panel

```
  ┌────────────────────────────────────────────────────────────────┐
  │  [Group A]  │  [Group B]  │  [Group C]  │  ...               │
  └────────────────────────────────────────────────────────────────┘
```

- **Height:** target 88–96px (one row of big buttons + group captions +
  vertical padding). Fixed height; no wrapping.
- **Background:** `--rc-panel-bg` (#FFF). `border-bottom: 1px --rc-panel-border`.
- **Layout:** horizontal flex row, `align-items: stretch`. Groups are
  `flex-shrink: 0`. If total group width exceeds viewport, panel scrolls
  horizontally (`overflow-x: auto`; scrollbar hidden on Windows).
- **Shown/hidden:** `hidden` attribute on `<section>` elements; active panel
  has `hidden` removed. Never `display:none` via CSS on the active panel
  (conflicts with `hidden` attribute semantics).

### 2.6 Groups

```
  ┌─────────────────────────────────┐
  │                                 │
  │  [BigBtn32]    [BigBtn32]        │  ← row of big buttons (32px icon, 2-line label)
  │                                 │
  │  [Sm16][Sm16][Sm16]             │  ← row 1 of small buttons
  │  [Sm16][Sm16]                   │  ← row 2 of small buttons
  │  [Sm16][Sm16][Sm16]             │  ← row 3 of small buttons (max 3 rows)
  │                                 │
  │  GROUP CAPTION               ↗  │  ← caption bar (bottom)
  └─────────────────────────────────┘
  (right border: 1px --rc-group-separator, except last group)
```

- **Big button:** 48–64px wide. 32px SVG icon centered horizontally.
  Two-line label below the icon, 9pt, center-aligned, `line-clamp: 2`,
  `text-overflow: ellipsis`. Hover: `--rc-btn-hover-bg`. Active/pressed:
  `--rc-btn-active-bg`.
- **Small button:** full group width. 16px SVG icon, left-aligned with 4px
  gap to label. Label: 8pt, single line, truncate at ~16 chars. Height: 22px.
  Rows: up to 3 per group, up to 3 items per row (auto-flow left to right).
- **Caption bar:** `border-top: 1px --rc-group-separator`, `padding: 2px 6px`.
  Text: 7pt, `text-transform: uppercase`, `--rc-group-caption`, centered.
  Launcher `↗` icon (12×12px) right-aligned in caption bar if `launcher` is set.
- **Launcher `↗`:** `aria-haspopup="dialog"`. Click target: 20×20px. Opens a
  panel/dialog. Tooltip = `launcher.tooltip`. Label = `launcher.ariaLabel`.
- **Command id uniqueness:** a command id identifies a logical action, not a
  DOM node. The same id **may appear in both a fixed tab and a contextual tab**
  (e.g. `tray.systems-highlight` in Systems tab AND in Modify | Tray System).
  The framework creates two independent `<button>` elements pointing at the
  same adapter; the adapter function is idempotent. No deduplication occurs.

### 2.7 Split buttons

Used where a primary action (finish) is visually paired with its inverse
(cancel) in one compound control.

```
  ┌────────────────┬─────┐
  │  ✓  Finish Run │  ×  │
  └────────────────┴─────┘
      primary (big)   companion (small chevron, ~24px wide)
```

- **Left part:** calls `primary.run(ctx)`. Label + icon of the primary command.
  Styled as a big button; width auto minus the companion width.
- **Right part:** calls `companion.run(ctx)`. Icon only (companion's icon, 16px).
  Width ~24px. Separated from left by 1px `--rc-split-divider`.
- **Disabled rule:** when `primary.enabled(ctx)` is false, both parts are
  disabled. The companion may also declare its own `enabled(ctx)` for
  independent disabling (e.g. cancel enabled even when finish is not).
- **In `RibbonDef`:** set `splitWith: '<companion-id>'` on the primary.
  The companion command must exist in the same group. The framework removes
  the companion from its normal button slot and renders it as the right part
  of the split button. The companion must NOT set `splitWith` itself.

### 2.8 Contextual tab

```
  Fixed tabs:  [ Model ] [ Tag ] [ Systems ] [ Edit ]           [^]
  ═══════════════════════════════════════════════════════════════════  ← 2px #0070C0
  MODIFY | TRAY SYSTEM                                               ← strip h=20px #D4E8FF
  ───────────────────────────────────────────────────────────────────
  Panel:  [ Highlight ] [ Isolate ] [ Continuity ]
          Group: Tray System Actions
```

- **Strip:** height 20px, `--rc-ctx-strip-bg`. Text: `--rc-ctx-strip-text`,
  7pt/600, `text-transform: uppercase`, left-aligned with 8px padding.
  Top border: 2px solid `--rc-ctx-strip-accent`.
- **Hidden by default.** Only one contextual tab may be shown at a time.
- **`showContextual(id)`:** strip + panel appear; the fixed tab panel is
  hidden (but active tab button stays highlighted). Focus moves to first
  button in the contextual panel.
- **`hideContextual()`:** strip + panel disappear; active fixed tab's panel
  is restored.
- **`aria-live="polite"`** on the contextual strip container: announces the
  tab label to screen readers on show.

**Trigger sites — tray app:**
- `api.showContextual('modify-tray-system')` → called in `system-manager.js`
  when a tray system selection occurs.
- `api.hideContextual()` → called in `system-manager.js` when selection clears.

**Trigger sites — conduit app:**
- `api.showContextual('modify-run')` → called in `draw-toolbar.js` when draw
  mode activates AND in `project-io.js` when `state.selectedRunId` becomes
  non-null.
- `api.hideContextual()` → called in `draw-toolbar.js` on `cancelCurrentRun()`
  AND in `project-io.js` when `state.selectedRunId` is set to null.

### 2.9 KeyTips

KeyTips replicate the Revit `Alt`-key keyboard navigation system.

1. **`Alt` keydown (first press):** show keytip badges over all QAT items and
   all tab buttons. Body gets `data-keytips="tabs"`.
2. **User types a tab keytip letter(s):** activate that tab, hide tab-level
   badges, show group and button keytip badges for the active panel.
   Body gets `data-keytips="commands"`.
3. **User types a command keytip:** call `command.run(ctx)`, hide all badges.
4. **`Escape`:** hide all badges immediately. This is the **first ESC layer**
   (R5) — evaluated before any app ESC logic.
5. **Second `Alt` press or `Escape` during tab-level:** cancel the sequence.

Badge appearance:
- Position: bottom-center of the button, `z-index` above the button label.
- Box: `--rc-keytip-bg` / `--rc-keytip-border`, border-radius 2px, padding 1px 3px.
- Text: 7pt/600, monospace, `--rc-keytip-text`. 1–3 characters.
- Element: `<span role="tooltip">` (non-interactive; navigation is keyboard-only).

**Coverage rule:** every `Command` and every QAT item **must** have a `keytip`
string. `createRibbon()` throws `AdapterError` at startup if any command is
missing a `keytip`. This is a hard startup check, not a runtime warning.

### 2.10 Collapse / expand

- **Toggle methods:** `Ctrl+F1` shortcut, double-clicking the active tab,
  or the `^` collapse button at the right of the tab strip.
- **Collapsed state:** panel row hidden (`display:none`); QAT and tab strip
  remain visible. Total chrome height: 52px.
- **Persistence:** `sessionStorage.setItem('rc-collapsed', '1')` on collapse;
  `sessionStorage.removeItem('rc-collapsed')` on expand. State is read in
  `createRibbon()` before first render (no layout flash).
- **API:** `api.collapse()` / `api.expand()` / `api.toggle()`.

### 2.11 Status bar

```
  Selection: 3 elements  │  Level 1  │  JS mode  │  12.4, 0.0, 3.1 m
```

- **Position:** fixed to bottom of viewport, full width, `z-index` above canvas.
- **Height:** 22px. `--rc-statusbar-bg`, `--rc-statusbar-text`, 8pt.
- **Top border:** 1px `--rc-statusbar-border`.
- **Segments:** pipe-separated `│` (Unicode U+2502), 8px padding each side.
  Left-to-right: selection count, active workplane/level (conduit only),
  backend mode (`JS mode` / `WASM mode`), cursor coordinates.
- **Tray:** gains `#rc-status-bar` (new element, wired by tray adapter).
  Conduit migrates existing `#status-bar` / `#cursor-coords` content into the
  framework's status bar slot via the adapter.
- **ARIA:** `role="status"`, `aria-live="polite"` on the status bar element.
- **`api.setStatus(segmentId, value)`:** updates a single segment text without
  triggering a full `refresh()`. Segments are identified by `StatusSegment.id`.

### 2.12 Accessibility (R8 — full requirements)

| Requirement | Implementation |
|---|---|
| Tab strip keyboard | Arrow keys move focus between tabs; `Enter`/`Space` activates |
| Focus ring | `:focus-visible` outline 2px `--rc-focus-ring`, offset 2px; never suppressed |
| Contextual tab announcement | `aria-live="polite"` on contextual strip container |
| KeyTip badges | `role="tooltip"` on badge spans; navigation is keyboard-only (no click) |
| Dialog launcher `↗` | `aria-haspopup="dialog"`, `aria-label` from `launcher.ariaLabel` |
| Disabled commands | `disabled` attribute + `aria-disabled="true"`; `cursor:default` |
| Icon-only buttons (QAT) | `aria-label` required; `title` for tooltip |
| Group containers | `role="group"`, `aria-label` from `RibbonGroup.label` |
| Panel containers | `role="tabpanel"`, `aria-labelledby` pointing to tab button id |
| Split button | Primary: `aria-label` = "Finish Run (primary)"; companion: "Cancel Run" |
| Status bar | `role="status"`, `aria-live="polite"` |
| Modal dialogs (launcher) | Trap focus within dialog; return focus to launcher on close |

---

## 3. Package: `packages/ribbon-chrome/`

Framework only. Zero product logic. Zero imports from apps, cores, bindings,
`viewer-core`, or `excel-io`. Ships its own design tokens and SVG sprite.

### 3.1 File layout

```
packages/ribbon-chrome/
  package.json
  src/
    index.js          ← exports createRibbon
    ribbon.js         ← core renderer + RibbonApi implementation
    keytips.js        ← KeyTip overlay logic
    tokens.css        ← --rc-* custom properties (scoped to [data-rc-host])
    sprite.svg        ← all icon <symbol> elements
  test/
    ribbon.test.js
    keytips.test.js
    split-button.test.js
    adapter-contract.test.js
```

### 3.2 Public interface — types

```ts
createRibbon(host: HTMLElement, def: RibbonDef, ctx: Ctx): RibbonApi
```

```ts
/**
 * Ctx — opaque bag supplied by the app at createRibbon() time.
 * Passed through verbatim to every command.run / enabled / visible call.
 * The framework never reads Ctx properties.
 *
 * Example — tray adapter:
 *   type TrayCtx = {
 *     tagging: TaggingPanel;
 *     systems: SystemManager;
 *     modelLoader: ModelLoader;
 *     safeEditor: SafeEditorPanel;
 *     routing: RoutingPanel;
 *     unifiedExport: UnifiedExport;
 *   };
 *
 * Example — conduit adapter:
 *   type ConduitCtx = {
 *     drawingTool: DrawingTool;
 *     projectIo: ProjectIo;
 *     summary: Summary;
 *   };
 *
 * Pass the full module-reference map rather than a subset to avoid partial
 * captures. Ctx must be a non-null object.
 */
type Ctx = Record<string, unknown>;

type RibbonDef = {
  appId: 'tray' | 'conduit';
  tabs: RibbonTab[];
  contextual: ContextualTab[];   // hidden by default; show via api.showContextual()
  qat: CommandRef[];             // references to Command.ids in tabs/contextual
  statusSegments?: StatusSegment[];
};

type RibbonTab = {
  id: string;
  label: string;
  keytip: string;      // 1-2 chars shown in Alt-mode; must be unique across tabs
  groups: RibbonGroup[];
};

type ContextualTab = {
  id: string;
  label: string;       // shown in accent strip, e.g. 'MODIFY | RUN'
  keytip: string;
  groups: RibbonGroup[];
};

type RibbonGroup = {
  id: string;
  label: string;
  launcher?: {
    tooltip: string;
    ariaLabel: string;
    run(ctx: Ctx): void;
  };
  /**
   * items: array of rows; each row is an array of Command or InputField.
   * Max 3 rows; max 3 items per row for small-sized items.
   * A row containing a big Command should have only 1–2 items.
   */
  items: (Command | InputField)[][];
};

/** A clickable ribbon command rendered as a button. */
type Command = {
  kind?: 'command';        // default when omitted
  id: string;
  label: string;
  icon: IconName;          // must exist in sprite.svg
  size: 'big' | 'small';
  keytip: string;          // required; createRibbon() throws AdapterError if missing
  tooltip?: string;
  extendedHelp?: string;
  /**
   * Split-button pairing. Set on the PRIMARY action only.
   * The companion command id must exist in the same group.
   * The companion must NOT also set splitWith.
   * The framework removes the companion from its normal button slot
   * and renders it as the right chevron part of the split button.
   * See §2.7 for full visual spec.
   */
  splitWith?: string;
  run(ctx: Ctx): void | Promise<void>;
  enabled?(ctx: Ctx): boolean;   // absence = always enabled
  visible?(ctx: Ctx): boolean;   // absence = always visible
};

/**
 * InputField — inline input inside a ribbon group.
 * Use ONLY inside contextual tab groups (Modify | Run options-bar controls:
 * diameter select, elevation input, system select).
 * Never in fixed tabs. Numeric fields that belong in a dock display panel
 * (e.g. waste-factor-input) must NOT be modelled as InputField.
 */
type InputField = {
  kind: 'input';
  id: string;
  label: string;
  inputType: 'number' | 'text' | 'select';
  options?: { value: string; label: string }[];  // for inputType:'select'
  min?: number; max?: number; step?: number;
  keytip?: string;
  tooltip?: string;
  onChange(value: number | string, ctx: Ctx): void;
  value?(ctx: Ctx): number | string;
};

/** References the id of an existing Command defined in tabs or contextual. */
type CommandRef = string;

type StatusSegment = {
  id: string;
  value?(ctx: Ctx): string;
};
```

### 3.3 RibbonApi

```ts
interface RibbonApi {
  /** Switch the active fixed tab. No-op if id unknown. */
  setTab(id: string): void;

  /** Show the named contextual tab strip + panel. Hides the fixed panel. */
  showContextual(id: string): void;

  /** Hide the contextual tab; restore the last active fixed tab's panel. */
  hideContextual(): void;

  /**
   * Re-evaluate all command.enabled() and command.visible() and update DOM.
   * Synchronous. Single pass over the command map — cheap.
   *
   * CONTRACT (enforced):
   *   • Apps call refresh() after any state mutation that affects enabled/visible.
   *   • The framework does NOT poll. No MutationObserver. No timer.
   *   • Call refresh() in the event handler that changes state, not inside
   *     rAF callbacks or setInterval. Calling inside a render loop produces
   *     a console.warn (non-fatal; caught by the unit test spy).
   *   • The framework guarantees idempotency: calling refresh() twice with
   *     no state change between calls has no visible effect.
   */
  refresh(): void;

  /** Show/hide all KeyTip badges (apps rarely call; Alt key handles it). */
  setKeytipsVisible(visible: boolean): void;

  /** Collapse the panel row. Persists to sessionStorage. */
  collapse(): void;

  /** Expand the panel row. Persists to sessionStorage. */
  expand(): void;

  /** Toggle collapse state. */
  toggle(): void;

  /**
   * Update a single status bar segment without triggering a full refresh().
   * segmentId must match a StatusSegment.id in the RibbonDef.
   */
  setStatus(segmentId: string, value: string): void;

  /** Remove all DOM, event listeners, and sessionStorage keys this instance owns. */
  destroy(): void;
}
```

---

## 4. Rules

- **R1 — ribbon owns the commands.** No `data-forward` proxies, no
  `appendChild` moves of wired subtrees. The ribbon renders its own buttons
  and calls `command.run(ctx)` directly through the app-supplied adapter.
- **R2 — shared renders, apps adapt.** `ribbon-chrome` knows tabs, groups,
  buttons, QAT, KeyTips, contextual host, collapse, status bar. It never
  knows what "assign tag" or "finish run" does.
- **R3 — light chrome, dark canvas.** Ribbon/QAT/status bar use `--rc-*`
  tokens (light). The 3D viewport keeps its dark background. No dual-theme
  maintenance; a dark-chrome toggle is out of scope (O4).
- **R4 — old controls stay until proven.** Each app keeps existing dock
  buttons wired as fallback during migration. Removed only after Gate A1/A2
  headed validation passes.
- **R5 — ESC matrix preserved.** Existing ESC chains are unchanged.
  The ribbon adds exactly one new layer, evaluated FIRST: if KeyTip overlay
  is visible, `Esc` closes it and stops. No app ESC logic runs in that case.
- **R6 — SVG only.** No emoji in chrome. Monochrome stroke icons, 16/32px
  from one path set, `currentColor`. Full inventory in `icon-inventory.md`.
- **R7 — ≤ 2 clicks.** Every pre-existing command reachable in at most one
  tab switch + one button press.
- **R8 — accessibility.** Full requirements in §2.12.
- **R9 — no cross-import with excel-io.** `excel-io` must not import
  `ribbon-chrome`; `ribbon-chrome` must not import `excel-io`. Enforced by
  `scripts/check-boundaries.py` rule added in `infra/ribbon-boundaries`.

---

## 5. Apps consume it

**`app/tray-ribbon-chrome`** owns:
`index.html`, `src/style.css`, `src/ui/viewer-chrome.js`,
`src/ui/escape-handler.js`, `src/ui/tray-adapter.js` (new).
- Retires `setupRibbonShell()` (appendChild move-logic).
- Reuses `#options-bar-slot` as the contextual tab host (O1 resolved: reuse,
  do not delete).
- Calls `api.showContextual('modify-tray-system')` from `system-manager.js`
  on system select; `api.hideContextual()` on deselect.

**`app/conduit-ribbon-chrome`** owns:
`conduit-takeoff/index.html`, `conduit-takeoff/src/style.css`,
`conduit-takeoff/src/ui/conduit-adapter.js` (new),
`conduit-takeoff/src/ui/viewer-chrome.js`,
`conduit-takeoff/src/ui/project-io.js`.
- Retires all `data-forward` ribbon proxy buttons and MutationObserver mirrors.
- The always-visible `#ribbon-contextual` options bar becomes a true contextual
  tab `Modify | Run` (hidden unless draw mode is active or a run is selected).
- Calls `api.showContextual('modify-run')` from `draw-toolbar.js` and from
  `project-io.js` on run select; `api.hideContextual()` on run deselect and
  `cancelCurrentRun()`.

**Neither branch** touches `src/main.js` wiring order except the one-line
ribbon bootstrap callsite, `viewer-core`, Rust, CI, or the other app's files.

---

## 6. Workspace / package.json ownership (BP2)

`viewer/ribbon-chrome` additionally owns the **root `package.json`** (one-line
addition to the `workspaces` array: `"packages/ribbon-chrome"`) and
`packages/ribbon-chrome/package.json` (new). No `Cargo.toml` change needed.
The root `package.json` edit is a single-line addition — acceptable within
`viewer/*` branch scope because no other agent touches it concurrently.

---

## 7. Acceptance criteria

- [ ] Both apps boot with zero console errors; every old button reachable in ≤ 2 clicks with identical outcome.
- [ ] KeyTips cover 100% of ribbon commands; `Alt`→sequence→`Esc` behaves per §2.9 and R5.
- [ ] Contextual tabs appear/disappear on the specified triggers (§2.8), never persist after dismiss.
- [ ] Collapse/expand (`Ctrl+F1`, double-click tab, `^` button) works; state persists via `sessionStorage`.
- [ ] QAT undo/redo match app undo-stack disabled states; save/export enabled when model/project loaded.
- [ ] `npm test` passes incl. new `ribbon-chrome` unit tests; both app builds pass; boundary check passes.
- [ ] Headed pass: `docs/VALIDATION-RUNBOOK.md` Gate A1 (tray) + A2 (conduit) re-ticked; 1440×900 screenshots in PR.
- [ ] No emoji in ribbon chrome; all `IconName` refs resolve in `sprite.svg`.
- [ ] `api.refresh()` never called inside a render loop (grep + unit test spy assert).

---

## 8. Test plan

**Unit** (`packages/ribbon-chrome/test/`):
- Tab switching: `setTab` changes `aria-selected`, shows correct panel.
- Contextual show/hide: strip appears/disappears; fixed panel restored on `hideContextual`.
- enabled/visible refresh: buttons gain/lose `disabled`/`hidden` after `refresh()`.
- KeyTip dispatch: Alt → badge shown → type sequence → `command.run` called.
- Collapse: `collapse()` hides panel; `sessionStorage` key set; `expand()` restores.
- Split button: left part calls primary `run`; right chevron calls companion `run`.
- Adapter contract: unknown `command.id` in def → `AdapterError` thrown at `createRibbon()`.
- `refresh()` in render loop: calling inside `rAF` produces `console.warn` (spy assert).

**Integration (per app):** command-map walk — invoke every command id via
adapter spy and assert the correct handler ran; ESC matrix from old specs.

**Manual:** runbook Gates A1/A2 + screenshot comparison.

---

## 9. Open questions (all resolved)

| Q | Resolution |
|---|---|
| O1 — `#options-bar-slot` as contextual host vs delete | ✅ Reuse as contextual host. Do not delete. |
| O2 — QAT contents per app | ✅ Defined in each command map. Tray: `tray.export-mapping`, `tray.batch-undo`, `tray.batch-apply`. Conduit: `conduit.proj-save`, `conduit.trace-undo`, `conduit.trace-redo`. |
| O3 — hidden-button leak | ✅ Structurally eliminated by adapter model (no DOM proxies). Confirm in integration tests. |
| O4 — dark-chrome toggle | ✅ Explicitly out of scope. Not in acceptance criteria. |

---

## 10. Parity reference

- Tray: `docs/specs/tray/revit-ribbon.md` — superseded by this spec +
  `command-map-tray.md` on merge.
- Conduit: `docs/specs/conduit/revit-ribbon.md` — superseded by this spec +
  `command-map-conduit.md` on merge.
- Current runtime (to be replaced): `src/ui/viewer-chrome.js`
  (`setupRibbonShell`, appendChild moves), `src/ui/escape-handler.js`,
  `conduit-takeoff/src/ui/viewer-chrome.js` (data-forward proxies),
  `conduit-takeoff/src/ui/project-io.js` (`handleEscape`).

---

## 11. Branch plan

1. `spec/ribbon-chrome` **(this):** `docs/specs/chrome/*` only. Owner approves before code.
2. `viewer/ribbon-chrome`: `packages/ribbon-chrome/` + tests + root `package.json` workspace line.
3. `app/tray-ribbon-chrome` + 4. `app/conduit-ribbon-chrome`: parallel, separate worktrees.
5. `infra/ribbon-boundaries`: add `packages/ribbon-chrome` ownership row to `AGENTS.md`;
   add `ribbon-chrome` no-import rule to `scripts/check-boundaries.py`.
   **Owner-merge required. Must land before branches 3 and 4 open PRs** (CI
   boundary check would fail otherwise). Agent opens the PR and stops.
