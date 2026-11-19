# Architecture

Plain ES modules loaded via `module.json`'s single `esmodules` entry
(`scripts/main.js`); no build step, no Foundry runtime in CI.

## Entry point

`scripts/main.js` runs on Foundry's `init` hook:
- registers the client-scoped `importerDefaults` setting (the import
  window's remembered door/color/copy selections),
- builds the public API, assigned to `game.modules.get(MODULE_ID).api` and
  aliased to `window.DA`,
- calls `registerToolkitEntries()` (`controls.js`) for the toolbar button,
  the Scenes sidebar button and menu entry, and the Module Settings entry,
- calls `registerDropImport()` (`drop-import.js`) for the folder drop,
- calls `registerPortalOverlayHooks()` and `registerPlayerPortalHooks()` to
  arm the GM and player canvas overlays,
- on `canvasReady`, re-renders an already-open Level Manager so it tracks the
  scene being viewed.

### Public API (`window.DA` / `game.modules.get(...).api`)

| Call | Does |
|---|---|
| `DA.open()` / `DA.open({sceneId, tab})` | Level Manager; `sceneId` pins it to a scene that need not be on the canvas, `tab: "stairs"` opens the stairs list |
| `DA.Importer()` / `DA.Importer({source, path})` | Import window; with a path, opened on that folder |
| `DA.AddStairs()` | A stairwell in one go: drag once, tick the floors |
| `DA.AddStairs({mode, label, twoWay})` | Each end placed by hand, skipping the options prompt |
| `DA.LinkStairs()` | Links two selected Regions |
| `DA.AddFloorToLink(linkId)` | Adds a floor to an existing link |
| `DA.StairsManager()`, `DA.AddRegion()` | Retired windows: both open the Level Manager's Stairs tab and say so once |

Write paths are GM-gated via `requireGM()` (`scripts/util.js`), which warns and
no-ops for a non-GM caller.

## Importer (Dungeon Alchemist → Scene Levels)

- `floor-grouping.js` — pure, Foundry-free parsing of a folder of DA export
  files into ordered floor pairs (`collectFloorPairs`, `mapName`,
  `distinctMapStems`, `isVideoPath`, `toKebab`, `safeDecode`, `isRoofName`). Covered by
  `test/floor-grouping.test.mjs`, run with plain `node`.
- `da-importer.js` — `importFolder(...)` turns those pairs into one
  `Scene.create` call: one native Scene Level per floor, with walls, doors
  and lights bound to their floor via each document's `levels` field. Copies
  media into `worlds/<world>/da-imported/<map>/` when the "Copy Media"
  toggle is on. Its pure wall mapping (`_senseEnum`, `_mapWall`: DA's one
  `sense` value drives both sight and light; door and secret door are kept)
  is covered by `test/da-importer-sense.test.mjs`.
- `importer-dialog.js` — the one-page `DAImporterDialog` (ApplicationV2 +
  Handlebars): an in-window folder browser that folds away once floors are
  found (local sources, or an S3 bucket reached through Foundry's file
  picker), the floor rows with the street-level picker, a folded "Scene and
  door options" section, and the large-media warning
  (`MEDIA_SIZE_WARN_BYTES` in `constants.js`). After an import it opens the
  new scene and the Level Manager.
- `floor-naming.js` — pure: what a floor is called and how high it sits,
  counted from the street-level floor (`floorKind`, `floorRange`). Street
  level starts at 0, floors below it are below zero, and no two floors share
  a height. Covered by `test/floor-naming.test.mjs`.
- `drop-files.js` — pure: whether a drag from the desktop could be an export
  (`looksLikeExportDrag`), which dropped files make up floors
  (`exportFileNames`) and a safe folder name (`safeFolderName`). Covered by
  `test/drop-files.test.mjs`.
- `drop-import.js` — the folder drop. Capture-phase `dragover` / `drop`
  listeners on the document, GM only, that claim a drop only when it holds a
  folder or loose files that pair into floors and is not over Foundry's file
  picker; every other drop is left untouched. The files are uploaded into
  `worlds/<world>/da-imported/<map>/` and the import window opens there.
- `floor-rows.js` — the thumbnail builder for the import window's floor rows.

A scene imported with more than one floor carries a `todo` flag
(`TODO_FLAG`), which is what makes the Level Manager show its "Left to do"
list; the flag is cleared when every floor can be reached or the list is
hidden.

## Level Manager (`dashboard.js`)

`DALevelManager` (ApplicationV2) is the home window (`DA.open()`), with two
tabs. **Floors** draws the building from the side: a slab per floor, top
first, and a bar per stair beside the floors it joins, with the selected
floor's controls underneath. **Stairs** is the one list of every stair,
teleport and trap in the scene (go to, edit, add a floor, adopt, delete).
Every edit saves as it is made. With no scene open, or a scene with no
floors, it shows the way into the import instead.

The window follows the scene being viewed, or stays on one scene when opened
with `{sceneId}` (the Scenes sidebar's "Floors and stairs" entry); a scene
that is not on the canvas can still be edited, and anything that needs the
canvas opens the scene first. An open Level Manager re-renders when floors,
regions or their behaviors change (`main.js`), unless a field in it is being
typed in.

`building.js` holds the picture's logic, pure and covered by
`test/building.test.mjs`: `assignLanes` gives each stair a column so no two
bars overlap (longest first, capped, the rest counted rather than drawn),
and `unreachableFloors` walks the stairs from the start floor to find floors
a party cannot get to. A trap is never counted as a way in, and a one-way
stair only leads away from its entrance.

Floor edits go through `scene-levels-edit.js`. A Level is an embedded Scene
document, so each edit is an embedded create / update / delete that names
only the floor it touches; a build without embedded Level documents gets a
whole-array `scene.update({ levels })` instead, checked afterwards for
dropped floors:
- `updateLevel`, `moveLevel` (swap elevation band with the neighbor),
  `setStartLevel`, `replaceLevelImage`, `addLevel`, `removeLevel`.
- Writes are serialized through a promise chain (`_writeChain`) so two edits
  fired close together can't clobber each other with a stale read.
- `removeLevel` moves the start floor to a surviving floor before it deletes.
- The start floor is read with `getInitialLevelId` (`levels.js`):
  `scene.initialLevel` is the Level document, the stored value is its id.
- Editing cross-level visibility is **not** reimplemented here —
  `openNativeLevels()` opens Foundry's native Levels tab for that.
- Covered by `test/scene-levels-edit.test.mjs` against a stand-in Scene.

Regions/portals bind to a floor by its Level `_id`, so renaming or
re-elevating a floor keeps its stairs attached.

## Stairs / portals (`scripts/portal/`)

Design background: `docs/STAIRS-PORTAL-DESIGN.md`. A **portal** is a native
v14 Region carrying a native `teleportToken` Region Behavior; this module
supplies what native lacks — linking, a list to manage them, and overlays.

- `portal-core.js` — the data model and the only place that builds a
  `teleportToken` behavior payload. `buildTeleportBehavior` reads the live
  `CONFIG.RegionBehavior.dataModels.teleportToken.schema` and emits only the
  fields that schema declares, so it tracks whatever the running Foundry
  build actually supports. Mode presets (`MODE_PRESETS`): `stairs`
  (cross-level, confirm), `teleport` (same-level, confirm), `trap` (hidden,
  silent, one-way). A link is stamped as a
  `flags["dungeon-alchemist-toolkit"].portal` object (`{linkId, label, mode,
  role}`) on each participating Region. Also handles adoption
  (`adoptLegacyRegion`) of areas made by the retired `changeLevel` region
  tool, and
  `unlinkDeletedPortal`, which the active GM runs on `deleteRegion` to take a
  deleted end out of the other ends' destinations.
- `portal-wizard.js` — placing stairs. `startStairwell` is the default:
  one drag on the floor being viewed, then a `DialogV2` beside the stair to
  name it and tick the floors it serves; the same rectangle is placed on
  every ticked floor and joined. `addStairsInteractive` / `startAddStairs`
  are the guided flow for everything else (ends in different places, a
  teleport within one floor, a trap): pick options, then place each end a
  floor at a time under a pinned `PlacementBanner`. The stairwell box hands
  over to it with the end already drawn. `startLinkRegions` links two
  already-selected Regions directly; `addFloorToLink` extends an existing
  link to one more floor.
- `portal-overlay.js` — GM-only canvas overlay: a colored ring per portal
  end, a translucent line + label between two ends on the same floor, and a
  "↑/↓ Floor" badge when the partner is elsewhere. Redraws on events
  (region CRUD, level change), never per frame.
- `portal-player-overlay.js` — the players' stair labels: shown over an end
  their own token is near and can see, that has an active transit behavior
  (never either end of a trap). Clicking one asks Foundry's pathfinder
  (`Token#findMovementPath`) for a way there and, only if the path reaches
  the stair, moves the player's own token along it with
  `TokenDocument#move`. The stair itself is still native `teleportToken`
  firing on region entry. With no pathfinder the label is a hint only.
- `portal-banner.js`, `portal-color.js`, `canvas-label.js` — supporting UI:
  the placement banner, a stable per-link color, and the shared PIXI
  label/badge builder used by both overlays.

Every overlay and canvas draw is feature-detected and try/catch-wrapped: a
mismatch with the running Foundry build degrades to "no overlay", never a
crash. Open live checks (#17): `docs/STAIRS-PORTAL-DESIGN.md`.

## Shared modules

- `constants.js` — `MODULE_ID`, `FLOOR_HEIGHT`, `PORTAL_FLAG`, setting keys,
  the media-size warning threshold.
- `levels.js` — `getSceneLevels`, `getCurrentLevelId`, `viewLevel`: the only
  place that reads/switches the active Scene Level.
- `canvas-pick.js` — `pickCanvasRectangle`: click or drag on the canvas to
  place a footprint, used by both ways of placing stairs.
- `util.js` — `t()` (i18n wrapper) and `requireGM()`.
- `controls.js` — the ways in, all GM only: the toolbar button (one tool
  added to a native group, never a custom group: custom groups break native
  floor selection), the import button at the top of the Scenes sidebar, the
  "Floors and stairs" entry in a scene's right-click menu
  (`getSceneContextOptions`), the Module Settings entry, and the two client
  settings that switch the toolbar button and the folder drop off.

## Templates & styles

`templates/dashboard.hbs` and `templates/importer.hbs` pair with the two
ApplicationV2 classes above. All module CSS lives in the single
`styles/module.css` — no per-widget stylesheets.

The windows take Foundry's own look: the toolkit sets no surface or text
colours of its own, and draws its hairlines and quiet text by mixing from
the text colour Foundry gives the window, so they read in the light and the
dark theme alike. Its own colours are one accent and the state colours
(`--da-*` at the top of the stylesheet, a light and a dark set). Pieces that
float over the map (the placement banner, the drop zone, hover cards) are
always dark, like Foundry's tooltips.
