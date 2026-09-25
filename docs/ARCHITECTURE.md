# Architecture

How the module actually works, read from `scripts/`. Plain ES modules loaded
via `module.json`'s single `esmodules` entry (`scripts/main.js`); no build
step, no Foundry runtime in CI.

## Entry point

`scripts/main.js` runs on Foundry's `init` hook:
- registers the client-scoped `importerDefaults` setting (the importer
  dialog's remembered door/color/copy selections),
- builds the public API object and assigns it to
  `game.modules.get("dungeon-alchemist-toolkit").api`, aliased to
  `window.DA`,
- calls `registerToolkitEntries()` (`controls.js`) for the scene-controls
  button and the Module Settings menu entry,
- calls `registerPortalOverlayHooks()` and `registerPlayerPortalHooks()` to
  arm the GM and player canvas overlays,
- on `canvasReady`, re-renders an already-open Level Manager so it tracks the
  active scene.

### Public API (`window.DA` / `game.modules.get(...).api`)

| Call | Does |
|---|---|
| `DA.open()` | Opens the Level Manager dashboard (the toolkit's home). |
| `DA.Importer()` | Opens the importer dialog directly. |
| `DA.AddStairs()` / `DA.AddStairs({mode, label, twoWay})` | Guided stair/portal placement; with args, skips the type/label prompt. |
| `DA.LinkStairs()` | Links two selected Regions into a portal pair. |
| `DA.AddFloorToLink(linkId)` | Adds another floor to an existing stair link. |
| `DA.StairsManager()` | Opens the Stairs Manager panel. |
| `DA.AddRegion()` | Legacy multi-level `changeLevel` region tool (no toolbar button, still callable). |

All write paths are GM-gated via `requireGM()` (`scripts/util.js`), which
warns and no-ops for a non-GM caller.

## Importer (Dungeon Alchemist → Scene Levels)

- `floor-grouping.js` — pure, Foundry-free parsing of a folder of DA export
  files into ordered floor pairs (`collectFloorPairs`, `mapName`,
  `distinctMapStems`, `isVideoPath`, `toKebab`). This is the only module
  covered by `test/floor-grouping.test.mjs`, run with plain `node`.
- `da-importer.js` — `importFolder(...)` turns those pairs into one
  `Scene.create` call: one native Scene Level per floor, with walls, doors
  and lights bound to their floor via each document's `levels` field. Copies
  media into `worlds/<world>/da-imported/<map>/` when the "Copy Media"
  toggle is on.
- `importer-dialog.js` — the tabbed `DAImporterDialog` (ApplicationV2 +
  Handlebars) — Scene Defaults / Doors / Levels tabs, an in-window folder
  browser, per-floor thumbnails and elevation editing, and the large-media
  warning (`MEDIA_SIZE_WARN_BYTES` in `constants.js`).
- `floor-rows.js` — shared thumbnail-building helper used by both the
  importer dialog and the Level Manager.

## Level Manager (`dashboard.js`)

`DALevelManager` (ApplicationV2) is the toolkit's home window (`DA.open()`).
Left: the scene's floors, top-first, click to view. Right: the selected
floor's details and the stairs/portals attached to it. Three tabs: Floors,
Import, Stairs.

Floor edits go through `scene-levels-edit.js`, which always writes the
**complete** `scene.levels` array back (`scene.update({ levels })`) and reads
it back to check nothing was dropped:
- `updateLevel`, `moveLevel` (swap elevation band with the neighbor),
  `setStartLevel`, `replaceLevelImage`, `addLevel`, `removeLevel`.
- Writes are serialized through a promise chain (`_writeChain`) so two edits
  fired close together can't clobber each other with a stale read.
- Deleting a level or editing cross-level visibility is **not** reimplemented
  here — `openNativeLevels()` opens Foundry's native Levels tab for that.

Regions/portals bind to a floor by its Level `_id`, so renaming or
re-elevating a floor keeps its stairs attached.

## Stairs / portals (`scripts/portal/`)

Design background: `docs/STAIRS-PORTAL-DESIGN.md`. A **portal** is a native
v14 Region carrying a native `teleportToken` Region Behavior; this module
supplies what native lacks — linking, a manager UI, and overlays.

- `portal-core.js` — the data model and the only place that builds a
  `teleportToken` behavior payload. `buildTeleportBehavior` reads the live
  `CONFIG.RegionBehavior.dataModels.teleportToken.schema` and emits only the
  fields that schema declares, so it tracks whatever the running Foundry
  build actually supports. Mode presets (`MODE_PRESETS`): `stairs`
  (cross-level, confirm), `teleport` (same-level, confirm), `trap` (hidden,
  silent, one-way). A link is stamped as a
  `flags["dungeon-alchemist-toolkit"].portal` object (`{linkId, label, mode,
  role}`) on each participating Region. Also handles legacy-region adoption
  (`adoptLegacyRegion`) for stairs made by the old `DA.AddRegion` tool.
- `portal-wizard.js` — `addStairsInteractive` / `startAddStairs` run the
  guided placement (pick options → place entrance → switch floor → place
  exit, via a pinned `PlacementBanner`); `startLinkRegions` links two
  already-selected Regions directly; `addFloorToLink` extends an existing
  link to one more floor.
- `portal-manager.js` — `DAStairsManager`, a per-scene panel listing every
  portal link grouped by floor, with select-&-pan / edit / delete / add
  actions. Complements, not duplicates, the native Placeables tab.
- `portal-overlay.js` — GM-only canvas overlay: a colored ring per portal
  end, a translucent line + label between two ends on the same floor, and a
  "↑/↓ Floor" badge when the partner is elsewhere. Redraws on events
  (region CRUD, level change), never per frame.
- `portal-player-overlay.js` — a sight-gated "Stairs" hint label for players
  near a visible portal; it is a hint only — the move itself is native
  `teleportToken` firing on region entry.
- `portal-banner.js`, `portal-color.js`, `canvas-label.js` — supporting UI:
  the placement banner, a stable per-link color, and the shared PIXI
  label/badge builder used by both overlays.

Every overlay and canvas draw is feature-detected and try/catch-wrapped: a
guess that doesn't match the running Foundry build degrades to "no overlay,"
never a crash. See `docs/STAIRS-PORTAL-DESIGN.md` for the live-verification
list still open (tracked as issue #17).

## Legacy region tool

`region-adder.js` / `region-adder-dialog.js` implement `DA.AddRegion()`: a
single Region spanning several levels with a native `changeLevel` behavior
(same x,y on every level — it can't place a destination in a different
spot). Superseded by the stairs/portal system above; kept callable for
existing scenes. `canvas-pick.js`'s `pickCanvasRectangle` (click or drag to
place a footprint) is shared by this tool and the stairs wizard.

## Shared modules

- `constants.js` — `MODULE_ID`, `FLOOR_HEIGHT`, `PORTAL_FLAG`, setting keys,
  the media-size warning threshold.
- `levels.js` — `getSceneLevels`, `getCurrentLevelId`, `viewLevel`: the only
  place that reads/switches the active Scene Level.
- `util.js` — `t()` (i18n wrapper) and `requireGM()`.
- `controls.js` — registers the scene-controls toolbar button (one tool
  added to a native group, never a custom group — a custom group previously
  broke native floor selection) and the Module Settings menu entry, both
  opening the Level Manager.

## Templates & styles

`templates/*.hbs` (dashboard, importer, portal-manager, region-adder) pair
one-to-one with the ApplicationV2 classes above. All module CSS lives in the
single `styles/module.css` — no per-widget stylesheets.
