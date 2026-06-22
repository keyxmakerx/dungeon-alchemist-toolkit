# DA Level Importer — Implementation Plan

Grounded in three investigations (2026): a full codebase audit, a Foundry v14
scene/level-editing + UI validation, and a Foundry v14 region-behavior/player-choice
validation. Current state: **v0.0.14** on branch `claude/festive-newton-i8l7nk` —
Phase 0 (state-capture fix) and Phase 2 *edit existing scenes, v1* (in-place rename /
re-elevate / reorder / visibility) are implemented; the rest below is not yet built.

---

## Findings that shape the whole plan

1. **State-capture gap is a prerequisite bug (audit A1/A2).** The per-floor edit
   model (`_levelState`, uid-keyed) is only written on reorder / floor-height change,
   **never on a full ApplicationV2 re-render**, and `#onImport` reads the live DOM by
   index rather than the state store. Harmless today (nothing calls `this.render()`
   after edits) — but **every roadmap item that edits a live scene or adds runtime
   behavior introduces such a re-render, which silently wipes unsaved Levels edits.**
   Fix this first.

2. **Editing existing scenes is clean and safe.** A Scene's `levels` are **embedded
   `Level` documents**. Use `scene.updateEmbeddedDocuments("Level", [{_id, …}])` for
   rename/re-elevate and rewrite `sort` to reorder — **always in-place by `_id`**, which
   keeps every wall/light/region `levels` binding valid with **zero re-binding**. Rules:
   never delete+recreate a level (mints a new `_id`, orphans bindings); re-point
   `initialLevel` before deleting a level; deleting a level cascades to tokens/placeables
   inside it (v14 >= 14.361).

3. **UI refresh has a concrete target.** The dialog hand-rolls its tabs; v14
   ApplicationV2 has a built-in tab system (`static TABS` / `_prepareTabs` / `changeTab`,
   auto-bound clicks on `[data-tab][data-group]`), plus `DialogV2` and
   `foundry.applications.fields.*` form helpers. Adopting these is the backbone of the
   refresh and removes manual wiring (also resolves audit A5).

4. **Player-choice stairs must be BUILT — it is not core.** Core `changeLevel` is
   intentionally minimal ("no extra configuration") and just moves a token to the same
   area on the neighbouring level. The rich floor-picker UX (target-level modes, chosen
   levels, "allow choice") is a **third-party module (regionba), not core Foundry.**
   For a self-contained feature we implement our own prompt.
   - **Mechanism:** built-in `executeScript` behavior (script with `event`/`region`/
     `scene`/`behavior` in scope; `event.data.token` = mover) on `tokenEnter`. **But the
     script runs `gmOnly` on the GM client**, so a naive Dialog shows on the GM's screen,
     not the player's. Route the prompt to the triggering player via a **socket**
     (socketlib or `game.socket`), collect their pick with `DialogV2.wait()`, then have
     the GM apply `token.update({ elevation: chosenLevel.elevation.bottom })`.
   - Graduate to a **custom `RegionBehaviorType`** (registered via
     `CONFIG.RegionBehavior.dataModels`) later for a configurable sheet.

5. **Click-then-edit is trivially supported.** After
   `const [region] = await scene.createEmbeddedDocuments("Region", [...])`, call
   `region.sheet?.render(true)` to open `RegionConfig` immediately.

6. **Source caveat:** the v14 Level data model and the core `changeLevel` `system`
   schema are NOT in the community type defs (they track v13). The **Level half is now
   confirmed** against the official v14 API (`foundry.documents.Level`, the v14 flagship
   feature): schema is `_id, name, elevation, background, foreground, fog, textures,
   visibility, sort (IntegerSortField), flags` — which matches the importer's create and
   update payloads, so `updateEmbeddedDocuments("Level", …)` and the `sort` reorder are
   valid. The `changeLevel`/region `system` specifics (Phase 5) remain snippet-inferred —
   **verify those on a live v14 world before shipping** (see checklist).

---

## Recommended sequencing

| Phase | Goal | Depends on | Risk |
|---|---|---|---|
| **0** | Prerequisite hardening (audit A1-A8) | - | Low, high-value |
| **1** | UI refresh -> native ApplicationV2 tabs + form helpers | 0 | Medium (re-test all wired controls) |
| **2** | Edit an existing scene's levels (**keystone**) | 0, 1 | Medium-High |
| **3** | Unify the stairs tool into the importer | 2 | Medium |
| **4** | "Click then edit" stairs UX | 3 (or standalone) | Low-Medium |
| **5** | Multilevel stairs + runtime player choice | - (mostly independent) | High (socket/permissions) |

Phase 5 is the most independent — if the player-choice stairs are the priority, it can
be tackled earlier, but it carries the most runtime/permission risk.

---

## Phase 0 — Prerequisite hardening

- **A1/A2 (Critical):** make `_levelState` authoritative. Add `input`/`change` listeners
  on row inputs that write straight into `_levelState`, and/or `_captureRowState()` at
  the top of any render and of `#onImport`. Have `#onImport` read from `_levelState`
  (capture-then-read) rather than the raw DOM.
- **A3:** uniform-height change unconditionally restacks Bottom/Top — either document it
  as an intentional "reset all elevations" action or only restack default-valued rows.
- **A4:** roof flag's *meaning* (`i-1`) changes silently on reorder; a roof dragged to
  index 0 becomes a no-op. Scrub/warn on reorder, or store the roof's target by uid.
- **A5:** move static-form listeners into `_onFirstRender` (bind once) — also unblocks
  the UI refresh.
- **A6/A7/A8 (Medium):** oversize-notification indices go stale after reorder; enlarged
  hover tooltips can orphan on `document.body` during a mid-hover rebuild; `getCurrentLevelId`
  doesn't validate the id still exists. Small, targeted fixes.

## Phase 1 — UI refresh (native tabs + form helpers)

- Replace the hand-rolled `.da-tab-btn`/`.da-tab-panel` system with `static TABS` +
  `tabGroups` + `_prepareTabs` (clicks auto-bind via the action system; delete manual
  listeners).
- Adopt `foundry.applications.fields.createFormGroup` / `createMultiSelectInput` where it
  simplifies (e.g. the per-level "visible levels" control currently built by hand).
- Refresh CSS/layout under `#da-importer`, preserving Foundry theme `var(--color-*)`.
- **Risk:** every `querySelector` is coupled to current markup — full re-test of each
  wired control. Do this on top of Phase 0 (so re-renders don't lose edits).

## Phase 2 — Edit an existing scene's levels (keystone)

- **Entry:** `DA.EditCurrent()` + a button / scene-context action; operates on
  `canvas.scene`.
- **Read path:** hydrate the dialog from `scene.levels` (reuse `getSceneLevels`). Map each
  level -> a row keyed by the real level **`_id`** (not a media uid): name, `elevation
  .bottom/top`, derive `isRoof`/`visible` from `visibility.levels`, `initialLevel` ->
  the start star. Edit-mode rows skip the thumbnail/size/copy machinery (read the
  thumbnail from `level.background.src`).
- **Write path:** `scene.updateEmbeddedDocuments("Level", …)` for edits, `sort` rewrite for
  reorder, `createEmbeddedDocuments`/`deleteEmbeddedDocuments` for add/remove — **all
  in-place by `_id`** so placeable bindings survive. Re-point `initialLevel` before any
  delete; warn about the delete cascade.
- **Central design risk:** unify two level identities in one dialog — create-mode
  (uid/media, pre-create) vs edit-mode (`_id`/live scene). Keep the state model generic
  over an id; branch only on read/write.
- **Hard dependency on Phase 0** (this mode will call `this.render()` to refresh).

## Phase 3 — Unify the stairs tool into the importer

- Keep `region-adder.js` as the UI-free engine (already pure). Add a **"Stairs" tab** to
  the importer that calls `pickCanvasRectangle`/`createMultiLevelRegion` against the
  **active scene** (so it only applies in edit-mode — Phase 2).
- Move `#computeTargetLevelIds`/limit/preview logic in; read levels from the live scene.
- Hide-not-close the dialog during canvas pick (current flow closes first). Collapse to a
  single sidebar button.

## Phase 4 — "Click then edit" stairs

- Invert `#onPickLocation`: place the region, then `region.sheet?.render(true)`
  immediately (confirmed supported), instead of a multi-step pre-config + close flow.
- Optionally a compact inline editor for level-binding + behavior so the common edits
  don't require the full RegionConfig.

## Phase 5 — Multilevel stairs + runtime player choice

- **Placement:** add an "Is this multi-level?" toggle. When on, attach a runtime-choice
  behavior to the region (which already carries all target levels in `levels`).
- **Runtime (v1 — pragmatic):** built-in `executeScript` behavior bound to `tokenEnter`.
  Because it runs `gmOnly`: GM script -> **socket to the triggering player** -> `DialogV2
  .wait()` floor picker (built from the region's bound levels) -> return choice -> GM
  applies `token.update({ elevation: chosenLevel.elevation.bottom })`. Debounce to avoid
  re-entry loops (the move can re-fire enter).
- **Runtime (v2):** migrate to a custom `RegionBehaviorType` via
  `CONFIG.RegionBehavior.dataModels` for a proper config sheet + persisted `system` data.
- **Dependencies:** a socket layer (recommend `socketlib`, or a guarded `game.socket`
  channel) registered at `init` in `main.js`; GM-side authorization of every relayed
  move; backward-compat for existing single-`changeLevel` regions.

---

## Live-v14 verification checklist (before shipping each phase)

- ✅ **Confirmed** — Level field names per the official v14 API (`foundry.documents.Level`):
  `_id, name, elevation, background, foreground, fog, textures, visibility, sort, flags`.
- A placeable's `.levels` Set field name on Wall/AmbientLight/Region (Phase 2/3).
- `scene.update({ levels })` replace-vs-merge semantics; whether elevation edits need a
  `canvas.draw()` (issue #13595) (Phase 2).
- `CONFIG.RegionBehavior.dataModels.changeLevel.schema` — is `system: {}` valid? (Phase 5).
- `executeScript` in-scope variable names (`event`/`region`/`scene`/`behavior`) and
  `event.data.token` (Phase 5).
- `gmOnly` execution -> confirm the Dialog truly needs the socket hop (Phase 5).
- Token elevation band edges (inclusive/exclusive) when landing on `level.elevation.bottom`
  (Phase 5).

## Security (from the audit checklist)

- Render existing scene/level names via `textContent`/attributes only — never `innerHTML`
  (a legacy scene name with markup must not become an injection sink in edit-mode).
- Validate/clamp elevations before `scene.update` (reuse `#onImport` validation);
  block delete of a level still referenced by placeables (diff + re-bind or block).
- Gate all scene/embedded writes behind `game.user.isGM`.
- Phase 5 runtime: treat region/behavior fields as untrusted (no `eval`/`Function`/
  `innerHTML` from data); the GM socket relay must authorize each move (requesting user
  may move that token; target level belongs to the region); debounce re-entry; no new
  `fetch` to non-Foundry hosts.
