# Stairs / Portal System — Read-Only Audit

**Auditor scope:** the stairs/portal subsystem ONLY (see file list below). Importer, levels
edit, and security are out of scope except where they touch portals.

**Files audited**
- `scripts/portal/portal-core.js` — data model, create/link/delete, schema-adaptive `buildTeleportBehavior`
- `scripts/portal/portal-wizard.js` — place-then-link flow + direct-connect
- `scripts/portal/portal-manager.js` — Stairs Manager (ApplicationV2)
- `scripts/portal/portal-overlay.js` — GM link/ring overlay (PIXI)
- `scripts/portal/portal-player-overlay.js` — sight-gated player labels (PIXI)
- `scripts/region-adder.js`, `scripts/region-adder-dialog.js` — legacy `DA.AddRegion`/`changeLevel` + shared helpers
- `templates/portal-manager.hbs`, `templates/region-adder.hbs`, stairs rules in `styles/module.css`
- `scripts/main.js` (registration), `scripts/constants.js` (`PORTAL_FLAG`)

## Verification disclaimer

- **No Foundry runtime.** All findings are static: `node --check` (all 8 in-scope scripts parse
  clean), careful reading, and the official v14 API / issue tracker where reachable.
- `foundryvtt.com/api/*` doc pages return **HTTP 403** to the fetch tool, so leaf schema fields
  were confirmed from the **issue tracker, release notes, and the search index's rendered API
  excerpts**, not the rendered class page. Each finding is tagged **VERIFIED** (corroborated by an
  official/issue source quoted below) or **INFERRED** (reasoned from API shape, not directly
  confirmed).
- Key sources used:
  - teleportToken `destination` → `destinations` deprecation, `revealed`, random landing:
    foundryvtt/foundryvtt **#12842**, **#11115**, **#10695**, **#10887**; v14 release 14.349 notes.
  - `getSceneControlButtons` is now an **object keyed by name**, tools are a **record**, each tool
    needs `onChange`/`onClick`, new control categories have known core bugs: **#12761**, **#12258**,
    **#12903**, **#12904**, **#13814**, **#12803**.
  - Nav `viewLevel`/`cycleLevel`, `SceneViewOptions.level`, current level via `canvas.level?.id` /
    `game.user.viewedLevel`: v14 `SceneNavigation` API excerpt + release 14.354/14.356 notes.
  - `canvas.visibility.testVisibility(points, {object, tolerance})`: v14 `CanvasVisibility` API excerpt.

---

## Prioritized findings

Severity: **Critical** (breaks the feature or writes invalid data) · **High** (wrong behavior or
strategy-violating fragility) · **Medium** · **Low** (polish).

---

### S-01 — `buildTeleportBehavior` writes the **deprecated** `destination` (singular) on v14 and treats it as the primary path

- **Severity:** High
- **Location:** `scripts/portal/portal-core.js:151-173` (esp. `:161-169`); comments `:13-18`, `:138-143`.
- **Problem:** The code reads the live schema and, if `destination` exists, sets it; if `destinations`
  exists, sets that too. But its stated model — *"core v12–v14 uses a single `destination` UUID"* — is
  **wrong for v14**. **VERIFIED (#12842, v14 14.349):** `TeleportTokenRegionBehaviorType#destination`
  was **deprecated in favor of `destinations`** in v14 Prototype 1. On a current 14.x world the schema
  very likely exposes **both** (a deprecated shim + the real field) or **only `destinations`**. When
  both are present the current code sets both to consistent values, which is *probably* fine — but it
  is steering by a deprecated field name and its own comments will mislead the next maintainer into
  "fixing" it back toward the singular. If a future 14.x drops the singular shim and the schema-read
  path is the one taken, `hasField("destination")` goes false and only `destinations` is written —
  good — but the superset *fallback* branch (`:169`) still writes a bare `destination` that may be
  rejected/ignored.
- **Why it matters:** This is the headline verify-live item and the whole movement engine. Getting the
  field name wrong = token walks onto the stair and nothing happens.
- **Recommended fix (PATCH, small):** Flip the priority to **`destinations`-first** and make the
  comments say so. Prefer the plural whenever the schema declares it; only fall back to singular when
  the schema declares *only* `destination`. Sketch:
  ```js
  system = {};
  if (hasField("destinations"))      system.destinations = dests;        // v14 canonical
  else if (hasField("destination"))  system.destination  = primary;      // legacy/v13 shim
  if (hasField("choice"))            system.choice   = !!choice;
  if (hasField("revealed"))          system.revealed = !!revealed;
  // superset fallback: emit BOTH, plural first
  ```
  Keep the schema-read approach — see S-02 for the verdict on it overall.
- **Confidence:** High that the field was deprecated; Medium on exactly which fields a given 14.x build
  exposes (couldn't read the rendered schema page). Degrades safely either way *except* the fallback
  branch.

---

### S-02 — Verdict on the schema-adaptive `buildTeleportBehavior` approach: **sound, keep it**, with two caveats

- **Severity:** Medium (it's the right idea; caveats below)
- **Location:** `scripts/portal/portal-core.js:151-173`
- **Assessment:** Reading `CONFIG.RegionBehavior.dataModels.teleportToken.schema` and emitting only
  declared fields is **the correct, on-strategy pattern** ("degrade gracefully when native APIs
  differ", STRATEGY §3.6). A `DataModel` *does* silently drop unknown keys on construction, so the
  superset fallback is genuinely safe for *extra* keys. Two caveats:
  1. **`schema.has` vs `schema.fields`** — the feature-detect (`:157`) tries `schema.has?.(f)` then
     `schema.fields?.[f]`. **INFERRED:** a v14 `SchemaField` exposes `.fields` (a plain object) and a
     `.has(name)` method; both probes are plausible and the `||` makes it robust. Low risk.
  2. **The fallback can emit an invalid value, not just an extra key.** If the schema is unreadable
     (`:167-169`) it writes `destination: primary` *and* `destinations: dests`. Extra keys are
     dropped, but if `destination` (singular) survives as a **deprecated setter** it may emit a
     deprecation warning or, worse, a future build may type it differently. Pair this with S-01's
     "plural first" ordering.
- **Recommended fix (PATCH):** Keep the approach; apply S-01's ordering; add a one-line `console.debug`
  dumping `Object.keys(schema?.fields ?? {})` on first build behind a debug flag, so the live
  verify-step in `STAIRS-TESTING.md#1` is one console line instead of a manual dump.
- **Confidence:** High on the pattern being sound; Medium on the exact schema introspection surface.

---

### S-03 — Two-way links + multi-destination = native **random** destination selection (silent wrong-exit)

- **Severity:** High
- **Location:** `scripts/portal/portal-core.js:191-234` (`createLinkedStairs`), `:225-231` (return wiring);
  `:250-268` (`linkExistingRegions`).
- **Problem:** **VERIFIED (#12842, #11115):** when a teleport behavior has multiple `destinations` and
  `choice` is **off** (or names aren't `revealed`), native core picks **one destination at random**.
  Also **VERIFIED (#11115):** by default the token lands at a **random position inside** the
  destination region, *not* its center. For the standard 2-end pair this is fine (one destination,
  small square). But:
  - The doc/data model advertises **multi-destination groups** (`segments[1..]`, "add more
    destinations"). For a 3+ group with `choice:false` (e.g. a future trap-with-two-exits, or stairs
    where the GM disabled confirm), the token goes to a **random** end — surprising and undebuggable
    for the GM.
  - **Trap preset** sets `choice:false` (`MODE_PRESETS.trap`, `:33`). A trap is one-way today so it
    has a single destination — OK. But the moment anyone wires a multi-exit silent portal, it's random.
- **Why it matters:** "the up stairs may not be in the same location as the down stairs" is the whole
  reason this system exists; silent random landing/seledction undercuts trust in it.
- **Recommended fix (PATCH + doc):** (a) Document in `portal-core.js` that **multi-destination +
  `choice:false` = random by design (native)**; (b) when emitting a behavior with >1 destination, force
  `choice:true` unless the mode explicitly wants random; (c) for precise landing, plan to set the
  native **relative-position** option (#11115) once its field name is confirmed live — until then, keep
  destination footprints to ~1 grid square so "random within" ≈ the intended spot (the wizard's
  click-fallback already does this; warn when a *dragged* destination is large).
- **Confidence:** High (random landing + random selection are both documented native behavior).

---

### S-04 — `linkExistingRegions` always mints a **new** `linkId`; can't extend a group and silently breaks an existing link

- **Severity:** Medium
- **Location:** `scripts/portal/portal-core.js:250-268` (`:254` mints `linkId`); guarded upstream by
  `portal-wizard.js:164-169`.
- **Problem:** Direct-connect always creates a fresh `linkId` and stamps `role:"entrance"`/`"destination"`.
  The wizard refuses to link if **either** region already carries a portal flag (`_link`, `:166`), so
  you can't *add a third end* to an existing pair via direct-connect, and you can't re-link a region
  whose partner was deleted (orphan) without first manually clearing its flag via the native sheet.
  Combined with S-09 (orphan ends), the recovery path for a half-deleted link is "edit raw flags."
- **Why it matters:** The design (STAIRS-PORTAL-DESIGN §5) explicitly wants direct-connect to **extend**
  a group and to be the power-user editing path. This implementation can only ever create brand-new
  pairs.
- **Recommended fix (REWRITE the bind step):** Factor a single `bindPortals({regions, mode, label,
  twoWay})` used by *both* paths that: reuses an existing `linkId` if any input region already has one
  (else mint), upserts the flag, and **replaces** (not appends) the teleport behavior so re-linking is
  idempotent. The link-aware Manager (S-13) should drive this with an explicit "add end / re-link"
  action rather than the all-or-nothing wizard guard.
- **Confidence:** High (pure code reading).

---

### S-05 — Duplicate / un-deduped `teleportToken` behaviors on re-link; no replace-in-place

- **Severity:** Medium
- **Location:** `scripts/portal/portal-core.js:221-231`, `:260-267`; comment admits it `:240-242`.
- **Problem:** `createEmbeddedDocuments("RegionBehavior", [...])` **appends**. `linkExistingRegions` on a
  region that already had a teleport behavior (e.g. one created by the native UI, or a prior link) ends
  up with **two** teleport behaviors → the token teleports twice / to whichever fires, and the GM sees
  a confusing region sheet. The JSDoc notes "the caller may want to dedupe" but no caller does.
- **Why it matters:** Editing is supposed to be first-class; stacking behaviors is a classic
  hard-to-diagnose bug.
- **Recommended fix (PATCH):** Before creating, find existing `teleportToken` behaviors on the region
  (`region.behaviors.filter(b => b.type === "teleportToken")`) and either `update` the first or delete
  extras, then create exactly one. Bundle into the `bindPortals` refactor (S-04).
- **Confidence:** High.

---

### S-06 — Manager `viewLevel` uses **non-existent** v14 APIs (`ui.nav.viewLevel`, `canvas.scene.view`)

- **Severity:** High
- **Location:** `scripts/portal/portal-manager.js:39-44`; same gap in `getCurrentLevelId`
  (`scripts/region-adder.js:48-65`) and the overlays that call it.
- **Problem:** **VERIFIED (v14 `SceneNavigation` API + release 14.354/14.356):** v14 exposes
  **`SceneNavigation#viewLevel` / `#cycleLevel`**, `SceneViewOptions.level`, and `Scene#view(options)`
  accepting a `level`. The code instead probes `ui.nav.viewLevel` (the nav app is
  `ui.nav`/`game.scenes` — method name plausible but the doc'd accessor differs) and
  `canvas.scene.view({level})` — **`Scene#view` is not a function on the canvas's scene that takes
  `{level}` the way written**; the documented call is `scene.view(options)` where options carry the
  level, or the nav UI's `viewLevel`. As written, "Select & pan" likely **never switches floors**
  (it's the #2 verify-live flag). It's wrapped in try/catch so it degrades to pan-only.
- **Recommended fix (PATCH):**
  ```js
  async function viewLevel(levelId) {
    if (!levelId) return;
    const nav = ui.nav;                       // SceneNavigation
    if (typeof nav?.viewLevel === "function") return nav.viewLevel(levelId);
    const scene = canvas?.scene;
    if (typeof scene?.view === "function")    return scene.view({ level: levelId }); // SceneViewOptions.level
  }
  ```
  And replace `getCurrentLevelId`'s probe list with the **documented** order:
  `canvas.level?.id` → `canvas._viewOptions?.level` → `game.user?.viewedLevel` →
  `scene.initialLevel` → bottom level. (See S-07.)
- **Confidence:** High that `viewLevel`/`SceneViewOptions.level` exist; Medium on the exact accessor
  (`ui.nav` vs a static) — couldn't read the rendered method signature page (403).

---

### S-07 — `getCurrentLevelId` probes four **undocumented/likely-wrong** active-level paths

- **Severity:** High
- **Location:** `scripts/region-adder.js:48-65` (used by wizard `:105,:115`, overlay `:63`, player
  overlay `:122`, and the legacy dialog).
- **Problem:** Probes `canvas.scene.activeLevel`, `canvas.environment.activeLevel`,
  `canvas.activeLevel`, `game.user.activeLevel`. **INFERRED wrong:** the documented v14 surface is
  `canvas.level?.id`, `canvas._viewOptions?.level`, `game.user?.viewedLevel`
  (release 14.354/14.356 + community). None of the four probed names match the documented ones, so on a
  current build this falls through to **`scene.initialLevel` → bottom level every time**. Consequences:
  the wizard records the **wrong entrance/exit level** (it captures `getCurrentLevelId` *after* the GM
  manually switches floors — if detection is stuck on the bottom level, **both ends bind to the same
  level**, silently making "stairs" into a same-level teleport); the GM overlay draws on the wrong
  level; the player overlay shows labels for the wrong floor.
- **Why it matters:** This is arguably the **most damaging** latent bug: it corrupts the core data
  (which level each end is on) at creation time, and it's invisible until a live test.
- **Recommended fix (PATCH, then verify live):** Replace the candidate list with the documented names
  above; keep the `validIds` filter and the bottom-level fallback. This is the #2 verify-live flag and
  must be confirmed on a live world.
- **Confidence:** Medium-High — the documented accessors are corroborated by release notes and the
  community, but I could not open the rendered `Canvas`/`User` API page to confirm `_viewOptions` is
  the public path (the leading underscore suggests semi-private; prefer `canvas.level?.id` first).

---

### S-08 — Player overlay recreates **all** `PIXI.Text`/`Graphics` every refresh (perf), and is missing an active-level redraw hook

- **Severity:** Medium (perf) / High (correctness of the level gate)
- **Location:** `scripts/portal/portal-player-overlay.js:109-160`; `buildLabel` `:73-106`; hooks
  `:153-160`.
- **Problem (perf):** `refreshPlayerPortalLabels` destroys every child and **rebuilds a `PIXI.Text` +
  rounded-rect `Graphics` per visible portal on every call** (`:116`, `:132`). It's wired to
  `sightRefresh`, `updateToken`, `controlToken`, `createRegion/updateRegion/deleteRegion`, debounced
  120 ms (`:139-142`). `PIXI.Text` allocates a canvas texture per instance — cheap for a handful, but
  it churns GPU textures on every token step near stairs. The design budget (§11) says "own token,
  current level, proximity-cull before sight, debounce" — all present — but **not** "cache the label
  objects," which is the expensive part.
- **Problem (correctness):** `registerPlayerPortalHooks` has **no active-level-change hook** (the doc
  admits it). When the player switches floors *without* moving/selecting a token, the label set is
  stale (shows the old floor's stairs, hides the new floor's). Same gap in the GM overlay (S-11).
- **Recommended fix (PATCH → small REWRITE of the draw loop):**
  - **Cache by region id:** keep `Map<regionId, PIXI.Container>`; on refresh, reposition/show/hide
    existing containers and only build/destroy on actual add/remove. Rebuild text only when the label
    string changes.
  - **Recompute the cheap gates every refresh** (proximity, sight, level) but mutate `.visible` instead
    of destroying.
  - **Active-level redraw:** there is *no confirmed public hook* (INFERRED — couldn't find one in the
    docs). Options that degrade safely: (a) also `scheduleRefresh` on `canvasPan`/`refreshToken`;
    (b) if the importer/manager ever calls `viewLevel`, fire our own `Hooks.callAll("daLevelChanged")`
    and listen for it; (c) last resort, a low-frequency `canvas.app.ticker` check of `canvas.level?.id`
    that only redraws on change. Do **not** invent a core hook name.
- **Confidence:** High on the perf characterization and the missing-hook gap; Medium on the best
  level-change signal (no documented hook found).

---

### S-09 — `regionCenter`/`regionLevelId` assume a single **rectangle** shape and a single level; ellipse/polygon/multi-shape/multi-level portals silently misbehave

- **Severity:** Medium
- **Location:** `portal-core.js:90-103` (`regionLevelId`, `regionCenter`); duplicated verbatim in
  `portal-manager.js:18-32`.
- **Problem:** `regionCenter` reads `shapes[0]` and requires finite `x`/`width` — i.e. it only works for
  a **rectangle**. **VERIFIED (Scene Regions, Regions V2):** v14 regions support **rectangle, ellipse,
  polygon**, and Ring/Emanation. If a GM converts a portal region to an ellipse/polygon in the native
  sheet (which the design *encourages* — "defer authoritative editing to native"), `regionCenter`
  returns `null` → no overlay line, no player label, and `usePortal`'s nudge can't compute a target.
  `regionLevelId` takes only the **first** level of a multi-level region, so a portal a GM extends to
  span floors reports one arbitrary level.
- **Recommended fix (PATCH):** Prefer a native bounds/centroid if exposed (e.g. `region.bounds` /
  `region.object?.bounds` / `shape.bounds`) and fall back to the rectangle math; for ellipse use
  `{x + radiusX, y + radiusY}` etc. De-duplicate the two copies into `portal-core.js` and import them in
  the Manager (currently copy-pasted).
- **Confidence:** High that non-rectangle shapes break it; Medium on the exact native bounds accessor
  (couldn't open the RegionDocument API page).

---

### S-10 — `usePortal` click-to-use moves the **token's top-left to the entrance center**, fights native landing, and has no GM-authority / cooldown / range re-check

- **Severity:** High
- **Location:** `scripts/portal/portal-player-overlay.js:58-71`; called from `buildLabel` pointerdown
  `:101-104`.
- **Problem:** Several issues stack:
  1. **It nudges onto the ENTRANCE, relying on native enter to fire.** But the design's runtime flow
     (§8) and security model say the **GM** performs the move on a validated *request*; here the
     **player's client** does `token.document.update(...)` directly. A player generally **lacks
     permission to move a token onto a region** server-side unless they own it *and* it's their turn /
     allowed — and even then this is a client-authoritative write the strategy explicitly says to avoid
     ("we never trust client coordinates"). This likely **fails for real players** (no GM relay,
     `DialogV2.query`, socket, or `daPortal` companion exists — none of §8/§10 is implemented).
  2. **Centering math is off:** it sets `x = c.x - w/2` where `c` is the region center and `w` is token
     width in px — correct for placing the token's top-left so its center lands on the region center,
     but it ignores grid snapping and the token may not actually be *inside* the region rectangle if the
     region is smaller than the token.
  3. **No re-entry cooldown / range / sight re-validation at use time** (§8 steps 2–4 unimplemented), so
     a click can fire even after the token moved out of range between hover and click.
  4. **Random landing (S-03):** even when native teleport *does* fire, the token lands at a random spot
     in the destination, not the exit anchor.
- **Why it matters:** This is the headline player feature and, as written, it's the least likely part to
  work live and the most strategy-divergent (client-side scene write).
- **Recommended fix (REWRITE, but scope it):** Either (a) **drop click-to-use for v1** and ship only the
  native auto-on-enter path (honest, robust, matches "build on native") with the sight-gated label as a
  *hint* only; or (b) implement the §8 flow properly: player click → `Hooks`/socket request → GM
  validates owner+range+sight+cooldown → GM `token.update` → set `portalCooldown` flag. Given the
  strategy's "robustness over surface area," **(a) for now**, with (b) as a later phase behind a
  confirmed transport. This is the #4 verify-live flag.
- **Confidence:** High that the permission model is wrong for non-GM users; Medium on whether some
  systems' owners can self-move (varies), but the strategy forbids the client-write path regardless.

---

### S-11 — GM overlay: no active-level redraw, single shared Graphics is fine but level filter depends on the broken `getCurrentLevelId`

- **Severity:** Medium
- **Location:** `scripts/portal/portal-overlay.js:55-108`; `getCurrentLevelId` dependency `:63`.
- **Problem:** The overlay itself is well-built (one persistent `PIXI.Graphics`, `clear()` + redraw,
  `eventMode:"none"`, try/catch, teardown on `canvasTearDown`). Two issues: (1) it redraws on
  `canvasReady` + region CRUD but **not on level change** (same missing hook as S-08), so switching
  floors shows the previous floor's rings/line until a region edit; (2) its "current level" comes from
  the **broken `getCurrentLevelId`** (S-07), so the `onLevel` filter (`:67-71`) is likely always the
  bottom level — though the `!currentLevel` guard means if detection returns null it shows *everything*,
  which is arguably safer. With S-07 returning the bottom level (not null), cross-level pairs will draw
  rings only on the bottom floor.
- **Recommended fix (PATCH):** Fix S-07; add the same level-change redraw strategy as S-08; otherwise
  leave the drawing code as-is (it's the cleanest module in the set).
- **Confidence:** High.

---

### S-12 — The three-sidebar-button entry point scrapes `SceneDirectory` DOM (off-strategy, fragile) — the redo to a scene-controls group is correct

- **Severity:** High (strategy) / Medium (functional)
- **Location:** `scripts/main.js:49-84` (DOM injection into `.directory-header`/`.action-buttons`).
- **Problem:** Injecting three `<button>`s into the Scenes sidebar by `querySelector` on native classes
  is exactly the **"no native-DOM scraping"** the strategy forbids (STRATEGY §3.4; prior AUDIT C-1). If
  v14 renames those classes, **all stair entry points vanish silently**. It also puts canvas-editing
  tools (Add Stairs, Manager) in the *Scenes directory* rather than the *canvas toolbar* where region
  tools belong.
- **Why it matters:** Fragile and mis-placed; this is the sanctioned value-gap UX to rebuild.
- **Recommended fix (REWRITE → `getSceneControlButtons`):** Add a **custom control group** keyed by
  name with a `tools` record. **VERIFIED (#12903 example, #12761):**
  ```js
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    controls["da-toolkit"] = {
      name: "da-toolkit", title: "Dungeon Alchemist", icon: "fas fa-dungeon",
      order: Object.keys(controls).length,
      activeTool: "da-add-stairs",                 // see S-12a risk
      tools: {
        "da-import":  { name:"da-import", title:"Import DA Folder", icon:"fas fa-file-import",
                        button:true, order:0, onClick:() => DA.Importer() },
        "da-add-stairs": { name:"da-add-stairs", title:"Add Stairs / Portal", icon:"fas fa-stairs",
                        button:true, order:1, onClick:() => DA.AddStairs() },
        "da-manager": { name:"da-manager", title:"Stairs Manager", icon:"fas fa-diagram-project",
                        button:true, order:2, onClick:() => DA.StairsManager() }
      }
    };
  });
  ```
  Every tool **must** carry `onClick` or `onChange` or **core throws** (#12761). Keep the importer
  reachable too (the design's Import/Add Stairs/Manager hub).
- **S-12a risk — custom control GROUPS have live v14 core bugs.** **VERIFIED:** #12258 (tools in a new
  category are unusable due to an error on switching to it), #12904 (a `toggle` tool that is also
  `activeTool` won't toggle), #13814 (a control layer with no tools crashes), #12803 (switching from a
  custom control back to a core one errors). Mitigations: always provide ≥1 `button:true` tool, set a
  valid `activeTool` that exists in `tools`, avoid `toggle`+`activeTool` on the same tool, and pin a
  `compatibility.verified` build where this works. **Direct-connect** ("Link stairs") wants to be a
  *toggle* tool (click A then B) — given #12904, implement it as a **button** that starts a guided
  pick, not an `activeTool` toggle.
- **Confidence:** High on the hook shape and the requirement; High that custom groups are buggy in
  early 14.x (multiple open issues) — **this is the single biggest risk in the planned redo.**

---

### S-13 — Manager "Edit" just opens the native region sheet — **not link-aware** (the core UX complaint)

- **Severity:** High (this is the user's "terrible" pain point)
- **Location:** `scripts/portal/portal-manager.js:106-113` (`#onEdit` → `entry.region.sheet?.render`).
- **Problem:** "Edit" opens the **entrance region's** native sheet only. From there the GM sees raw
  `teleportToken` `destinations` UUIDs and our `daPortal` flag JSON — no way to rename the link, change
  mode, toggle two-way, re-pick the destination, or add/remove an end **as a link**. The Manager is a
  read-only index with delete; it does not deliver the "link-aware editing" the design promises
  (§6) and the user wants.
- **Why it matters:** This *is* the headline editing gap. Opening the native sheet for link semantics is
  "defer authoritative editing to native" taken too far — link grouping is *our* value-add and native
  has no concept of it.
- **Recommended fix (REWRITE the Manager's edit path):** Replace `#onEdit` with a small **link editor**
  (DialogV2 or an ApplicationV2 form) bound to the `linkId` that edits label/mode/twoWay and offers
  "re-pick destination" / "add end" / "go to partner" — writing through the `bindPortals` refactor
  (S-04/S-05). Keep a secondary "Open native region sheet" shortcut for shape/elevation. Also add the
  thumbnail + mode badge + one-way arrow the design lists (the `.hbs` already has mode badges; add the
  partner arrow). See "Redo opportunities."
- **Confidence:** High (pure reading + design doc).

---

### S-14 — The whole place-then-link flow relies on **transient toasts** + a **manual mid-flow floor switch**, with no ghost/banner (the "bad UX")

- **Severity:** High (UX) / the explicit reason for the redo
- **Location:** `scripts/portal/portal-wizard.js:90-134` (`startAddStairs`): `ui.notifications.info`
  prompts at `:97`, `:107`, `:129`; entrance level captured `:105`, dest level `:115`.
- **Problem catalog (what makes setup painful today):**
  1. **Modal → toast → click → manual floor switch → toast → click → toast.** The only guidance after
     the options dialog closes is **two `ui.notifications.info` toasts** that auto-dismiss in a few
     seconds. If the GM reads slowly or alt-tabs, the instruction is gone.
  2. **Manual floor switch mid-flow** (`:107` "now switch to the destination level…"). The flow does
     nothing to help — no level picker, no confirmation of which level got captured. Combined with the
     **broken `getCurrentLevelId`** (S-07), the captured `destLevel` may silently equal `entranceLevel`.
  3. **No ghost of the placed entrance.** After placing the entrance, the GM gets no persistent visual
     of where it went while hunting for the exit on another floor.
  4. **No way to back out of just the second step** without losing the first (it's two independent
     `pickCanvasRectangle` calls; cancelling step 2 discards step 1, `:112`).
  5. **No re-entrancy / state** — the flow is a straight-line async function; nothing prevents starting
     a second placement, and `pickCanvasRectangle`'s module-global `_pickInProgress` only guards the
     pick, not the wizard.
- **Recommended fix (REWRITE → guided, persistent placement):** Build a small **wizard controller** with:
  - a **persistent step banner** (a DOM element pinned to the canvas, not a toast) showing step N of M,
    a Cancel/Back button, and the chosen mode/label;
  - a **ghost** of the placed entrance (reuse the `pickCanvasRectangle` preview Graphics, but keep it on
    canvas, dimmed, until done);
  - an **in-flow destination-level picker** (a dropdown in the banner that calls the fixed `viewLevel`
    (S-06)) so the GM never hunts for the native nav, and the captured level is **explicit**, not
    inferred — this also sidesteps S-07 for *creation*;
  - explicit Back that re-opens step 1 without losing state.
  This is the sanctioned value-gap and directly addresses the "terrible" verdict.
- **Confidence:** High.

---

### S-15 — `MODE_PRESETS.trap` sets `hidden:true` for the region, but the entrance ghost/label gating and `revealed:false` need a live confirm; trap is silent by `choice:false` only

- **Severity:** Low-Medium
- **Location:** `portal-core.js:30-34`, `:209-211` (`hidden: preset.hidden && i === 0`).
- **Problem:** Trap hides only the **entrance** (`i === 0`), leaving the destination visible — sensible.
  Player overlay correctly skips `region.hidden` (`portal-player-overlay.js:126`). But: (1) `hidden`
  on a RegionDocument controls **player visibility of the region highlight** — **INFERRED** it does not
  by itself suppress the native confirm dialog; silence relies entirely on `choice:false`. If a build
  defaults `choice` differently, a "trap" could prompt. (2) `revealed:false` for trap is harmless
  (no choice). Low risk but worth a live check alongside S-01.
- **Recommended fix (PATCH):** Add a comment that trap silence = `choice:false` (not `hidden`), and
  verify on the live confirm test. No code change required if the schema-read sets `choice:false`.
- **Confidence:** Medium (depends on native `choice` default).

---

### S-16 — Legacy `region-adder.js` `changeLevel` behavior emits `system: {}` and `displayMeasurements`; `pickCanvasRectangle` is shared and load-bearing

- **Severity:** Medium (legacy) — see "Legacy verdict"
- **Location:** `scripts/region-adder.js:254-284` (region payload, `changeLevel` `:275-283`);
  `pickCanvasRectangle` `:88-204`.
- **Problem:** Prior AUDIT (A-5) flagged `changeLevel` `system: {}` as fragile (empty system may fail as
  the schema gains required fields). The legacy tool also can't reach a different (x,y) on the
  destination — **VERIFIED** this is the core limitation that motivated portals (STAIRS-PORTAL-DESIGN
  §1). However, `pickCanvasRectangle`, `getSceneLevels`, `getCurrentLevelId` live in this file and are
  **imported by the entire portal system** (`portal-wizard.js:12`, `portal-core.js:22`,
  `portal-manager.js:14`, both overlays). So `region-adder.js` cannot simply be deleted — its helpers
  are the portal foundation.
- **Recommended fix:** See "Legacy verdict" below.
- **Confidence:** High.

---

### S-17 — `pickCanvasRectangle` draws into **`canvas.controls`** with PIXI v7 immediate-mode; fragile to PIXI v8 / canvas refactor (shared with overlays)

- **Severity:** Medium
- **Location:** `scripts/region-adder.js:88-204` (preview on `canvas.controls`, `:131-135`, immediate-mode
  `:115-119`); same `canvas.controls`/`canvas.interface` + immediate-mode assumption in
  `portal-overlay.js:28-40,77-89` and `portal-player-overlay.js:44-56,93-95`.
- **Problem:** **INFERRED:** `canvas.controls` and `canvas.interface` are real v14 layers and PIXI v7's
  `lineStyle/beginFill/drawRect/endFill` is current, but none are public-API guarantees; a PIXI v8 bump
  (deprecates immediate-mode Graphics in favor of `.rect().fill()`) or a canvas layer rename breaks all
  three overlays at once. All are feature-detected + try/catch → degrade to "no preview/overlay," never
  a crash (this is verify-live flag #5, and the safe-degradation claim is **VERIFIED** by reading the
  guards).
- **Recommended fix (PATCH, low priority):** Centralize the "get a Graphics on a canvas layer" + draw
  primitives in one helper so a future PIXI/layer change is a one-file fix; consider the native
  `canvas.regions` preview / interaction layer if it exposes a drawing affordance (would remove this
  surface entirely — on-strategy). Not urgent; it degrades safely.
- **Confidence:** High on the shared fragility; Medium on the exact future-break trigger.

---

### S-18 — `regionUuid` hand-builds a UUID fallback that may be wrong; embedded-doc UUIDs vs relative UUIDs

- **Severity:** Low-Medium
- **Location:** `scripts/portal/portal-core.js:42-44`.
- **Problem:** Falls back to `` `Scene.${region.parent.id}.Region.${region.id}` `` if `region.uuid` is
  absent. **VERIFIED (#12228):** v14 teleport behaviors now use **relative UUIDs** so a scene can be
  exported under a different id without breaking. A hard absolute `Scene.<id>.Region.<id>` defeats that
  portability if it's ever used in place of the real `.uuid`. In practice `region.uuid` is always
  present on a created embedded document, so the fallback is dead code — but if it ever triggers it
  writes a non-relative, non-portable reference.
- **Recommended fix (PATCH):** Trust `region.uuid` (created docs always have it); if you need a
  fallback, throw rather than fabricate, so a missing uuid is loud, not silently non-portable.
- **Confidence:** Medium (relative-UUID behavior is documented; whether core stores the literal you pass
  or re-derives a relative one on save is unconfirmed).

---

### S-19 — Manager `#onGoto` calls `region.object?.control(...)`; `region.object` is null when the Regions layer isn't active / off-current-level

- **Severity:** Low
- **Location:** `scripts/portal/portal-manager.js:95-103` (`:102`).
- **Problem:** `region.object` (the placeable) only exists when that region is rendered on the **active
  layer and current level**. After `viewLevel` switches floors, the placeable for the target region may
  not be instantiated yet (async render), so `control()` no-ops. Wrapped in try/catch → harmless, but
  "Select & pan" often won't actually select. Pan also uses `regionCenter` which is null for
  non-rectangles (S-09).
- **Recommended fix (PATCH):** After `viewLevel`, await a tick / `canvasReady`-ish settle, or activate
  the Regions layer first (`canvas.regions?.activate?.()`) before `control()`. Low priority.
- **Confidence:** Medium.

---

### S-20 — Minor data-model / consistency nits

- **Severity:** Low
- **Locations & items:**
  - `portal-core.js:119-129` omits `displayMeasurements` while `region-adder.js:262` includes it —
    harmless (inherits default) but inconsistent; pick one.
  - `portal-core.js:111-114` sets the portal region's elevation to the **whole level band**
    `{bottom, top}`. A token at any elevation in the band triggers it — fine for stairs, but a "trap"
    that should only fire at floor level will also fire for flying tokens mid-band. **INFERRED**;
    confirm whether enter-events are elevation-banded.
  - `portal-wizard.js:152-157` `startLinkRegions` reads `canvas.regions.controlled`; if the Regions
    layer isn't the active control layer this may be empty even when regions are visually selected.
    Document the "be on the Regions layer" precondition (the toast at `:158-161` partly does).
  - Label default chain `portal.label || region.name || "Stairs"` (`player-overlay.js:132`) is fine, but
    `region.name` defaults to the *label* at creation (`portal-core.js:122` `name: flag.label`), so a
    GM renaming the region in the native sheet silently changes the player label — probably desirable,
    worth noting.
- **Confidence:** High (reading); Medium on the elevation-band trigger semantics.

---

## Redo opportunities (the user wants to "redo as much as possible early")

Ranked by value-for-risk. **Bias: less custom surface, more native.**

1. **Entry point → `getSceneControlButtons` group (S-12).** REWRITE. Deletes the DOM-scraping
   (`main.js:49-84`), is on-strategy, and creates the "Dungeon Alchemist" hub. **Gate on S-12a** (custom
   control groups are buggy in early 14.x — verify on the target build, provide a button tool +
   `activeTool`, avoid toggle+activeTool). This is the foundation for the rest of the UX redo.

2. **Guided, persistent placement (S-14).** REWRITE the wizard from a straight-line toast script into a
   small controller with a **persistent banner + entrance ghost + in-flow level picker**. The level
   picker also **sidesteps the broken `getCurrentLevelId` for creation** (capture the level the GM
   explicitly chose, not an inferred one) — fixing the most damaging latent bug (S-07) *for the path
   that writes data*.

3. **Link-aware Manager edit (S-13) + a single `bindPortals` core (S-04/S-05).** REWRITE `#onEdit` into a
   link editor; refactor create/link/relink/dedupe into one idempotent function. This is the headline
   editing fix and also makes direct-connect able to *extend* groups.

4. **Decide click-to-use honestly (S-10).** For v1, **REWRITE to drop the client-side move** and ship
   native auto-on-enter + a sight-gated *hint* label; defer real click-to-use to a later phase with a
   confirmed GM-relay transport. Removes the least-likely-to-work, most strategy-divergent code.

5. **Fix the level APIs (S-06/S-07) and consolidate shape/level/center helpers (S-09).** PATCH. Small,
   high-value, and unblocks the overlays and the Manager. Move `getSceneLevels`/`getCurrentLevelId`/
   `pickCanvasRectangle` into a neutral `scripts/levels.js` + `scripts/canvas-pick.js` (the design's §13
   file plan) so the portal system stops importing from `region-adder.js`.

6. **Player + GM overlay: cache labels, add a level-change redraw (S-08/S-11).** PATCH→small REWRITE of
   the player draw loop (cache `PIXI.Container` by region id); add a safe level-change redraw signal (no
   invented hook).

**Net effect:** after 1–3 the user's "terrible setup/editing" is directly addressed; after 4–6 the
runtime is honest about what's native vs ours and the overlays are correct and cheap.

---

## Legacy `DA.AddRegion` / `changeLevel` verdict (audit question 5)

**Recommendation: RETIRE the `changeLevel` tool's *UX* (the dialog + `createMultiLevelRegion`), KEEP and
RELOCATE its helpers, and FOLD the one useful bit (multi-level span binding) into the portal flow as an
option — do not keep a parallel transit system.**

Reasoning:
- The `changeLevel` tool **cannot reach a different (x,y)** on the destination floor — **VERIFIED** the
  exact limitation portals were built to fix (STAIRS-PORTAL-DESIGN §1). Keeping a second, weaker transit
  tool violates "no parallel systems" (STRATEGY §3.4) and confuses the UX.
- `createMultiLevelRegion`'s `system: {}` for `changeLevel` is a latent validation risk (prior AUDIT
  A-5), and the dialog (`region-adder-dialog.js`) is dead weight (no button; only `DA.AddRegion()`).
- **But** its concept — *one region bound to a contiguous span of levels* — is genuinely useful for the
  case "this shaft connects floors 1–4 at the same spot." Fold that into the portal model as a
  **"same-spot multi-floor" preset**: either (a) keep using native `changeLevel` *as one behavior* inside
  the portal data model when the GM picks "same spot, just change floor," or (b) generate N teleport ends
  at the same x,y across the span. Prefer (a) — it's strictly more native and free.
- **Must keep:** `getSceneLevels`, `getCurrentLevelId`, `pickCanvasRectangle` are imported across the
  whole portal system. Move them to neutral modules (S-16, redo #5) *before* deleting the dialog, then
  delete `region-adder-dialog.js` + `templates/region-adder.hbs` + its CSS and the `AddRegion` API entry.

---

## Verify-live flags

Every place the code depends on an unconfirmed v14 API, with failure mode. (Maps to and extends
`STAIRS-TESTING.md`.)

| # | Location (`file:line`) | Assumes | If wrong, failure mode | Degrades safely? | Confidence |
|---|---|---|---|---|---|
| V1 | `portal-core.js:155-169` | `teleportToken` schema field names; singular `destination` is current | **VERIFIED deprecated in v14** → must prefer `destinations`. Wrong field = walk-on does nothing | Partly — schema-read path OK; fallback emits singular | High (deprecation) / Med (exact live fields) |
| V2 | `portal-core.js:161-166` | `schema.has()` / `schema.fields[]` introspection works | If neither probe works, falls to superset fallback (may emit invalid singular) | Yes (fallback) | Medium |
| V3 | `portal-manager.js:39-44` | `ui.nav.viewLevel` / `canvas.scene.view({level})` | **Likely both wrong** → "select & pan" never switches floors | Yes (pan-only) | High |
| V4 | `region-adder.js:48-65` | `canvas.scene.activeLevel` / `canvas.environment.activeLevel` / `canvas.activeLevel` / `game.user.activeLevel` | **Likely all wrong** (docs say `canvas.level?.id` / `game.user.viewedLevel`) → wrong level captured at creation; both ends may bind same level | Falls back to bottom level → silent wrong data | High |
| V5 | `portal-player-overlay.js:35-42` | `canvas.visibility.testVisibility(point, {object})` | **VERIFIED signature correct** (`testVisibility(points,{object,tolerance})`); risk is semantics (elevation/level) | Yes (`return true` on throw → shows) | High signature / Med semantics |
| V6 | `portal-player-overlay.js:58-71` | Player client may `token.document.update` to fire native enter | **Likely fails for non-GM** (no permission / strategy-forbidden) → click does nothing | Yes (warn toast) | High |
| V7 | `portal-overlay.js:28-40`, `player-overlay.js:44-56`, `region-adder.js:131-135` | `canvas.controls` / `canvas.interface` exist; PIXI v7 immediate-mode | PIXI v8 / layer rename → no overlay/preview | Yes (feature-detected) | High |
| V8 | (absent) `player-overlay.js:153-160`, `portal-overlay.js:102-108` | No active-level-change hook exists | Overlays/labels stale after floor switch with no token move | Yes (stale, not crash) | High (gap) / no documented hook found |
| V9 | `portal-core.js:111-114` | Portal elevation = whole level band triggers enter at any elevation | Flying/mid-band tokens trigger traps unexpectedly | n/a (behavioral) | Medium |
| V10 | `portal-core.js:42-44` | Hand-built `Scene.x.Region.y` UUID acceptable | Non-portable absolute UUID if fallback ever used (v14 prefers relative) | Dead code in practice | Medium |
| V11 | `main.js` redo target | `getSceneControlButtons` custom **group** works on target 14.x | **Known core bugs** (#12258/#12904/#13814/#12803) → group tools unusable / switch errors | Depends — can crash the controls if misconfigured | High (bugs exist) |

---

## Top 5 priorities

1. **Fix the level APIs (S-06, S-07 / V3, V4).** `getCurrentLevelId` and the Manager's `viewLevel`
   reference v14 paths that almost certainly don't exist; the former **silently captures the wrong
   level at stair-creation time** (both ends can bind the same floor). Switch to the documented
   `canvas.level?.id` / `game.user.viewedLevel` and `SceneNavigation#viewLevel` / `Scene#view({level})`,
   then confirm live. Highest-damage, lowest-effort.

2. **Rebuild setup as guided persistent placement + scene-controls hub (S-14, S-12).** Replace the
   toast-script wizard with a **banner + entrance ghost + in-flow level picker**, and the three
   DOM-scraped sidebar buttons with a `getSceneControlButtons` "Dungeon Alchemist" group. This is the
   sanctioned value gap and the user's "terrible" verdict. **Gate the controls group on the known v14
   core bugs (S-12a/V11)** — verify on the target build, use button tools + a valid `activeTool`, avoid
   toggle+activeTool.

3. **Make the Manager link-aware and unify create/link/relink (S-13, S-04, S-05).** "Edit" must open a
   **link editor** (label/mode/two-way/re-pick/add-end), not the raw native region sheet; back it with a
   single idempotent `bindPortals` that reuses link ids, replaces (not appends) teleport behaviors, and
   lets direct-connect extend groups.

4. **Correct the teleport payload + landing semantics (S-01, S-03 / V1).** Emit **`destinations` first**
   (the v14 canonical, plural) and fix the misleading comments; document that multi-destination +
   `choice:false` = **native random** selection/landing, force `choice:true` for >1 destination, and keep
   destination footprints small until the relative-position option is wired.

5. **Be honest about click-to-use and cache the overlays (S-10, S-08, S-11 / V6, V8).** The player
   click-to-use does a **client-side token move** that likely fails for real players and violates the
   strategy — for v1, ship native auto-on-enter + a sight-gated *hint* label, and add the GM relay later.
   While there, **cache the player label `PIXI.Container`s by region id** (stop rebuilding `PIXI.Text`
   every refresh) and add a safe active-level redraw signal to both overlays.

---

*End of audit. No source files were modified.*
