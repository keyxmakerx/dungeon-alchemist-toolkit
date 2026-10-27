# Stairs / Portal System: Design

Data model and rationale. File names, hooks and the public API are in
`docs/ARCHITECTURE.md`. Live verification is #17; a real click-to-use is #18.
Supersedes the legacy `DA.AddRegion()` tool (`region-adder*.js`), kept for old
scenes.

## Decisions

- Go native. The movement engine is the native v14 `teleportToken` Region
  behavior on native Scene Levels; this module adds linking, management and
  overlays.
- No socketlib dependency. Native behaviors cover movement and confirm.
- Linking: a place-then-link wizard (`DA.AddStairs()`) and linking two
  selected Regions (`DA.LinkStairs()`). There is no click-A-then-click-B
  toolbar mode.
- Editing is first-class through the Stairs Manager.
- Do not duplicate the native Levels tab or Placeables tab.

## Why not `changeLevel`

`changeLevel` moves a token to the same (x, y) on the adjacent level, so up
and down stairs cannot sit in different places. A stair must store a
destination position, not only a destination level.

## Model

A **portal** is a Region with a `teleportToken` behavior pointing at its
linked Region(s). Linked portals form a group sharing a `linkId`.

| Mode | Meaning | Preset (`MODE_PRESETS`) |
|---|---|---|
| `stairs` | Link across levels | confirm, destination name revealed, visible |
| `teleport` | Link on the same level | confirm, destination name revealed, visible |
| `trap` | One-way, auto on enter | silent, hidden, no return behavior |

The module's own data is one region flag,
`flags["dungeon-alchemist-toolkit"].portal` = `{ linkId, label, mode, role }`
(`role` is `entrance` or `destination`). Everything else lives in the native
behavior and the Region. `buildTeleportBehavior` (`portal-core.js`) is the only
place that builds the behavior payload; it reads the live schema and emits only
fields it declares (plural `destinations` preferred). More than one destination
forces the picker so native never chooses at random. Region visibility to
players is the native `hidden` field.

Every link has a `linkId` stamped on each member. Legacy `changeLevel` regions
get a synthetic `legacy:` link id and are shown tagged **legacy** with
**Adopt** (mint a `linkId`, keep the transit behavior) and **Remove**.

## Native v14 surface

| Native feature | Stance |
|---|---|
| Scene Levels + Levels tab | Build on. Stairs target Levels; level editing beyond the Level Manager defers to the native tab (*Open Scene Config*). |
| `viewLevel` / `cycleLevel` | Use for "switch to level" (`levels.js`). No custom level switching. |
| Regions V2 | Portals are Regions; any native shape works. |
| `TeleportToken` | The movement engine. |
| `ChangeLevel` | Legacy same-spot floor change only. |
| `DefineSurface` | Not reimplemented. |
| Placeables tab | Not duplicated. The Stairs Manager is stairs-only, cross-level, with linking. |

## Creation and linking

Wizard: pick type / label / two-way, place the entrance (click = one square,
drag = footprint), switch floor, place the exit, optionally add floors
(`DA.AddFloorToLink`). `DA.LinkStairs()` links two already-selected Regions.
Both end in `bindPortals`: mint or reuse the `linkId`, stamp the flag, set the
mode's color and visibility, and replace each member's teleport behavior (a
two-way link is a full mesh: every end reaches every other end).

## Stairs Manager

`DA.StairsManager()` lists every link on the scene (sorted by label) with its
mode and the level of each end. Actions: go to an end (switches level, pans,
selects), edit the whole link (rename, mode, two-way; saved through
`bindPortals`), adopt a legacy region, remove (deletes the whole link), add.
Shape and elevation changes use the native Region sheet.

## Player overlay

A sight-gated hint label only: clicking it does not move the token. A
client-side move by a player would bypass GM authority, so using a stair is
always the native walk-in `teleportToken`. Hidden (trap) regions never show a
label. Budget: own token only, current-level portals only, proximity cull
before the sight test, debounced on move.

## GM overlay

On `canvasReady`, level change and Region CRUD: a ring per portal end, a
translucent line plus label between ends on the same level, and an arrow badge
("Floor 2") when the partner is on another level. Redraws on events, never per
frame.

## Live-v14 verification

`teleportToken`'s schema, the level-view API and the LOS test are
feature-detected, so a wrong guess degrades to "no overlay", not a crash.
Confirming them in a live world is #17. If a check fails, report:

1. **Schema:** if the move or confirm never fires, dump
   `Object.keys(CONFIG.RegionBehavior.dataModels.teleportToken.schema.fields)`.
2. **Level-view API:** if select-and-pan does not switch floors, or the GM
   link line shows on the wrong level, name the live "view this level" call
   (`viewLevel`, `levels.js`).
3. **LOS test:** if player labels show through walls or never show, it is
   `hasSight` in `portal-player-overlay.js` (`canvas.visibility.testVisibility`).
