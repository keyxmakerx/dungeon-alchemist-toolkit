# 0.4.0

**Dashboard editing + preview-first import** (redesign Concept A, P2–P3). The Level
Manager is now a real editor, and importing opens straight to your floors. Canvas
stair visualization and inline stairs management follow in 0.5.0.

## [Added]
- **Inline floor editing in the Level Manager.** Select a floor and edit it on the right: **rename**, set **elevation** (bottom/top, validated), mark the **★ start floor**, and **reorder ↑/↓**. An **Open Scene Config (Levels)** link is the escape hatch to Foundry's native tab for cross-level visibility and floor deletion.
- **Unpaired-file warning on import.** A folder with an image that has no JSON (or vice-versa) now shows an inline warning listing what was skipped, instead of silently importing fewer floors.

## [Changed]
- **Import is preview-first.** Picking a folder now opens straight to the detected **floors** (thumbnails / names / count) — previously they were buried behind the third tab, so you'd "pick a folder and hope". Scene background/grid/door options moved into a collapsible **Scene & door options** section.

## [Notes]
- Floor edits are written safely: every change sends the **complete `levels` array** via `scene.update`, then reads it back and warns on count/id drift (worst case a no-op, never data loss). All level writes are **serialized** so a fast edit-then-click can't clobber. Reorder **swaps elevation bands** (the list is elevation-ordered); because regions bind by level `_id`, **stairs stay attached** through any rename or reorder.
- Statically verified (`node --check`, JSON-valid, template/selector contract checked); pending a live v14 confirmation as usual.

# 0.3.2

Preview toward **v0.4.0** — the new **DA Level Manager dashboard** (redesign Concept A, P0–P1).

## [Added]
- A unified **Level Manager** window: a floors list (thumbnail / name / elevation / ★) with **click-to-view**, and the stairs/portals that connect the selected floor. Opened from a single toolbar button, the *Open the Toolkit* Module-Settings entry, or `DA.open()`. Import / Add Stairs currently bridge to the existing flows; live import preview and inline stairs editing arrive in the next phases.

## [Changed]
- The toolbar entry is now a **single tool inside a native control group** (never a custom group), behind a **client setting** (Module Settings → "Toolbar button") so it can be turned off — directly addressing the 0.3.1 floor-selection regression.
- Internal: extracted the shared thumbnail builder into `floor-rows.js`.

# 0.3.1

## [Fixed]
- **Removed the scene-controls toolbar group.** Custom control groups have open core bugs in early v14, and the group appeared to interfere with native **floor/level selection** on the canvas (and added a confusing second stairs entry). The toolkit is reached via *Module Settings → Open the Toolkit* (or the `DA` API) until the entry point is redesigned (see `docs/REWORK-PLAN.md`).

# 0.3.0

Stairs/portal UX rework (phases 5–10 of `docs/REWORK-PLAN.md`). Still pending a
live v14 confirmation; all changes are node-checked and degrade safely.

## [Changed]
- **Guided stairs placement.** Creating stairs/portals now uses a persistent on-canvas banner with an in-flow floor picker (the bound level is the one you pick — fixing wrong-floor binding), a ghost of the placed entrance, and Back/Cancel — replacing the old toast-driven, manual-floor-switch flow.
- **Link-aware Stairs Manager.** "Edit" now opens a link editor (rename, change type/two-way for the whole link); an "Open Region Sheet" button remains for shape/elevation.
- **One idempotent link path (`bindPortals`).** Create, direct-connect, and edit all route through it; teleport behaviors are replaced (never stacked) and an existing link id is reused, so re-linking/editing converges.
- **Honest player labels.** The sight-gated "Stairs" label is now a hint; using a stair is the native walk-onto behavior (the unreliable client-side token move was removed).

## [Fixed]
- Overlays redraw on a toolkit-driven level change; region hooks are scene-scoped and debounced. `regionCenter` handles non-rectangle shapes. Bounded the import subfolder search; `regionUuid` no longer returns a broken reference.

## [Added]
- Localized all toasts and dialog titles/buttons via `game.i18n` (`lang/en.json`), so the module is translation-ready. (Handlebars **template** labels remain English — the last i18n piece.)

## [Deferred]
- Importer tabs → native ApplicationV2 `static TABS` (a moat rewrite that needs live verification) and retiring/folding the legacy `AddRegion` `changeLevel` tool.

# 0.2.0

Early "redo" pass — safety, correctness, and a unified entry point — driven by a
three-part audit (`docs/audits/`) and `docs/REWORK-PLAN.md`.

## [Security]
- **GM-gate every write path.** Imports, scene/region creation, and all stairs/portal writes now require a GM (clear toast otherwise). The Stairs Manager is GM-only too — its list would otherwise reveal hidden trap locations to players.

## [Fixed]
- **Stairs no longer silently bind to the wrong floor.** Active-level detection now uses Foundry v14's documented accessors (with a diagnostic log on fallback) instead of guessed paths that always resolved to the bottom floor.
- **Teleport payload** prefers v14's canonical plural `destinations` over the deprecated singular `destination` (read from the live behavior schema), and forces a confirm/picker for multi-destination links.
- **Importer hardening:** map-wide DA values (width/height/grid/padding/distance/colors) are validated or clamped before `Scene.create`, closing the last "one bad value aborts the whole import" path. Fractional level elevations are no longer truncated; skipped unpaired files are surfaced as a notification.

## [Changed]
- **Unified entry point.** The three Scenes-directory buttons (injected by scraping the sidebar DOM) are replaced by a **Dungeon Alchemist** scene-controls group (left canvas toolbar) plus a reliable **hub** window — opened via `DA.open()` or an *Open the Toolkit* button in Module Settings. Tool windows now focus an existing instance instead of stacking duplicates.
- Internal: shared GM/level/canvas-pick helpers extracted into `util.js` / `levels.js` / `canvas-pick.js`.

## [Added]
- English localization scaffold (`lang/en.json`) and `module.json` packaging metadata (`languages`, `media`, `bugs`).

## [Notes]
- The stairs/portal system is built on native v14 and hardened, but still pending a live confirmation in a running v14 world (no Foundry runtime in CI). Everything in this release is statically verified or degrades to prior behavior if a guessed API differs. See `docs/STAIRS-TESTING.md`.

# 0.1.0

## [Changed]
- **Relaunched as Dungeon Alchemist Toolkit** (new module id `dungeon-alchemist-toolkit`). The module's focus is now narrow: import a Dungeon Alchemist folder into a single Foundry v14 Scene built on native Scene Levels, plus the multi-level stairs/elevator region tool.

## [Removed]
- The standalone **"DA Edit Levels"** edit-mode (`DA.EditLevels()`) and the per-floor **Visible Levels** dropdown. Per-level naming, elevation, roof, start, and cross-level visibility editing is now deferred to **Foundry v14's native Levels tab in Scene Config** after import.

## [Fixed]
- **Hardened the v14 import** so a single malformed entry can no longer abort the whole import:
  - Dropped the invalid Scene `fog.mode` value (v14 replaced the numeric `fog.mode` with `fog.exploration` modes); the Scene now inherits the v14 fog default.
  - Walls with a malformed `c` (not four finite numbers) and lights with a non-finite `x`/`y` are now skipped individually instead of failing `Scene.create` and losing every floor.
  - Dropped the Region `visibility` magic integer (`2`) — it no longer matches v14's reworked Region visibility enum; the region inherits the v14 default.
- Wrapped `Scene.create` in a try/catch safeguard so a validation error reports a notification and aborts cleanly instead of throwing.

## [Kept]
- The DA-aware import conveniences: per-floor names pre-filled from the original filename, auto-stacked floor elevations, the roof shortcut (a floor whose filename contains "roof" is pre-marked, rendering only over the floor below), and the image/video media preview.

## [Credits]
- GPLv3 fork attribution to **Bruno Calado (Mestre Digital)** — *Dungeon Alchemist Toolkit* is an independent fork that substantially expands the original `da-level-importer`.

# 0.0.14

## [Added]
- **Edit an existing scene's levels** — `DA.EditLevels()` and a new **"DA Edit Levels"** sidebar button. Open it on a scene you're viewing to rename levels, change their bottom/top elevations, reorder them (drag the **#**), and adjust Roof / Start / Visible, then **Apply Changes**. Edits are written in place by level id, so all walls, lights, and regions stay bound — no re-linking. *(v1 edits the existing levels; adding/removing levels is not yet supported. Reordering restacks elevations to the default ladder.)*

# 0.0.13

## [Fixed]
- **Levels-tab edits are now captured continuously** into a per-floor state store, so a Name / elevation / Roof / Visible edit survives a full dialog re-render instead of silently reverting to defaults. (Prerequisite hardening for the upcoming edit-existing-scene work — see `docs/PLAN.md`.)
- The **bottom floor's Roof toggle is disabled** — a floor with nothing below it can't be a roof; a roof dragged to the bottom clears automatically.
- The oversized-media warning lists floors by filename (stable) instead of an index that could go stale after a reorder.
- Enlarged hover previews no longer orphan on screen if the list rebuilds mid-hover.
- The stairs tool's "current level" detection now validates the level still exists on the scene.

# 0.0.12

## [Added]
- A **"DA Add Stairs / Elevator"** button is now injected into the Scenes sidebar next to the importer button, so the multi-level region tool is discoverable without typing `DA.AddRegion()`. Open (view) the imported scene, then click it and follow the dialog to place a stair/elevator region.

# 0.0.11

## [Added]
- A floor whose **filename contains "roof"** is now auto-detected and **pre-marked as Roof** (with a notification listing which), so a Dungeon Alchemist roof layer is handled without opening the advanced columns. It's just a default — review or change it under "Show advanced columns". Roof placement remains automatic (no elevation numbers to set); just make sure the roof is the top row.

# 0.0.10

## [Fixed]
- The **ⓘ info icon** now opens a readable help panel when clicked (the old hover tooltip didn't appear — Foundry suppresses plain `title` tooltips). The panel explains Roof / Start / Visible in plain language and makes clear that **most maps need none of them** and that roof placement is automatic.
- All Levels-tab tooltips (column headers, drag handle, thumbnail filename/size, roof, star) now use Foundry's tooltip system, so they reliably show on hover.

# 0.0.9

## [Added]
- **Drag-to-reorder floors**: drag a row by its **#** handle to change the stacking order. Bottom/Top elevations restack to the new order automatically, while each floor's **Name, Roof, Start, and Visible** settings travel with it — each floor now has a stable internal id, so edits survive reordering (and re-renders).

# 0.0.8

## [Added]
- The Levels tab now defaults to a **Basic view** (`#`, preview, Name, Bottom, Top). A **"Show advanced columns"** toggle reveals Roof / Start / Visible, with an ⓘ icon explaining when each is useful. Advanced settings stay in place even while hidden, so nothing is lost.

# 0.0.7

## [Added]
- The Levels tab now **pre-fills each level's Name with the original filename** (and shows it on the thumbnail tooltip alongside the file size), so you can tell which row is which floor.
- Every Levels-tab **column header has an explanatory hover tooltip**, and a help line clarifies that the defaults already stack floors correctly — you only edit a row to fine-tune.

# 0.0.6

## [Added]
- **Drag-to-draw region placement**: when placing a staircase/elevator region (`DA.AddRegion()`) you can now *drag* on the canvas to draw the region's footprint, with a live preview following the cursor, instead of only dropping a fixed square. A plain click still drops the default one-grid-square region. (Once placed, a region can be moved/resized with Foundry's native Region tools.)
- **Large-media warning** in the Levels tab: floors whose media exceeds Foundry's ~50 MB recommendation for animated maps get an amber outline + size tooltip and a one-line summary notification. Sizes are probed via a `HEAD` request for local sources (`data`/`public`) only.
- **Elevation validation**: import is blocked with a clear message when any level's bottom is ≥ its top.
- **Mixed-folder detection**: import warns when the selected folder appears to contain more than one map (multiple distinct base names), which would otherwise merge unrelated floors into one scene.

## [Fixed]
- Region rectangle shapes no longer carry the invalid `anchorX`/`anchorY`/`gridBased` fields (not part of v14's `RectangleShapeData`), and the region width/height are guarded to be strictly positive.

# 0.0.5

## [Added]
- The importer dialog now remembers your last-used **door texture, door sound, background color, grid opacity, and Copy Media toggle** per browser (a hidden client-scoped setting) and restores them on open.
- Video floors are previewed with a muted, looping **hover** player; the small row thumbnail sits paused on its first frame so a tall building doesn't run one video decoder per floor.
- Broken or undecodable floor media now shows a hatched placeholder (plus a console warning) instead of a blank thumbnail box.

## [Fixed]
- Wall **movement** restriction no longer emits the invalid value `10`: Foundry's `WALL_MOVEMENT_TYPES` defines only `NONE` (0) and `NORMAL` (20), so movement now maps to `0`/`20` while sight/sound keep the `0`/`10`/`20` (none/limited/normal) mapping.
- Removed `offsetX`/`offsetY`/`rotation` from each level's `textures` block — these were removed from Foundry's TextureData in v14.354.
- Lights are now stamped at their level's **resolved** bottom elevation (honoring per-level overrides) instead of a recomputed default.
- When a floor ships more than one media file (e.g. both `.jpg` and `.webp`), the importer now picks **deterministically** by a priority order (video > webp > png > jpg) instead of depending on the order files are listed.
- Unpaired files (a `.json` with no media, or media with no `.json`) are now logged to the console instead of being silently dropped.

## [Changed]
- Renamed the **"Copy Images to World"** toggle to **"Copy Media to World"** — it already handled video files.

# 0.0.4

## [Added]
- **Animated map support**: floors exported as video — `.webm` (plus `.mp4` / `.m4v`) — are now accepted alongside the existing image formats (`.jpg`, `.jpeg`, `.png`, `.webp`) and become animated Scene Level backgrounds. The Levels tab previews video floors with a muted, looping inline player (both the row thumbnail and the hover tooltip). If a floor ships both an image and a video for the same name, the video takes precedence.

# 0.0.3

## [Added]
- **Initial Level toggle** in the Levels tab: each row now has a star button (`★`/`☆`) in the new "Start" column. Only one level can be marked as initial at a time — clicking a star deactivates all others. The selected level is written to `initialLevel` on the created scene, controlling which floor is shown on first load. Defaults to level 0.

## [Added]
- **Visible Levels** column in the Levels tab: each level row now has a compact dropdown button (`— ▾` / `N ▾`) listing all other levels as checkboxes. Any levels checked will be included in that level's `visibility.levels` array on import, controlling which other floors are simultaneously visible when that level is active.
- Visible Levels and Is Roof work together: if both are configured, their results are merged (deduplicated) into a single `visibility.levels` array.
- **Levels tab** in the importer dialog: after selecting a folder, a new "Levels" tab is populated with one row per detected floor — thumbnail, editable name, and editable bottom/top elevation inputs.
- **Uniform floor height** field at the top of the Levels tab: changing this value recalculates all individual bottom/top inputs automatically, making it easy to set the same height for every level.
- `scripts/constants.js` with `MODULE_ID` and `FLOOR_HEIGHT` as shared module-wide constants.
- Per-level **Is Roof** toggle in the Levels tab: any level (except the first) can be flagged as a roof. The toggle carries a tooltip with the behavior description. Replaces the former global "Last Level is Roof" toggle.

## [Changed]
- Importer dialog width increased from 480 px to 620 px to accommodate the new Visible Levels column.

## [Fixed]
- Removed Foundry's default orange focus outline and glow from buttons inside the importer and region-adder dialogs; buttons elsewhere in the VTT are unaffected.

## [Removed]
- Global "Last Level is Roof" toggle from the Scene Defaults tab; superseded by the per-level roof toggle in the Levels tab.

# 0.0.2

## [Fixed]
- Level elevation ranges no longer overlap at boundaries: each floor above ground now starts at `i * FLOOR_HEIGHT + 1` (e.g., 0–10, 11–20, 21–30) instead of sharing the same value with the floor below.



## [Added]
- "Last Level is Roof" toggle (off by default): when enabled, the last imported level's `visibility.levels` is set to the id of the level directly below it, causing it to render only when that floor is active.

- Scenes directory sidebar button "DA Level Importer" injected below the search bar via the `renderSceneDirectory` hook for quick one-click access to `DA.Importer()`.
- Tabbed importer dialog: "Scene Defaults" and "Doors" tabs for organized settings.
- Door texture selector with 25 Foundry canvas door options; includes real-time preview with hover tooltip showing enlarged image.
- Door sound selector with 21 Foundry door sound options; includes play preview button to audition sounds before import.
- Automatic door texture and sound application: when importing, any wall with `door=1` receives the selected texture (with swing animation) and sound key.
- Multi-level region creation tool `DA.AddRegion()`: opens a dialog to configure a staircase/elevator transit region spanning multiple consecutive levels. User selects a starting level, specifies how many levels above and below should also have the region, then clicks on canvas to place. Single region document bound to all target levels with native `changeLevel` behavior.


