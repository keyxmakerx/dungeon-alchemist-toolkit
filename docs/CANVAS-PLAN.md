# Canvas Stair Visualization + Unified Dashboard — Plan (toward v0.5.0)

Status as of this doc: **v0.4.0** is on PR #1 (`claude/gracious-goodall-ukqsio` → `main`) —
the Level Manager dashboard with full floor management (rename / elevation / ★ start /
reorder / **replace image** / **add** / **remove**) and a preview-first in-window import
folder browser. This plan covers what comes next, validated against the actual source.

The headline feature is the **on-canvas stair/portal/trap visualization** (P4). The
broader roadmap (folding Import into the dashboard as tabs, a Stairs tab, and the
v0.5.0 release) is captured at the end so it's all in one place.

---

## Locked design decisions (approved by the maintainer)

1. **Per-link colour.** Hash each `linkId` → a stable hue, so every linked pair has its
   own consistent colour across its markers, line, midpoint label, and badge.
2. **Same-floor link** (both ends on the viewed level): a translucent colored **line**
   between the two region centres + a small **label at the line midpoint**.
3. **Cross-floor link** (the far end is on a different level — *including* "straight up/down"
   where both ends share x,y): **no line** (the far end isn't on the viewed canvas).
   Instead a **badge** on the visible end — `↑ <FloorName>` if the partner floor is higher,
   `↓ <FloorName>` if lower. Direction = compare partner level `elevation.bottom` vs the
   viewed level's.
4. **Hover / select** a marker → a small **info-card**: `<label> · <mode> · <arrow> <FloorName>`.
5. **Drag a portal** → its line/badge **follows in real time** where the build allows;
   always **redraws on drop** as the guaranteed fallback.
6. **GM-only.** Every guessed v14 API is feature-detected → worst case is prior behaviour,
   never a crash.
7. **Shared `drawCanvasLabel`** helper, factored from the player overlay's `buildLabel`, so
   GM badges/labels and player labels share one implementation.

---

## How `portal-overlay.js` works today (what we extend)

`scripts/portal/portal-overlay.js` (~120 lines), the existing GM overlay:

- **State:** `_overlay` (`PIXI.Graphics|null`, line 23) — one immediate-mode graphics object
  everything draws into; `_drawDebounce` (line 24); `LINK_COLOR = 0xb0cc28` (line 26, the
  single fixed colour we replace with a per-link hue).
- **`ensureOverlay()`** (lines 28-41): lazily creates the `PIXI.Graphics`, `eventMode="none"`,
  `zIndex=100`, parented to `canvas.controls`; guarded so failure nulls the ref.
- **`drawPortalOverlay()`** (lines 57-97): GM-gate → `ensureOverlay()` → `g.clear()` →
  `currentLevel = getCurrentLevelId(scene)`, `ringR = (grid.size ?? 100)*0.35` → for each
  `[linkId, entries]` from `getPortalLinkGroups`, filter to ends on the current level (or all
  if no current level), draw a ring per end (`LINK_COLOR`), and if ≥2 on-level ends draw lines
  from the first to the others. No text, no per-link colour, one Graphics object.
- **Hooks** (`registerPortalOverlayHooks`, lines 112-119, called from `main.js` line 64):
  `canvasReady`→draw, `canvasTearDown`→teardown, `daLevelChanged`→scheduleDraw,
  `create/update/deleteRegion`→scheduleDraw (scene-scoped). `scheduleDraw` debounces 120ms.

**Key structural fact:** one non-interactive `PIXI.Graphics` can't carry text or interactivity.
We keep `_overlay` for lines/rings, and add a sibling **`PIXI.Container` (`_labels`)** for text +
interactive hit-areas — exactly how `portal-player-overlay.js` already pairs a container layer
(`_layer`) with per-label containers from `buildLabel` (lines 61-94).

Supporting helpers we build on: `portal-core.js` `getPortalLinkGroups` (82-91), `regionCenter`
(107-127), `regionLevelId` (94-100), `getPortalFlag` (55-59), `MODE_PRESETS` (30-34);
`levels.js` `getSceneLevels` (16-28), `getCurrentLevelId` (40-61), `viewLevel`→`daLevelChanged`
(82); elevation comparison via `level.elevation.bottom` (as used in `dashboard.js` 84/117).

---

## New / changed files

```
New:    scripts/portal/canvas-label.js   drawCanvasLabel() — shared label/badge builder
        scripts/portal/portal-color.js   linkHue()/linkColor() — per-link stable hue
Extend: scripts/portal/portal-overlay.js  per-link colour, _labels container, same-floor
                                          midpoint label, cross-floor ↑/↓ badges,
                                          drag-follow (RAF), hover/select info-card
        scripts/portal/portal-player-overlay.js  buildLabel → calls drawCanvasLabel (no
                                          behaviour change)
        styles/module.css                .da-portal-card (DOM info-card; matches existing
                                          .da-door-tooltip / .da-level-tooltip pattern)
        lang/en.json                     any new card/i18n strings
```

### `canvas-label.js` — `drawCanvasLabel(center, text, opts)`
Factor the presentation out of player `buildLabel` (61-94) unchanged: `PIXI.Text` (Signika 16,
white, black stroke 3, anchor (0.5,1), y=-10) over a rounded-rect bg (`0x000000`, α0.5, pad
6/3, r4). `opts`: `bg`, `bgAlpha`, `fill`, `fontSize`, `offsetY`, `anchor`, `interactive`
(sets `eventMode="static"`, `cursor`, hover-scale 1.08), `onClick`. Player overlay calls it with
`{interactive:true, cursor:"help", onClick: notify}` so player behaviour is byte-identical.

### `portal-color.js` — per-link hue
`hashStr` (FNV-1a: `h=0x811c9dc5; h^=ch; h=Math.imul(h,0x01000193); h>>>0`) → `linkHue = hash%360`
→ `hslToRgbInt(hue, 0.65, 0.55)` → 24-bit int for PIXI. Stable across reloads (input is the
persisted `linkId`). Same int feeds ring + line + midpoint label + badge for one pair.

### `portal-overlay.js` — extended draw
- Add `_labels` (`PIXI.Container`, zIndex 101) via `ensureLabelLayer()` (modeled on `ensureOverlay`
  + player `ensureLayer`); teardown removes/destroys it.
- Rewrite `drawPortalOverlay()`: keep guards + `g.clear()`; also clear `_labels`. Precompute
  `elevById` / `levelNameById` once from `getSceneLevels`. Per group:
  - `color = linkColor(linkId)`. Partition ends into `onLevel` / `offLevel`.
  - **Markers:** ring per on-level end in `color`; record `{region, center, portal}` for hover.
  - **Same-floor:** two on-level ends → one translucent line + a midpoint `drawCanvasLabel(label)`.
  - **Cross-floor:** on-level end with off-level partner → `dir = partnerBottom > viewedBottom ?
    up : down`; badge `↑/↓ <FloorName>` via `drawCanvasLabel(center, text, {bg:color, bgAlpha:0.85})`.
    No line. The straight up/down (same x,y) case falls out for free — the far end is off-level,
    so no zero-length line is ever attempted; the visible end just gets a badge.
  - Degrade: if `currentLevel` is null, keep today's "show everything, no badges" behaviour.

### Drag-follow hooks
- **Drop fallback (already present):** `updateRegion`→scheduleDraw (116-118) → snaps within 120ms.
- **Continuous (preferred):** guarded `refreshRegion` → `scheduleDrawFast()` (a `requestAnimationFrame`
  coalesced redraw) so the line tracks live; `regionCenter` reads `region.object?.bounds` so it
  picks up the in-drag preview. One-time `console.debug` the first time it fires confirms the hook
  is real on the running build.
- Registering an unused hook name is harmless in Foundry → guessing wrong costs nothing (degrades to
  drop-redraw). Cancel any pending RAF on teardown.

### Hover / select info-card
- **Detect:** guarded `hoverRegion` / `controlRegion` hooks (act only on our portal-flagged
  regions, scene-scoped). Fallback if absent: invisible interactive hit-circles in `_labels`
  (`eventMode="static"`, `hitArea=PIXI.Circle`) carrying pointer handlers.
- **Render as DOM** (recommended, not PIXI): a `.da-portal-card` div appended to `document.body`,
  positioned from screen coords — matches the existing `.da-door-tooltip` / `.da-level-tooltip`
  convention (importer-dialog.js 290-306, CSS 176-189). Crisper text, immune to canvas zoom.
  Content built with `textContent` (never innerHTML) since names derive from DA files. Coord
  conversion fallback chain: `stage.worldTransform.apply` → `clientCoordinates` → last pointer
  `clientX/Y` → skip card.

---

## Phases (each: one or two files, `node --check`-clean, prior phases still work, demo-able)

- **A — Extract `drawCanvasLabel`** (no behaviour change). New `canvas-label.js`; player
  `buildLabel` calls it. Verify: players see identical labels (hover scale, click hint).
- **B — Per-link colour.** New `portal-color.js`; replace `LINK_COLOR` at ring/line draws with
  `linkColor(linkId)`. Verify: two links on one floor draw in two distinct stable colours.
- **C — Same-floor midpoint label.** Add `_labels` container; draw a label at each same-floor
  line midpoint. Verify: a same-floor pair shows its colored label mid-line.
- **D — Cross-floor badges.** Partition on/off-level; draw `↑/↓ <FloorName>` badges on visible
  ends with off-level partners (covers straight up/down → badge, no line).
- **E — Drag-follow.** Add `scheduleDrawFast` (RAF) + guarded `refreshRegion`; keep `updateRegion`
  drop fallback. Verify: line/badge tracks a drag where supported; snaps on drop everywhere.
- **F — Hover/select info-card.** `_card` DOM element + `showCard/hideCard`; guarded
  `hoverRegion`/`controlRegion` with hit-circle fallback; `.da-portal-card` CSS.

---

## Performance

- One `g.clear()` + redraw per event, never per frame — except during an active drag, which uses
  a single RAF-coalesced redraw per frame.
- Draw only on-level markers/lines/labels; badges only for on-level ends with off-level partners;
  the off-level end is never drawn.
- Precompute `elevById` / `levelNameById` once per draw (the overlay redraws often). Two debounce
  tiers: 120ms for create/delete/level-change, RAF for drag. Optional off-view culling deferred
  until profiling on a large scene shows a need.

---

## Risks → degrade-safe fallback (every one)

1. `refreshRegion` may not fire mid-drag → redraw-on-drop via existing `updateRegion`.
2. `hoverRegion`/`controlRegion` may not fire → interactive PIXI hit-circles → else no card.
3. Screen-coord API name varies → worldTransform → clientCoordinates → pointer clientX/Y → skip.
4. `getCurrentLevelId` null on some builds → "show everything, no badges" (never worse than today).
5. `PIXI.Text`/font issues → fallback `sans-serif`; per-label try/catch keeps line/marker drawing.
6. `canvas.controls` container differs → same `canvas.interface ?? canvas.controls` fallback both
   overlays already use.
7. `↑`/`↓` glyphs → ASCII `^`/`v` fallback behind a constant.

## Cannot work exactly as stated in v14 (and the closest alternative)
- **True real-time drag-follow** isn't a v14 guarantee → snap-on-drop is the locked fallback
  (shipped alongside; never a crash).
- **Hover/select detection** assumes region hooks → self-owned hit-circles otherwise → else no card.
- **Info-card substrate**: PIXI would fight zoom/crispness → DOM tooltip (the recommendation) is the
  faithful alternative, reusing the existing tooltip pattern.

---

## Remaining roadmap (after the canvas work)

These complete the "one dashboard, no separate boards" vision and ship v0.5.0.

- **Tab merge — fold Import into the dashboard.** Turn the Level Manager into a tabbed window
  (**Floors / Import / Stairs**). The Import tab hosts the in-window folder browser + detected-floor
  preview + options + import (the machinery currently in `importer-dialog.js`), so "Import" switches a
  tab instead of opening a second window. Retire `importer-dialog.js`. Largest/most delicate change;
  do it as its own step with a render before merge.
- **Stairs tab (P5).** Fold stairs management into the dashboard: a Stairs tab listing every
  link with inline add (`addStairsInteractive`) / edit (`bindPortals` editor lifted from
  `portal-manager.js`) / delete / goto. Retire the standalone `portal-manager.js`.
- **Release v0.5.0 (P6).** Retire `hub.js`; alias retired API members (one-time deprecation warn) for
  macro back-compat; trim dead i18n/CSS; CHANGELOG; bump `module.json`.

## Verification (every phase)
- `node --check` all scripts; JSON-validate `module.json`/`lang/en.json`; template↔JS selector &
  action contract; `git grep` for dangling refs on retirements.
- Commit + push to the feature branch (updates the open PR). Live (maintainer) verification per phase.
- No live v14 in CI → every guessed API feature-detected and degrades to prior behaviour.
