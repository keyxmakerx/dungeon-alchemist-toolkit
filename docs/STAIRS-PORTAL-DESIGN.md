# Stairs / Portal System: Design

Data model and rationale. File names, hooks and the public API are in
`docs/ARCHITECTURE.md`. Live verification is #17. The older one-region
`changeLevel` tool is retired; areas it made can be adopted.

## Decisions

- Go native. The movement engine is the native v14 `teleportToken` Region
  behavior on native Scene Levels; this module adds linking, management and
  overlays.
- No socketlib dependency. Native behaviors cover movement and confirm.
- The common stair is one action: a stairwell placed at the same spot on
  every floor it serves (`DA.AddStairs()`). Anything else is placed an end
  at a time, or made by linking two selected Regions (`DA.LinkStairs()`).
  There is no click-A-then-click-B toolbar mode.
- A stairwell is not a special kind of stair. It makes the same linked
  Regions as placing each end by hand, so every end can be moved, edited or
  deleted on its own afterwards.
- Editing is first-class through the Level Manager's Stairs tab, the one
  list of stairs.
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

Every link has a `linkId` stamped on each member. Regions made by the retired
`changeLevel` tool get a synthetic `legacy:` link id and are listed as "made
with the old tool", with **Adopt** (mint a `linkId`, keep the transit
behavior) and **Delete**.

## Native v14 surface

| Native feature | Stance |
|---|---|
| Scene Levels + Levels tab | Build on. Stairs target Levels; level editing beyond the Level Manager defers to the native tab (*Foundry's Levels tab*). |
| `viewLevel` / `cycleLevel` | Use for "switch to level" (`levels.js`). No custom level switching. |
| Regions V2 | Portals are Regions; any native shape works. |
| `TeleportToken` | The movement engine. |
| `ChangeLevel` | Not used for new stairs. Regions that carry it are listed and can be adopted. |
| `DefineSurface` | Not reimplemented. |
| Placeables tab | Not duplicated. The Stairs tab is stairs-only, cross-level, with linking. |
| Fog of war | Nothing to add. Foundry keeps explored fog per scene, floor and user, so a token that changes floor uncovers that floor's own fog. A teleport within one floor stays on one fog sheet. |
| Token movement and pathfinding | Used as they are for the players' click-to-walk (`Token#findMovementPath`, `TokenDocument#move`). |

## Creation and linking

**Stairwell** (`startStairwell`, the default): drag once on the floor being
viewed (click = one square, drag = footprint), then name the stair and tick
the floors it serves. The floors next to the one drawn on are ticked to start
with, and that floor cannot be unticked. The same rectangle is placed on each
ticked floor.

What a stairwell does not assume, and where each case goes:

- **The stair skips a floor.** Leave that floor unticked; the others are
  still joined to each other.
- **An end is slightly off on one floor.** Every end is its own Region, so
  it is nudged with Foundry's Region tools. *Go to* in the Stairs tab finds
  it.
- **The ends are in different places.** "Place each end myself" in the same
  box keeps the end already drawn as the entrance and runs the guided flow
  for the rest.
- **Both floors are on one image, side by side.** That is a teleport within
  one floor: the guided flow, kind *teleport*, both ends on the same floor.

**Guided flow** (`startAddStairs`): pick kind / name / two-way, place the
entrance, switch floor, place the next end, and so on, with the ends already
placed shown as ghosts; more floors can be added later (`DA.AddFloorToLink`).
`DA.LinkStairs()` links two already-selected Regions.

All of these end in `bindPortals`: mint or reuse the `linkId`, stamp the flag,
set the mode's color and visibility, and replace each member's teleport
behavior (a two-way link is a full mesh: every end reaches every other end).

## The stairs list

The Level Manager's Stairs tab lists every link in the scene (sorted by name)
with its kind and the floors it joins. Actions: go to an end (opens the scene
if needed, switches floor, pans, selects; pressing again goes to the next
end), edit the whole link (name, kind, two-way, each end's name as players
read it; saved through `bindPortals`), add a floor, adopt an old-tool region,
delete the whole link, add. Shape and elevation changes use the native Region
sheet. The Floors tab draws the same links as bars beside the floors they
join, and marks a floor that cannot be reached from the start floor.

## Player overlay

A label over a stair the player's own token is near and can see. Clicking it
walks that token to the stair: the path comes from Foundry's own pathfinder,
and the token is moved only when that path reaches the stair, so a wall or a
locked door stops the walk exactly as it would stop a drag. The click never
teleports anything itself; the stair fires as native `teleportToken` when the
token walks in. A player can already drag their own token onto a stair, so
the click grants nothing new. Hidden (trap) regions, and the far end of a
one-way stair, never show a label. With no pathfinder available the label is
a hint and moves nothing. Budget: own token only, current-level portals only,
proximity cull before the sight test, debounced on move.

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
4. **Click-to-walk:** if clicking a player label does nothing, or the token
   walks but the stair does not fire, it is `walkToStair` in
   `portal-player-overlay.js` (`Token#findMovementPath`,
   `TokenDocument#move`).
5. **Stairwell box:** if the box does not open beside the stair, or its
   Place button does not count the ticked floors, it is `promptStairwell` in
   `portal-wizard.js` (`DialogV2`'s `position` and `render` options).
