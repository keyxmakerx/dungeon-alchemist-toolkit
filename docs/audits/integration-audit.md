# Cross-Cutting Integration Audit — Dungeon Alchemist Toolkit (v14)

**Auditor lens:** native-v14 integration quality, robustness/security, lifecycle/leaks,
public API surface, modernization, packaging, and module-wide perf. Sibling audits cover
the importer pipeline and the stairs/portal feature internals; this report deliberately
takes the **integration/robustness angle** and avoids feature-by-feature correctness.

**Scope:** all of `scripts/` (entry: `scripts/main.js`), `module.json`, with supporting
reads of `templates/*.hbs` and `styles/module.css`.

**Branch:** `claude/gracious-goodall-ukqsio`. Module version `0.1.0`.

---

## Verified / Inferred disclaimer

There is **no Foundry runtime** in this environment. Every `scripts/**/*.js` file passes
`node --check` (VERIFIED — all 11 files clean). Behavioral claims about Foundry APIs were
checked against official **v14** API docs and changelogs where reachable, and are tagged:

- **VERIFIED** — confirmed against an official v14 source (foundryvtt.com API docs /
  release notes) or by direct static read of this repo.
- **INFERRED** — reasoned from API shape, v13→v14 continuity, or code structure; not
  executed. Treated conservatively (a wrong guess should degrade, not crash).

Network egress to `foundryvtt.com/api/*` via WebFetch returned **HTTP 403**; I confirmed
the API shapes below from the official docs' indexed/summarized text (search excerpts that
quote the v14 doc pages verbatim) plus the official v14 release notes. Where a single
authoritative page could not be opened directly, the item is marked **INFERRED** and the
uncertainty called out. No API names were invented.

Key external confirmations:
- **`getSceneControlButtons` (v13+/v14):** the hook argument is an **object keyed by
  control name** (not the legacy v12 array). Each control exposes `name`, `order`, `title`,
  `icon`, `visible`, `tools` (`Record<string, SceneControlTool>`), `activeTool`, `onChange`.
  A tool has `name`, `title`, `icon`, `order`, `button`, `toggle`, `active`, `visible`,
  `onChange`. A tool with **neither `onChange` nor `onClick` throws** in core. GM-gating is
  `visible: game.user.isGM`. (VERIFIED from the v14 `getSceneControlButtons` hook doc +
  foundryvtt issues #12761, #13814.)
- **`renderSceneDirectory` (v14):** SceneDirectory is ApplicationV2-based; the render hook
  passes a **native `HTMLElement`** (not jQuery). (VERIFIED — matches `renderApplicationV2`
  signature `(app, element, context, options)`; the module already treats `html` as an
  Element.)
- **PIXI version in v14:** Foundry **stayed on PIXI v7** for v14 (did not adopt v8). So the
  immediate-mode Graphics API (`beginFill`/`lineStyle`/`drawRect`) is correct **today** but
  is deprecated in PIXI v8 and is the canonical future-break point. (VERIFIED — v14 release
  notes / foundry issue #11183.)
- **ApplicationV2 `static TABS` / `PARTS` / `DEFAULT_OPTIONS.actions`:** all are documented
  v14 patterns; the action delegation map and `PARTS` are already used correctly here.
  (VERIFIED for PARTS/actions by read; `static TABS` adoption is the gap — see F-13.)

---

## Prioritized findings

Severity: **Critical** (data-loss / security / silent total failure) · **High** (breaks a
core flow when an assumption shifts) · **Medium** (fragility / strategy violation) ·
**Low** (polish / hygiene).

---

### F-1 — No GM-gate on any write path (Critical) — STRATEGY §3.6

- **Location:** `scripts/main.js:19-30` (API factory), `:38-40` (`window.DA`),
  `:49-84` (sidebar buttons); write sinks: `scripts/da-importer.js:324` (`Scene.create`),
  `scripts/portal/portal-core.js:213,221,227,260,264,280` (`createEmbeddedDocuments` /
  `deleteEmbeddedDocuments` / `setFlag`), `scripts/region-adder.js:286`.
- **Problem:** The strategy mandates *"GM-gate every scene write"* (STRATEGY §3.6, §7;
  HANDOFF §6). **Nothing in the module checks `game.user.isGM` before writing.** The only
  `isGM` checks anywhere are in the two *presentation* overlays
  (`portal-overlay.js:56`, `portal-player-overlay.js:110`). A non-GM who opens the importer
  (its button is injected for everyone — `renderSceneDirectory` has no GM guard), or types
  `DA.AddStairs()` / `DA.Importer()` in console, will attempt `Scene.create` and
  `createEmbeddedDocuments`. Core will usually reject the socket op server-side, but the
  user-facing result is an **unhandled permission rejection / confusing error toast**, and
  the module is leaning on core enforcement rather than enforcing its own contract.
- **Why it matters:** Direct violation of a named strategy guardrail. "Degrade gracefully /
  GM-gate writes" is the whole robustness posture; relying on the server to bounce a write
  the UI shouldn't have offered is exactly the fragile coupling the strategy forbids.
- **Recommended fix (PATCH):** (a) Gate the three sidebar/scene-control entries on
  `game.user.isGM` (also see F-3 migration). (b) Add a single guard helper at each public
  API entry, e.g. at the top of `addStairsInteractive`/`startAddStairs`/`startLinkRegions`/
  `importFolder` and the `Importer`/`AddRegion` factories:
  ```js
  if (!game.user.isGM) { ui.notifications.warn("DA Toolkit: only a GM can do that."); return null; }
  ```
  Keep it centralized (one `requireGM()` in `constants.js` or a small `util.js`) so every
  write path shares one check. Confidence: **High** (static; the absence is unambiguous).

---

### F-2 — Sidebar buttons injected by DOM-scraping `SceneDirectory` markup (High) — STRATEGY §3.4

- **Location:** `scripts/main.js:49-84` (`renderSceneDirectory` → `querySelector(".directory-header")`, `.action-buttons` ?? `.header-actions`, `insertBefore`). CSS coupling: `styles/module.css:2-9`.
- **Problem:** Three buttons are built and spliced into native sidebar DOM by class
  selectors. The strategy is explicit: *"Integrate through documented points … **No parallel
  systems, no scraping native DOM**"* (STRATEGY §3.4; AUDIT §C.1 already flagged this). If
  v14's directory markup renames `.directory-header`/`.action-buttons`, the `if (!header)
  return` guard means **all three entry points silently vanish** — the importer becomes
  reachable only from console. It degrades quietly (good that it does not crash) but the
  failure is *invisible*, which is worse for a primary CTA.
- **Why it matters:** This is the module's main discoverable surface. A silent disappearance
  on a point release is a support nightmare and the canonical example the strategy warns
  against.
- **Recommended fix (REWRITE → `getSceneControlButtons`):** Move Import / Add Stairs /
  Stairs Manager into a native scene-controls group (see the dedicated migration note
  below). That is the documented extension point, is GM-gateable via `visible`, and cannot
  be broken by sidebar markup churn. Keep the importer *also* reachable from the Scenes
  directory only if a documented hook/affordance exists (it adds discoverability for an
  import action that is conceptually a directory operation) — but build that on a documented
  footing too, not class scraping. Confidence: **High**.

---

### F-3 — `innerHTML` used to build the injected buttons (Low, but XSS-adjacent hygiene)

- **Location:** `scripts/main.js:60,66,73` (`btn.innerHTML = '<i …></i> text'`).
- **Problem:** The strings are **fully static literals**, so there is *no* injection vector
  today (VERIFIED — no interpolation). It is flagged only because (a) it is the one
  remaining `innerHTML` in the module's own code outside the `= ""` clear-idiom, and (b) if
  these buttons move to `getSceneControlButtons` the `innerHTML`/icon handling goes away
  entirely. Note the data-driven label/size text elsewhere already correctly uses
  `dataset.tooltip`/`textContent` and explicitly avoids `innerHTML`
  (`importer-dialog.js:358,365-375`) — good.
- **Why it matters:** Hygiene + consistency; removes a foot-gun before someone makes the
  label dynamic.
- **Recommended fix (PATCH):** Moot after F-2 migration. If kept interim, build with
  `document.createElement("i")` + `textContent`. Confidence: **High** (no live risk; purely
  preventive).

---

### F-4 — Six global hooks registered at `init`, **never removed**; closures capture nothing scene-scoped but layers can leak across worlds (Medium)

- **Location:** `scripts/main.js:33-35` (`registerPortalOverlayHooks`,
  `registerPlayerPortalHooks`); definitions `portal-overlay.js:102-108`,
  `portal-player-overlay.js:153-160`.
- **Problem:** `registerPortalOverlayHooks` adds 4 persistent hooks
  (`canvasReady`, `canvasTearDown`, `createRegion`/`updateRegion`/`deleteRegion`);
  `registerPlayerPortalHooks` adds 6 (`canvasReady`, `canvasTearDown`, `controlToken`,
  `updateToken`, `sightRefresh`, plus 3 region hooks). These are correct to register once and
  leave (module-lifetime), so non-removal is **acceptable** here (INFERRED-OK). The real
  lifecycle question is teardown of what they *create*: the PIXI overlay
  (`portal-overlay.js`) and player label layer (`portal-player-overlay.js`) are
  `canvasTearDown`-torn-down (VERIFIED good) and the singletons are re-`ensure`d guarding
  `!destroyed && parent`. **Residual risk:** `createRegion`/`updateRegion`/`deleteRegion`
  are **global** — they fire for region edits on *any* scene, including a non-viewed scene
  via socket. `drawPortalOverlay`/`refreshPlayerPortalLabels` then redraw against
  `canvas.scene` (the viewed one), so the redraw is cheap and scene-correct, but it is
  redundant work on every region mutation anywhere. Combined with `sightRefresh` /
  `updateToken` firing often, this is a steady debounced-redraw load (see F-16).
- **Why it matters:** Not a leak per se, but it is module-wide redraw amplification and a
  cross-scene staleness window if `getCurrentLevelId` resolves the wrong scene's level
  during a multi-scene socket burst.
- **Recommended fix (PATCH):** In the region hooks, early-return unless the changed
  document's `parent?.id === canvas.scene?.id`. Confidence: **High** (static; behavior is
  clear).

---

### F-5 — Capture-phase `document`-level mouse/key listeners in `pickCanvasRectangle` (Medium)

- **Location:** `scripts/region-adder.js:88-204` — `mousedown` (capture) on the canvas
  *view*, plus `mousemove`/`mouseup`/`keydown` (capture) on **`document`**, attached at
  `:198-201`, removed by an idempotent `cleanup()` (`:181-195`).
- **Problem:** The teardown is **well done** (single `done`-guarded `cleanup()` on every exit
  — commit, Escape, error, invalid-coords; the `_pickInProgress` module guard at `:14-15,
  :90-92` prevents double-binding; `document`-level move/up means a release outside the
  canvas still resolves). VERIFIED: every `addEventListener` has a matching
  `removeEventListener` with the same `capture:true`. **Residual risks:** (1) the listeners
  are capture-phase and `stopImmediatePropagation()` — while a pick is in progress they
  pre-empt *all* of Foundry's canvas handlers, so any code path that throws *before*
  `cleanup()` (none currently, but future edits) would strand global capture listeners that
  swallow every click. (2) There is no timeout/auto-cancel: if the promise neither resolves
  nor rejects (e.g. the canvas view is torn down mid-pick by a scene switch), the body class
  `da-region-picking` and listeners persist until the next `mousedown`/Escape. `canvas`
  teardown does not cancel an in-flight pick.
- **Why it matters:** This is the single most fragile native-coupling in the module (capture
  interception + undocumented `canvas.controls` child + PIXI immediate mode). AUDIT §B.4
  already recommends retiring the bespoke picker. The teardown is correct *today* but the
  pattern is brittle.
- **Recommended fix (PATCH now / REWRITE later):** (a) Add a `canvasTearDown` / scene-change
  abort that calls `cleanup()` + rejects, so a mid-pick scene switch can't strand listeners.
  (b) Longer term, per AUDIT §B.4 + the portal design, prefer native region-drawing tools
  over a hand-rolled capture-phase picker. Confidence: **High** on the teardown reading;
  **Medium** on the strand scenario (INFERRED — depends on whether a scene switch can occur
  mid-pick).

---

### F-6 — `getCurrentLevelId` probes four undocumented `activeLevel` paths (High) — STRATEGY §3.1

- **Location:** `scripts/region-adder.js:48-65` — probes `canvas.scene.activeLevel._id`,
  `canvas.environment.activeLevel._id`, `canvas.activeLevel._id`, `game.user.activeLevel`,
  then `scene.initialLevel`, then bottom level.
- **Problem:** None of the first four are confirmed v14 public API (INFERRED — they are
  candidate internals). The function **validates each candidate against the scene's real
  level ids** (`validIds.has(c)`, `:51,61-63`) and falls back gracefully, which is good
  defensive design — a wrong guess yields the bottom level, not a crash. But "stamps the
  *wrong* floor on a new portal/region" is a *silent correctness* failure: stairs get
  bound to the wrong level. This value is consumed at `portal-wizard.js:105,115` (entrance/
  exit level), `portal-overlay.js:63`, `portal-player-overlay.js:123`, and
  `region-adder-dialog.js:62`.
- **Why it matters:** STRATEGY §3.1 ("level-aware navigation … is the substrate; never
  shadow or re-create") and AUDIT §C.2 both call for using the documented level-view API.
  The whole stairs value proposition rests on landing tokens on the right floor.
- **Recommended fix (PATCH):** Confirm the documented v14 read on a live world
  (`SceneNavigation`/`viewLevel` surface, or the `level` on the active `SceneViewOptions`),
  and make that the *first* probe; keep the validated-fallback chain beneath it as belt-and-
  braces. Add a one-line `console.debug` when it falls through to the bottom level so a wrong
  guess is diagnosable. Confidence: **High** that this is undocumented-internal; **Medium**
  on which exact property is canonical in v14 (could not open the live `SceneNavigation`
  page — INFERRED).

---

### F-7 — `viewLevel` best-effort write surface in the Manager is also unconfirmed (Medium)

- **Location:** `scripts/portal/portal-manager.js:39-44` — tries `ui.nav.viewLevel(id)` then
  `canvas.scene.view({ level: id })`.
- **Problem:** Both calls are speculative (INFERRED). They are wrapped in try/catch by the
  caller (`:99`) so a miss is a no-op (pan + control still work), which is the right
  degradation. But `canvas.scene.view({level})` conflates "activate this scene" with "view a
  level" and may have side effects (re-viewing the scene) if the first branch is absent.
- **Why it matters:** Same family as F-6 — undocumented level-nav coupling, just on the
  read-back/UX side. Lower severity because it is GM-only UX and fully guarded.
- **Recommended fix (PATCH):** Pin to the same confirmed level-view API as F-6; drop the
  `scene.view({level})` fallback if it can re-trigger a scene activation. Confidence: **High**
  (the speculative nature is stated in the code's own comment).

---

### F-8 — `window.DA` global pollution (Medium) — public-surface stability

- **Location:** `scripts/main.js:38-40` (`window.DA = game.modules.get(MODULE_ID).api`).
- **Problem:** `DA` is a two-letter global on `window`. It is a documented convenience (and
  the sidebar buttons correctly route through the namespaced `game.modules.get(id).api`, not
  `DA` — `main.js:55,61,68,75`, so a clobbered `DA` can't break the UI). Concerns: (1) a
  two-letter global is collision-prone (any other module/macro can overwrite it; `DA` is a
  very common abbreviation). (2) It is assigned on `ready` but the API object is created on
  `init`, so `window.DA` is briefly undefined between hooks — macros that touch it during
  `setup`/early `ready` race. (3) The README still documents `DA.Importer()`/`DA.AddRegion()`
  as the primary path and is otherwise stale (see F-10).
- **Why it matters:** Public API stability and discoverability. The canonical, namespaced
  path is correct and collision-proof; the bare global is the liability.
- **Recommended fix (PATCH):** Keep `game.modules.get("dungeon-alchemist-toolkit").api` as
  the **canonical** surface (already correct). Either drop `window.DA` or rename to a less
  collision-prone `window.DungeonAlchemistToolkit` and document it explicitly as a
  convenience alias only. If kept, assign it inside the same `init` block right after the
  `api` object is built (not on `ready`) to remove the undefined window. Confidence: **High**.

---

### F-9 — Public API factory does not de-duplicate dialog instances (Low) — ApplicationV2 idiom

- **Location:** `scripts/main.js:20,27,29` — `Importer`, `StairsManager`, `AddRegion` each do
  `new XDialog().render(true)` on every call.
- **Problem:** Repeated clicks/calls spawn **multiple** instances of the same singleton-style
  app. The v14 idiom (and the official `getSceneControlButtons` example) is to look up the
  existing instance via `foundry.applications.instances.get(id)` and toggle/focus it. Not a
  leak (closing works), but multiple stacked importers is sloppy and each carries its own
  size-probe `AbortController`, tooltip listeners, etc.
- **Why it matters:** Minor robustness/UX; aligns with the scene-controls migration (the
  example toggles instead of re-rendering).
- **Recommended fix (PATCH):** In each factory, `const ex = foundry.applications.instances.get("da-importer"); if (ex) return ex.bringToFront?.() ?? ex.render(true); return new DAImporterDialog().render(true);` Confidence: **High**.

---

### F-10 — README documents a stale/incomplete public API (Low)

- **Location:** `README.md:25,45,54,62` — documents only `DA.Importer()` and
  `DA.AddRegion()`; the **stairs API** (`AddStairs`/`LinkStairs`/`StairsManager`, the
  shipped headline feature) is undocumented, and `DA.AddRegion()` is the *legacy* tool that
  HANDOFF §7.3 plans to retire.
- **Why it matters:** Public-surface discoverability; users can't find the stairs API, and
  the docs point at a deprecated entry. (`docs/ARCHITECTURE.md` is also stale per AUDIT §E,
  but that is the sibling docs' concern.)
- **Recommended fix (PATCH):** Document the namespaced API + the stairs entry points; mark
  `AddRegion` legacy/deprecated. Confidence: **High**.

---

### F-11 — `module.json` missing fields a published v14 package should carry (Medium) — packaging

- **Location:** `module.json` (entire file; 28 lines).
- **Problem (VERIFIED by read):** Present: `id`, `title`, `version`, `description`,
  `compatibility {minimum:"14", verified:"14"}`, `authors`, `esmodules`, `styles`, `url`,
  `manifest`, `download`, `flags`. **Missing / weak:**
  - `compatibility.maximum` — **omit deliberately** (do not pin a max; just noting it's
    absent so it isn't accidentally added). OK as-is.
  - **`relationships`** — no declared `systems`/`requires`/`recommends`. The module relies on
    native Levels/Regions (core, so no `requires`), but declaring `relationships: {}` (or
    documenting "no dependencies") is standard hygiene; if any optional integration emerges
    it belongs here. (Low.)
  - **`languages`** — no i18n registration and all strings are hard-coded English (Medium;
    see F-12). A published package should ship at least an `en.json` + `languages` entry.
  - **`media`** — the repo has `docs/preview.webp` / `docs/importer-preview.webp` but
    `module.json` declares no `media[]` (cover/screenshots) for the package browser. (Low.)
  - **`bugs`** — no issue-tracker URL. (Low.)
  - **`id` vs deprecated `name`** — uses `id` (correct for v14). Good.
  - `authors[].flags: {}` and top-level `flags: {}` are empty — harmless.
  - `manifest`/`download` are pinned to the **working branch** `claude/gracious-goodall-
    ukqsio` (HANDOFF §4 says switch to `main` on merge) — fine for now, must flip before
    release.
- **Why it matters:** These are the difference between "works on my machine" and a
  publishable v14 module; `languages` in particular blocks any localization and is the most
  substantive gap.
- **Recommended fix (PATCH):** Add `relationships`, `languages` (+ `lang/en.json`),
  `media`, `bugs`; flip `manifest`/`download` to `main` at release. Confidence: **High**.

---

### F-12 — No i18n: all user-facing strings hard-coded English (Medium) — packaging/native idiom

- **Location:** throughout — e.g. `main.js:60,66-67,73-74`; every `ui.notifications.*` in
  `da-importer.js`, `importer-dialog.js`, `portal-*.js`; dialog titles in
  `DEFAULT_OPTIONS.window.title`; all `.hbs` label text.
- **Problem:** No `game.i18n.localize`/`format` anywhere (VERIFIED — zero matches). The v14
  norm is localization keys + `lang/en.json`, and `getSceneControlButtons` tools take a
  `title` *localization path*. This is partly why F-11 lists `languages` as missing.
- **Why it matters:** Strategy values "robustness over surface area," and the maintainer is
  doing an early "redo as much as possible" pass — retrofitting i18n later across this many
  toasts is far more work than starting with keys.
- **Recommended fix (PATCH, batched):** Introduce `lang/en.json` and wrap user-facing
  strings as they're touched (especially the scene-control `title`s during the F-2
  migration). Confidence: **High**.

---

### F-13 — Hand-rolled tab system instead of ApplicationV2 `static TABS` (Medium) — STRATEGY §3.4, modernization

- **Location:** `scripts/importer-dialog.js:208-222` (manual `.da-tab-btn` click handlers
  toggling `--active`/`--hidden`), template `templates/importer.hbs:14-18`; CSS
  `module.css` `.da-tab-panel--hidden`.
- **Problem:** The importer re-implements tab switching by hand. v14 ApplicationV2 +
  HandlebarsApplicationMixin provides **`static TABS`** + `tabGroups` + `changeTab` and a
  `{{tab}}`/part-based template convention — a documented extension point. AUDIT §B.3 and
  HANDOFF §7.4 both call for this. The hand-rolled version also re-binds click listeners on
  every `_onRender` (`:211`) without removing prior ones — benign because ApplicationV2
  replaces the DOM subtree each render (old nodes + their listeners are GC'd), but it is the
  kind of manual wiring `static TABS` removes.
- **Why it matters:** "Integrate via documented extension points; less custom code = fewer
  bugs." This is the clearest modernization win and is explicitly deferred in HANDOFF §7.4
  pending live verification.
- **Recommended fix (REWRITE, live-verified):** Convert the three tabs to `static TABS` with
  one `PART` per tab (or the `tabs` part pattern). Do it with a live v14 world per HANDOFF's
  caution (it's working code). Confidence: **High** that the pattern exists; **Medium** on
  the exact `static TABS` schema for multi-part forms in v14.354 (INFERRED — could not open
  the live ApplicationV2 page; the wiki confirms the mechanism).

---

### F-14 — `region-adder.js` legacy `changeLevel` path still wired into the public API (Medium) — STRATEGY §5

- **Location:** `scripts/main.js:29` (`AddRegion` in the API), `region-adder-dialog.js`
  (whole file), `region-adder.js:225-288` (`createMultiLevelRegion` with
  `behaviors:[{type:"changeLevel", system:{}}]`).
- **Problem:** The portal system (built on native `teleportToken`) supersedes the legacy
  `changeLevel` region tool; HANDOFF §7.3 and AUDIT §B.4/§C.3 both say retire it (or fold its
  one useful bit — multi-level span binding — into the portal flow). It remains exported via
  `DA.AddRegion()` and documented in the README. The `system:{}` empty-behavior payload is
  also a known fragility (AUDIT §A.5). Note `region-adder.js` *also* exports the shared
  helpers `getSceneLevels`/`getCurrentLevelId`/`pickCanvasRectangle` that the portal code
  imports — so the file can't be deleted wholesale; only the dialog + `createMultiLevelRegion`
  are the legacy surface.
- **Why it matters:** Two parallel ways to make level-transit regions is exactly the
  "parallel systems" the strategy forbids, and it doubles the maintenance/bug surface.
- **Recommended fix (REWRITE/TRIM):** Remove `AddRegion` from the public API + README;
  retire `region-adder-dialog.js` and `createMultiLevelRegion`; **keep** the three shared
  helpers (consider moving them to a neutral `scripts/levels-util.js` so the portal code no
  longer imports from a file named "region-adder"). Confidence: **High**.

---

### F-15 — Cross-scene staleness: `getScenePortals`/overlays assume `canvas.scene` (Medium)

- **Location:** `portal-overlay.js:57-66`, `portal-player-overlay.js:112-125`,
  `portal-manager.js:68-91` — all read `canvas.scene` and its `regions`; the region hooks
  that trigger them (`portal-overlay.js:105`, `portal-player-overlay.js:159`) are global.
- **Problem:** A `createRegion`/`updateRegion` on a **non-viewed** scene (another GM, or a
  socket update) triggers a redraw that reads `canvas.scene` — so it redraws the *wrong*
  scene's portals (harmless, but wasted) and, more importantly, the Manager's
  `_prepareContext` always targets `canvas.scene`, so if it's open while the viewed scene
  changes it shows stale data until manually refreshed. (Same root as F-4.)
- **Why it matters:** Correctness-of-display + redundant work; ties to the perf cross-cut.
- **Recommended fix (PATCH):** Scope the region hooks to `doc.parent?.id === canvas.scene?.id`
  (also fixes F-4); have the Manager re-render on `canvasReady`/scene change while open.
  Confidence: **High**.

---

### F-16 — Redraw amplification on high-frequency hooks (Medium) — perf cross-cut

- **Location:** `portal-player-overlay.js:153-160` (`updateToken`, `sightRefresh`,
  `controlToken`, 3× region hooks → `scheduleRefresh`, 120 ms debounce `:139-142`);
  `portal-overlay.js:102-108` (region hooks → `drawPortalOverlay`, **no debounce**).
- **Problem:** `sightRefresh` and `updateToken` fire **very often** (every token move / vision
  recompute). The player overlay debounces (good, 120 ms). The **GM overlay does not** —
  `drawPortalOverlay` runs synchronously on every `createRegion`/`updateRegion`/`deleteRegion`
  and on `canvasReady`. Each run is `O(portals)` (iterate link groups, draw rings/lines), so
  for a few stairs it's cheap, but dragging a region (which can emit a stream of
  `updateRegion`) redraws every frame of the drag with no coalescing. Both overlays also
  rebuild PIXI children from scratch each pass (`removeChildren()` + new `Container`s in the
  player overlay `:116`) rather than diffing.
- **Why it matters:** Module-wide perf; the strategy's "robustness" includes not janking the
  canvas. Nothing here is `O(regions)` *per frame* in the steady state, but the un-debounced
  GM redraw during region drags is the one hot path.
- **Recommended fix (PATCH):** Debounce `drawPortalOverlay` the same way the player overlay
  is debounced; coalesce the three region hooks. Confidence: **High**.

---

### F-17 — `_probeMediaSizes` HEAD probe: SSRF/egress posture is good; one nuance (Low) — security

- **Location:** `scripts/importer-dialog.js:324-353`.
- **Problem (mostly a commendation):** The probe is **correctly gated to local sources** —
  `if (source !== "data" && source !== "public") return;` (`:325`) — so it never issues a
  cross-origin/remote request from a remote `source` (e.g. S3), avoiding SSRF/egress and
  address-leak. It uses `credentials:"omit"`, `cache:"no-store"`, a 10 s `AbortController`
  timeout, a monotonic `_sizeProbeGen` to discard stale batches, and swallows all errors
  (VERIFIED — all present). **Nuance:** the *source* is gated, but `pair.media` is a URL from
  `FilePicker.browse`; if a `data`-source listing somehow returns an **absolute** off-site URL
  (unusual but not impossible with certain storage backends), the HEAD would still go to that
  host because the gate checks `source`, not the resolved URL. Low likelihood.
- **Why it matters:** This is the only outbound-network surface in the module; it's already
  the strongest-hardened code here, so this is a belt-and-braces note only.
- **Recommended fix (PATCH, optional):** Before fetching, also assert `pair.media` is
  same-origin / a relative path (`new URL(pair.media, location.origin).origin === location.origin`)
  and skip otherwise. Confidence: **High** that current code is safe for the normal case;
  **Low** likelihood of the absolute-URL edge.

---

### F-18 — `copyImages` / `Scene.create` use unvalidated DA-JSON scalars into the Scene payload (Medium) — security/robustness (untrusted input)

- **Location:** `scripts/da-importer.js:281-318` — `width`, `height`, `padding`, `grid.size`
  (`first.grid`), `gridDistance`, `darkness`, colors are read **directly** from
  `floors[0].data` (external DA JSON) with only `??` defaults, **not** finite/range
  validation. Walls/lights *are* guarded (`:467,496` — VERIFIED good, per AUDIT §A.2/A.3),
  but the Scene-level scalars are not.
- **Problem:** A malformed/hostile DA export with `width: "huge"`, `grid: 0`, or a negative
  `padding` flows straight into `Scene.create`. v14's schema will likely coerce/reject some,
  but `grid.size: 0` or a non-finite `width` can produce a broken scene or a validation abort
  that loses the whole import — the exact failure class the wall/light guards were added to
  prevent, just one level up. STRATEGY §3.6: *"DA exports are external data — validate/clamp
  before writes."*
- **Why it matters:** The importer's whole robustness story is "one bad entry can't kill the
  import"; the un-validated map-wide scalars are the remaining hole in that story.
- **Recommended fix (PATCH):** Coerce/clamp the map-wide scalars the same way walls/lights
  are: `Number.isFinite(first.width) && first.width > 0 ? first.width : <fallback>`, a
  positive `grid.size` floor, `padding` clamped to `[0,0.5)`, etc. Confidence: **High**.

---

### F-19 — `_ensureUniqueSubfolder` unbounded `while(true)` directory probe (Low) — robustness

- **Location:** `scripts/da-importer.js:80-106`.
- **Problem:** The collision loop (`tavern → tavern1 → …`) has **no iteration cap**; it relies
  on a free slot eventually being found. If `FP.browse` throws for a *non*-"absent" reason
  (permissions, backend error) it is treated as "absent" (`:96`) and the loop would try to
  `createDirectory` and could spin. Practically bounded by createDirectory succeeding, but a
  pathological backend could hang the import.
- **Why it matters:** Minor; only on the copy-to-world path with a misbehaving file backend.
- **Recommended fix (PATCH):** Cap at e.g. 1000 attempts and surface an error toast on
  exhaustion. Confidence: **Medium** (INFERRED failure mode — depends on backend `browse`
  error semantics).

---

### F-20 — `PIXI` global + immediate-mode Graphics: correct for v14, flagged as the future-break (Low/Medium) — modernization

- **Location:** `region-adder.js:116-119,132-134`; `portal-overlay.js:32-35,77-88`;
  `portal-player-overlay.js:80-98` — `new PIXI.Graphics()`, `beginFill`/`lineStyle`/
  `drawRect`/`drawCircle`/`drawRoundedRect`, `new PIXI.Container()`, `new PIXI.Text()`.
- **Problem:** All correct for v14 (PIXI **v7**, VERIFIED). But every one of these calls is
  deprecated in PIXI v8; whenever Foundry adopts v8 (post-v14), **all three overlays + the
  region picker break at once**. The code is honest about this (comments at
  `region-adder.js:83-84`, `portal-overlay.js:11-17`, `portal-player-overlay.js:10-15`) and
  everything is feature-detected + try/catch so it degrades to "no overlay," not a crash —
  which matches the strategy. Also note these draw into **`canvas.controls` / `canvas.interface`**,
  which are not public-API-guaranteed parents (INFERRED-stable for v14).
- **Why it matters:** Concentrated future-fragility; relevant to the "redo as much as
  possible early" goal — worth isolating now so the v8 migration is one file, not four.
- **Recommended fix (REWRITE, low urgency):** Wrap PIXI drawing behind one tiny internal
  helper module (`drawRect(g,...)`, `drawRing(g,...)`) so the v8 migration touches a single
  file; keep the feature-detect/degrade posture. Confidence: **High**.

---

## Native API touchpoints

`✓ documented` = confirmed v14 public/extension API; `~ semi` = real but
under-documented / version-sensitive; `✗ scrape/guess` = DOM scraping or unconfirmed
internal. "Failure mode" = behavior if the live build differs.

| # | Touchpoint | file:line | Documented? | Confidence | Failure mode if wrong |
|---|---|---|---|---|---|
| 1 | `Hooks.once("init"/"ready")` | main.js:9,38 | ✓ documented | VERIFIED | n/a (stable) |
| 2 | `game.settings.register/get/set` (client, config:false) | main.js:12-17; importer-dialog.js:158,178 | ✓ documented | VERIFIED | get throws → try/catch returns defaults (handled) |
| 3 | `game.modules.get(id).api` (public surface) | main.js:19,55; region-adder-dialog.js:16 | ✓ documented | VERIFIED | n/a |
| 4 | `window.DA` global | main.js:39 | ~ convention | VERIFIED | collision/clobber → UI unaffected (routes via api); macros break |
| 5 | `Hooks.on("renderSceneDirectory", (app, html:HTMLElement))` | main.js:49 | ✓ documented (AppV2 render hook) | VERIFIED | signature stable; **DOM inside is not** → see #6 |
| 6 | `.directory-header` / `.action-buttons` / `.header-actions` scrape + `insertBefore` | main.js:52,79-83 | ✗ scrape | VERIFIED-scrape | classes rename → all 3 buttons silently absent (F-2) |
| 7 | `element.innerHTML` (static literals) | main.js:60,66,73 | ~ DOM | VERIFIED | no live risk (static); hygiene (F-3) |
| 8 | `getSceneControlButtons` (proposed target) | (migration) | ✓ documented | VERIFIED | object-keyed in v14; tool needs onChange/onClick or core throws |
| 9 | ApplicationV2 + HandlebarsApplicationMixin (`DEFAULT_OPTIONS`, `PARTS`, `actions`, `_prepareContext`, `_onRender`, `_onClose`) | importer-dialog.js:42-89; region-adder-dialog.js:19-44; portal-manager.js:46-64 | ✓ documented | VERIFIED | actions/PARTS stable; `_onRender`/`_onClose` overrides call super (handled) |
| 10 | ApplicationV2 tabs hand-rolled (no `static TABS`) | importer-dialog.js:208-222 | ✗ reimpl | VERIFIED | works, but bypasses documented TABS (F-13) |
| 11 | `foundry.applications.apps.FilePicker.implementation` (`.browse/.upload/.createDirectory`, `type:"folder"`) | da-importer.js:81,119,145,149; importer-dialog.js:92,105 | ✓ documented | VERIFIED | API rename → browse try/catch → error toast, no crash |
| 12 | `foundry.applications.api.DialogV2.prompt/confirm` | portal-wizard.js:38; portal-manager.js:119 | ✓ documented | VERIFIED | rejectClose:false + catch → returns null (handled) |
| 13 | `foundry.audio.AudioHelper.play` | importer-dialog.js:145 | ✓ documented | VERIFIED | preview no-op (guarded by `if(src)`) |
| 14 | `foundry.utils.randomID` | da-importer.js:230; portal-core.js:197,254; importer-dialog.js:112 | ✓ documented | VERIFIED | n/a |
| 15 | `Scene.create` (global Document class) | da-importer.js:324 | ✓ documented | VERIFIED | validation throw → try/catch → error toast (handled); **no GM-gate (F-1)** |
| 16 | `scene.createEmbeddedDocuments / deleteEmbeddedDocuments("Region"/"RegionBehavior")` | portal-core.js:213,221,227,260,264,280; region-adder.js:286 | ✓ documented | VERIFIED | throw → caught at wizard/manager; **no GM-gate (F-1)** |
| 17 | `region.setFlag/getFlag(MODULE_ID, PORTAL_FLAG)` (+ raw `flags?.[id]?.[key]` fallback) | portal-core.js:53-54,257-258 | ✓ documented | VERIFIED | fallback covers non-Document hydration; safe |
| 18 | `CONFIG.RegionBehavior.dataModels.teleportToken.schema` (live schema introspection) | portal-core.js:155-166 | ~ semi (CONFIG documented; this read is defensive) | INFERRED | schema unreadable → emits superset, DataModel drops unknowns (handled) |
| 19 | `teleportToken` behavior field names (`destination`/`destinations`/`choice`/`revealed`) | portal-core.js:161-169 | ~ semi | INFERRED | wrong fields → teleport no-ops; **#1 live-verify item (HANDOFF §3)** |
| 20 | `changeLevel` behavior `system:{}` (legacy) | region-adder.js:277-282 | ~ semi | INFERRED | empty system may fail as schema gains fields (AUDIT A.5); legacy → retire (F-14) |
| 21 | `CONST` Region visibility (omitted, inherits default) | region-adder.js:259; portal-core.js:124 | ✓ documented (by omission) | VERIFIED | inherits LAYER_UNLOCKED default — correct fix |
| 22 | `getSceneLevels` reads `scene.levels` (Collection or array) | region-adder.js:25-37 | ~ semi | INFERRED | handles both shapes; empty → [] (safe) |
| 23 | `getCurrentLevelId` probes 4 `activeLevel` paths | region-adder.js:48-65 | ✗ guess (validated) | INFERRED | wrong floor silently (validated to scene ids) (F-6) |
| 24 | `viewLevel`: `ui.nav.viewLevel` / `canvas.scene.view({level})` | portal-manager.js:39-44 | ✗ guess | INFERRED | no-op (try/catch); pan still works (F-7) |
| 25 | `canvas.controls` / `canvas.interface` as PIXI parents | region-adder.js:131-134; portal-overlay.js:35; portal-player-overlay.js:45 | ~ semi (not public-guaranteed) | INFERRED | absent → ensure returns null → no overlay (degrades) |
| 26 | `PIXI.*` immediate-mode (v7) Graphics/Container/Text | region-adder.js:116-134; portal-overlay.js:77-88; portal-player-overlay.js:80-98 | ✓ for v14 (PIXI v7) | VERIFIED | correct now; breaks on PIXI v8 adoption (F-20) |
| 27 | `canvas.mousePosition` / `canvas.app.view` | region-adder.js:94,129,140,149 | ~ semi | INFERRED | view missing → reject "Canvas view not available" (handled) |
| 28 | `canvas.visibility.testVisibility(point,{object})` (LOS) | portal-player-overlay.js:37-38 | ~ semi | INFERRED | throw/absent → returns true (shows label) — fail-open by design |
| 29 | `canvas.animatePan` | portal-manager.js:101 | ✓ documented | VERIFIED | guarded by typeof — no-op if absent |
| 30 | `region.object?.control?.()` / `region.sheet?.render` | portal-manager.js:102,112 | ✓ documented | VERIFIED | optional-chained → no-op if absent |
| 31 | `canvas.tokens.controlled/.placeables`, `token.center`, `token.document.update` | portal-player-overlay.js:27-30,66,120 | ✓ documented | VERIFIED | update is a write (player-side nudge) — relies on token ownership |
| 32 | `canvas.regions.controlled` | portal-wizard.js:152 | ~ semi | INFERRED | `?? []` → "select two regions" warning (handled) |
| 33 | `CONFIG.Wall.doorSounds` | importer-dialog.js:142 | ✓ documented | VERIFIED | `?.` guarded → preview no-op |
| 34 | Hook names: `canvasReady`, `canvasTearDown`, `controlToken`, `updateToken`, `sightRefresh`, `create/update/deleteRegion` | portal-overlay.js:103-106; portal-player-overlay.js:154-159 | ✓ documented | VERIFIED | a renamed hook → that overlay stops updating (degrades, no crash) |
| 35 | `dataset.tooltip` (native tooltip system) | main.js:67,74; importer-dialog.js (many) | ✓ documented | VERIFIED | tooltip not shown if system changes — cosmetic |

---

## Scene-controls migration note (the `getSceneControlButtons` plan)

**Goal:** replace the three scraped sidebar buttons (F-2) with a native **"Dungeon
Alchemist"** scene-controls group (left canvas toolbar): *Import*, *Add Stairs*, *Stairs
Manager*.

**v14 shape (VERIFIED).** In v13+/v14 the hook argument is an **object keyed by control
name**; you add your group by assigning a new key. Each control's `tools` is itself a
`Record<string, SceneControlTool>`. A non-tool action button uses `button: true` and an
`onChange` (a tool with neither `onChange` nor `onClick` **throws** in core — foundry issue
#12761). GM-gate with `visible: game.user.isGM`.

```js
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;                     // group is GM-only (F-1)
  const api = game.modules.get(MODULE_ID).api;
  controls["dungeon-alchemist"] = {
    name: "dungeon-alchemist",
    title: "DAT.Controls.Group",                   // i18n key (F-12)
    icon: "fa-solid fa-dungeon",
    order: Object.keys(controls).length,           // append after native groups
    visible: game.user.isGM,
    // No persistent layer of our own → these are one-shot buttons, so there is no
    // meaningful "active tool". Point activeTool at the first tool to satisfy core.
    activeTool: "da-import",
    onChange: () => {},                             // group has no layer to (de)activate
    tools: {
      "da-import": {
        name: "da-import", title: "DAT.Controls.Import",
        icon: "fa-solid fa-file-import", order: 0,
        button: true, visible: game.user.isGM,
        onChange: (event, active) => { if (active) api.Importer(); }
      },
      "da-add-stairs": {
        name: "da-add-stairs", title: "DAT.Controls.AddStairs",
        icon: "fa-solid fa-stairs", order: 1,
        button: true, visible: game.user.isGM,
        onChange: (event, active) => { if (active) api.AddStairs(); }
      },
      "da-stairs-manager": {
        name: "da-stairs-manager", title: "DAT.Controls.Manager",
        icon: "fa-solid fa-diagram-project", order: 2,
        button: true, visible: game.user.isGM,
        onChange: (event, active) => { if (active) api.StairsManager(); }
      }
    }
  };
});
```

**Semantics — button vs active-tool.** All three are **`button: true`** (momentary
actions), not stateful tools: clicking fires the action and the control returns to the
previously active tool. This is correct because none of them owns a persistent canvas layer.
The one subtlety: core has historically required a group to resolve an `activeTool`; set it
to the first tool's name and give the group a no-op `onChange`. (INFERRED — confirm on a live
v14 world that a **button-only** group renders without selecting a layer; foundry issue
#13814 notes control *layers without tools* crash, which does not apply here since we ship
three tools, but verify the button-only-group case.)

**Icons.** Use `fa-solid fa-*` (the v14 FontAwesome class form used in the docs' example),
not the bare `fas fa-*` currently in the `innerHTML` strings.

**GM visibility.** `visible: game.user.isGM` on both the group and each tool. This *also*
resolves F-1 for the toolbar surface — but still add the per-API `requireGM()` guard, since
`DA.*`/`game.modules.get(id).api.*` remain callable from console regardless of the toolbar.

**Should the importer stay a Scenes-directory action too?** Reasonable, with one condition:
**only via a documented affordance**, never the current class-scrape. Importing a folder is
conceptually a *directory* operation (it creates a Scene), so a Scenes-tab entry aids
discoverability. But the canvas toolbar is the cleaner, version-stable home; if a documented
Scenes-directory header API isn't confirmed in v14, drop the duplicate and keep only the
scene-control + the `api`/macro path. Do **not** keep both via DOM scraping.

**Risks / unknowns.**
- Button-only group rendering / `activeTool` requirement — verify live (INFERRED).
- `onChange` signature is `(event, active)` — guard on `active` so the action fires once on
  activation, not also on deactivation (VERIFIED from the docs' example using `active`).
- Re-render churn: `getSceneControlButtons` fires on every controls refresh; the handler
  must be pure/idempotent (it is — it just assigns a key). No teardown needed.
- Migration removes the `renderSceneDirectory` hook, the `innerHTML` (F-3), and the
  `module.css` sidebar rules (`:2-9`) — net code reduction, aligned with §3.5.

---

## Top 5 priorities

1. **F-1 — GM-gate every write path.** No `isGM` check guards `Scene.create` /
   `createEmbeddedDocuments` / `setFlag`; the importer button is injected for all users. Add
   one `requireGM()` at every public entry + `visible: game.user.isGM` on the toolbar.
   Direct STRATEGY §3.6 violation. (Critical)

2. **F-2 → scene-controls migration.** Replace the `renderSceneDirectory` class-scrape
   (silent total loss of all entry points if markup shifts) with the native, GM-gateable
   `getSceneControlButtons` group per the migration note above. The documented, stable home
   for the three actions. (High)

3. **F-6 / F-7 — pin the level-view API.** `getCurrentLevelId` probes 4 undocumented
   `activeLevel` paths and `viewLevel` guesses two more; a wrong guess silently binds stairs
   to the wrong floor — fatal to the stairs value prop. Confirm the documented v14
   `SceneNavigation`/`viewLevel` read live and make it the primary probe. (High)

4. **F-18 — validate map-wide DA-JSON scalars before `Scene.create`.** Walls/lights are
   guarded but `width`/`height`/`grid.size`/`padding`/colors flow in unvalidated, re-opening
   the "one bad value aborts the whole import" hole one level up. Clamp/coerce them like the
   wall/light guards. (Medium, untrusted-input)

5. **F-11 / F-12 — packaging & i18n before release.** `module.json` lacks `relationships`,
   `languages`, `media`, `bugs`, and the module has zero `game.i18n` usage. Retrofitting i18n
   later across ~50 toasts is far more work than starting now, during the maintainer's
   early "redo as much as possible" pass; do it as part of the F-2 migration (the
   scene-control `title`s are localization keys anyway). (Medium)

**Honorable mentions:** F-13 (hand-rolled tabs → `static TABS`, the clearest modernization
win, HANDOFF §7.4), F-14 (retire the legacy `changeLevel`/`AddRegion` parallel system),
F-16 (debounce the un-debounced GM overlay redraw), F-20 (isolate PIXI v7 immediate-mode
behind one helper before the eventual v8 migration). The portal overlays' teardown on
`canvasTearDown` and the size-probe's SSRF posture are **done well** and should be preserved.
