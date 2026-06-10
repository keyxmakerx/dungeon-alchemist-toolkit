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


