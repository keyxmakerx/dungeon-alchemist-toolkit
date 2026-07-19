# DA Level Importer — Roadmap / TODO

Notes for upcoming work. **Nothing here is implemented yet** — these are captured
requirements to pick up in a future session (current state is v0.0.12 on branch
`claude/festive-newton-i8l7nk`).

## 0. Post-0.5.0 audit follow-ups (non-blocking)

Surfaced by the pre-merge audit that shipped the 0.5.0 folder-import fix. All are
real but non-blocking (the merge verdict was *go-with-fixes*; the P0 blockers —
folder grouping, dialog order/override contract, version bump — are done).

- **Level deletion integrity** (`scripts/scene-levels-edit.js`, `removeLevel`): when
  the removed floor is the scene's `initialLevel`, reassign `initialLevel` to a
  surviving floor in the *same* `scene.update` so it never persists a dangling level
  `_id`. Also confirm v14 cascades a `levels[]` replace to portal Regions bound by
  `regionLevelId` (and rebind/warn if it does not).
- **Add-floor empty-path guard** (`scripts/dashboard.js`, `#onAddFloor`): guard the
  FilePicker callback with `if (!path) return;` (as `#onReplaceImage` already does) so
  an empty pick can't append a blank floor. Add a `game.user.isGM` short-circuit at the
  top of each exported write task in `scene-levels-edit.js` (defense in depth).
- **Grid minimum** (`scripts/da-importer.js`): validate/clamp DA `grid` against the v14
  minimum (historically 50px) before `Scene.create` — needs a live-v14 confirmation of
  the exact value.
- **Canvas info-card** (`scripts/portal/portal-overlay.js`): on region hover-out with an
  active pin, re-show the pinned card; hide the card when `worldToClient()` returns null.
- **Dead code / stale docs**: retire `scripts/hub.js` + `templates/hub.hbs` and their
  hub-only i18n keys (superseded by the Level Manager dashboard); refresh README/roadmap
  wording (this file still says "v0.0.12") and mark the stranded-branch references in
  `docs/CANVAS-PLAN.md` / `docs/audits/*` as historical.

## 1. Overall UI refresh
- Give the importer dialog a more pleasant, polished, "refreshed" look and feel.
- Applies across the whole tool, not just one tab.

## 2. Unify the stairs tool into the importer ("all in one")
- The stairs/region tool (`DA.AddRegion()`) is currently a **separate dialog**.
  Integrate it **into the DA importer** so it's one unified tool, not a second
  window. Stairs should feel seamless / native to the importer.

## 3. Edit existing scenes, not just create on import
- Add an **"edit the current level system"** function: open the DA tool on an
  already-imported scene and edit its levels (names, order, elevations, roof,
  start, visible, etc.) — i.e. edit "the current page", not only build a new
  scene at import time.
- Goal: edit **both the levels and the stairs** of an existing scene, easily,
  from the same refreshed UI.

## 4. Stairs UX: "click and then edit" (not multi-step buttons)
- Current flow is too many steps (click "Place on Canvas" → click the canvas →
  reopen to change anything).
- Wanted: **click to place, then edit it inline/easily** — the stairs selector
  must be directly editable, not a chain of "click button, click another button".

## 5. Multilevel stairs + player choice
- When placing a stair, **ask whether it's multi-level**.
- If multi-level, **let the player choose how they travel** at runtime (which
  direction / which floor to go to) when a token uses the stairs — rather than a
  fixed single-step `changeLevel`.
- Implementation pointer: likely a custom Region behavior / a runtime prompt
  dialog (Foundry's built-in `changeLevel` only moves one level; "Teleport Token"
  needs a destination). A "pick your destination floor" dialog on enter is the
  shape of this.

## Summary of the core asks
1. Seamlessly **integrate stairs into the DA importer**.
2. The DA importer can **edit the current scene's levels** (not just import).
3. **Easy editing** of both the stairs and the level system.
4. **Overall UI refresh**.
