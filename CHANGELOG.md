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


