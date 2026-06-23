# Rework Plan — Dungeon Alchemist Toolkit (v14)

> **Status: PROPOSAL — awaiting maintainer sign-off.** This synthesizes the three read-only
> audits (`docs/audits/importer-audit.md` IMP-01..13, `docs/audits/stairs-audit.md` S-01..20,
> `docs/audits/integration-audit.md` F-1..20) into one sequenced rework, governed by
> `docs/STRATEGY.md`. Nothing here is implemented yet. Decisions tagged **[OPEN]** need a
> maintainer call (see *Open decisions*). Items tagged **[NEEDS-LIVE]** cannot be fully
> confirmed without a running v14 world and are designed to degrade safely if the guess is wrong.

---

## Goal & guardrails

Make the module **safe, correct, and more native** before adding any surface — in that order.
Per STRATEGY: build ON native (don't shadow Levels/Regions/behaviors/nav), earn every custom UI,
defer authoritative editing to native, integrate via documented extension points (no DOM
scraping), validate untrusted DA input, and GM-gate every write. The maintainer wants to "redo
as much as possible early," so we **bias to REWRITE/SIMPLIFY that reduces custom code**, with one
exception: the **importer pipeline is the product's moat** — we harden it carefully, never
destabilize it. Because **there is no Foundry runtime for the developer and live-testing is hard**,
we front-load fixes that are **statically verifiable** (`node --check` + code reasoning), and every
guessed v14 API stays **feature-detected so a wrong guess degrades (no-op / fallback), never crashes**.
Each item below states its verification method and flags anything that truly needs a live world.

**Guardrail self-check for the whole plan (STRATEGY §5):** every phase either (a) closes a stated
guardrail gap, (b) replaces custom code with a native-backed path, or (c) hardens untrusted input —
no phase adds a feature native already does well.

---

## Convergent themes (all three audits agree)

| Theme | Audit IDs | Phase |
|---|---|---|
| No GM-gate on any write path | IMP-01, S-(writes), F-1 | **1** |
| Guessed level-view API → silently binds stairs to wrong floor (correctness, not UX) | S-06, S-07, F-6, F-7 | **2** |
| Unvalidated map-wide DA-JSON scalars (`width`/`height`/`grid`…) can abort whole import | IMP-04, F-18 | **3** |
| Sidebar DOM-scraping → `getSceneControlButtons` | S-12, F-2 | **4** |
| Entry-point mechanism has open v14 core bugs vs a verified sketch | S-12a, F-2 note | **4 [OPEN]** |
| Manager not link-aware; teleport-behavior stacking / duplicate linkIds | S-04, S-05, S-13 | **6** |
| Toast→manual-floor-switch wizard → guided persistent placement | S-14 | **5** |
| Player click-to-use does a client-side token write that fails for real players | S-10, F-(31) | **7** |
| Teleport payload: prefer plural `destinations`; fix misleading comments | S-01, S-02, S-03 | **2** |
| Hand-rolled tabs + `_onRender` re-binding → native `static TABS` + `_onFirstRender` | IMP-02, IMP-03, F-13 | **8** |
| PIXI.Text per-refresh churn → cache by region id; level-change redraw | S-08, S-11, F-16 | **9** |
| Legacy `AddRegion`/`changeLevel`: retire UX, RELOCATE shared helpers, fold span-binding | S-16, legacy verdict, F-14 | **6/10** |
| Packaging + i18n gaps | F-11, F-12, F-10 | **4/10** |

---

## Phase sequence (overview)

| # | Phase | Type | Needs live? | Effort | In v0.2.0 cut? |
|---|---|---|---|---|---|
| 0 | Pre-flight: shared `requireGM`/level/canvas helper modules (no behavior change) | PATCH | No | S | ✅ |
| 1 | **GM-gate every write path** | PATCH | No | S | ✅ |
| 2 | **Level-view API + teleport payload correctness** | PATCH | Verify-after | M | ✅ |
| 3 | **Validate untrusted DA scalars** (importer hardening) | PATCH | No | S | ✅ |
| 4 | **Entry point: reliable consolidated hub (+ guarded scene-controls)** [OPEN] + packaging/i18n scaffold | REWRITE | Partial | M | ✅ (hub only) |
| 5 | **Guided, persistent stairs placement** (banner + ghost + in-flow level picker) | REWRITE | Partial | L | ➖ (target v0.2.1) |
| 6 | **Link-aware Manager + unified `bindPortals`**; relocate legacy helpers | REWRITE | No | L | ➖ |
| 7 | **Honest click-to-use**: native auto-on-enter + sight-gated hint | REWRITE (down) | Verify-after | M | ➖ |
| 8 | **Importer modernization**: native `static TABS` + `_onFirstRender` + cheaper rows | REWRITE | Verify-after | M | ➖ |
| 9 | **Overlay perf**: cache labels by region id + safe level-change redraw | PATCH→small REWRITE | Partial | M | ➖ |
| 10 | **Polish**: retire legacy `AddRegion` UX, i18n sweep, packaging, hygiene | PATCH/TRIM | No | M | ➖ |

> **v0.2.0 first shippable cut = Phases 0–4.** Rationale below.

---

## Phase 0 — Pre-flight: shared helper modules (no behavior change)

**Objective.** Create the seams the later phases lean on, with zero behavior change, so each
subsequent phase is a small diff and the legacy file can be retired safely later.

**Findings addressed.** Enabler for IMP-01/F-1 (GM gate), S-16/F-14 (relocate shared helpers),
S-09 (de-dup `regionCenter`/`regionLevelId`).

**Changes (PATCH).**
- New `scripts/util.js` (or extend `constants.js`): `export function requireGM(msg)` →
  `if (!game.user?.isGM) { ui.notifications?.warn(msg ?? "DA Toolkit: only a GM can do that."); return false; } return true;`
- New `scripts/levels.js`: move `getSceneLevels` + `getCurrentLevelId` **verbatim** out of
  `region-adder.js` (`region-adder.js:25-37`, `:48-65`); re-export from `region-adder.js` so nothing
  breaks yet. Update portal imports (`portal-wizard.js:12`, `portal-core.js:22`, `portal-manager.js:14`,
  both overlays) to import from `levels.js`.
- New `scripts/canvas-pick.js`: move `pickCanvasRectangle` (`region-adder.js:85-201`) similarly,
  re-export from `region-adder.js`.
- De-duplicate `regionCenter`/`regionLevelId` (copied at `portal-core.js:90-103` **and**
  `portal-manager.js:18-32`) into `portal-core.js`; Manager imports them. (Pure move; the shape/level
  *correctness* fix is Phase 6/9 to keep this phase behavior-free.)

**Risk + mitigation.** Risk: a missed import path. Mitigation: it's pure relocation with
re-exports; `git grep` the moved symbol names; `node --check` all scripts.

**Verification.** `node --check scripts/**/*.js`; `git grep` confirms every importer of the moved
symbols resolves. No runtime needed.

**Effort.** S.

---

## Phase 1 — GM-gate every write path

**Objective.** Make "GM-gate every scene write" (STRATEGY §3.6, HANDOFF §6) actually true. This is
the single clearest unmet guardrail and is trivial + statically provable.

**Findings addressed.** IMP-01 (`da-importer.js:144` `importFolder`, `:324` `Scene.create`,
`:85`/`:100` `createDirectory`, `:128` `FP.upload`; `importer-dialog.js:641` `#onImport`,
`:91` `#onBrowse`); F-1 (`main.js:19-30` API factory, write sinks
`portal-core.js:213,221,227,260,264,280`, `region-adder.js:286`); S writes throughout.

**Changes (PATCH).** Add `requireGM()` (Phase 0) as the **first line** of every public write entry:
- `main.js` API factory members `Importer`/`AddStairs`/`LinkStairs`/`AddRegion` (each returns null
  if not GM).
- `importFolder` and `#onImport`/`#onBrowse` (importer); `startAddStairs`/`addStairsInteractive`/
  `startLinkRegions` (wizard); Manager delete/edit actions; `createLinkedStairs`/`linkExistingRegions`
  (portal-core, belt-and-braces at the lib boundary).
- Defence in depth: the entry-point UI (Phase 4) is GM-gated via `visible: game.user.isGM`, but the
  `api.*` / console path stays guarded by `requireGM()` regardless.

**Risk + mitigation.** Risk: gating a path a non-GM legitimately needs. Mitigation: every write here
*already* requires GM permission server-side — we're only converting a confusing mid-pipeline
rejection into a clean early toast. No read/preview path is gated.

**Verification.** `node --check`; reasoning (grep shows `requireGM` at the head of each sink).
No runtime needed. **VERIFIED** gap.

**Effort.** S.

---

## Phase 2 — Level-view API + teleport payload correctness

**Objective.** Fix the **most damaging latent bug** in the module: the active-level detection
guesses v14 APIs that almost certainly don't exist, so stairs can silently bind **both ends to the
same floor** (a correctness/data bug, not UX). Simultaneously make the teleport payload prefer the
v14-canonical plural field. Both are small, mostly static, and feature-detected to degrade safely.

**Findings addressed.**
- S-06/F-7 (`portal-manager.js:39-44` `viewLevel` uses non-existent `ui.nav.viewLevel` /
  `canvas.scene.view({level})`).
- S-07/F-6 (`region-adder.js:48-65` → now `levels.js`: probes four undocumented `activeLevel` paths;
  falls through to bottom level **every time**, corrupting captured levels at creation —
  consumed by `portal-wizard.js:105,115`, `portal-overlay.js:63`, `portal-player-overlay.js:122`).
- S-01/S-02/S-03 (`portal-core.js:151-173` `buildTeleportBehavior`: writes deprecated singular
  `destination` first; comments `:13-18,:138-143` are wrong for v14).

**Changes.**
- **`getCurrentLevelId` (PATCH):** replace the candidate list with the **documented** order, keeping
  the existing `validIds` filter + bottom-level fallback:
  `canvas.level?.id` → `canvas._viewOptions?.level` → `game.user?.viewedLevel` →
  `scene.initialLevel` → bottom. Prefer `canvas.level?.id` first (the underscore on `_viewOptions`
  suggests semi-private). Add a one-line `console.debug` when it falls through to bottom, so a wrong
  guess is diagnosable from logs without a live debugger.
- **`viewLevel` (PATCH):** try `ui.nav?.viewLevel?.(id)` (SceneNavigation) then
  `canvas?.scene?.view?.({ level: id })` (SceneViewOptions.level); keep the caller's try/catch so a
  miss is pan-only.
- **`buildTeleportBehavior` (PATCH):** flip to **plural-first** — emit `destinations` whenever the
  schema declares it; fall back to singular `destination` **only** when the schema declares *only* the
  singular. Make the **superset fallback emit plural first**, and fix the misleading comments to say
  "v14 canonical is `destinations`; `destination` is the deprecated v13/shim field." Keep the
  schema-read approach (S-02 verdict: sound). Add a debug-flagged
  `console.debug(Object.keys(schema?.fields ?? {}))` on first build so the live confirm is one log line.
- **Force `choice:true` for >1 destination** and add a comment that multi-destination + `choice:false`
  = native random selection/landing (S-03); keep destination footprints ~1 grid square until the
  native relative-position option is wired.

**Risk + mitigation.** Risk: the documented accessor names are corroborated by release notes but the
exact property could still differ on the target build. Mitigation: **all three are feature-detected**
— a wrong `getCurrentLevelId` name simply continues to the next probe and ultimately the bottom-level
fallback (today's behavior, no regression); a wrong `viewLevel` is a guarded no-op; the teleport
schema-read drops unknown keys via DataModel. The plan **strictly improves** the guess set; it cannot
regress below current behavior.

**Verification.** `node --check` + reasoning for the code shape. **[NEEDS-LIVE]** to *confirm* the
correct level name and that teleport fires: the `console.debug` lines make this a one-glance check in
a live world (V1, V3, V4 in the stairs-audit verify table). **If still wrong live, the module behaves
exactly as it does today** (bottom-level fallback / pan-only), so it never crashes — but note this is
the highest-value live confirmation in the whole plan and should head the next live session.

**Effort.** M.

---

## Phase 3 — Validate untrusted DA scalars (importer hardening)

**Objective.** Close the last *fatal* whole-import abort path from a malformed DA file. The v0.1.0
per-entry wall/light guards stop one bad wall from losing every floor; the **map-wide** scene
scalars are still raw, re-opening the same failure class one level up. This is on the moat, so it's a
**careful PATCH, not a rewrite**.

**Findings addressed.** IMP-04 / F-18 (`da-importer.js:281-296` scene `width`/`height`/`size`/
`padding`/`distance`; `:505-508` light `color`/`alpha`; `:473` wall `door`).

**Changes (PATCH).**
- Add a small `requirePositiveFinite(v, name)` used for `width`/`height`/`grid` **before**
  `Scene.create`, throwing a clear, localized toast (caught by the existing try/catch) so a bad value
  fails *loudly and early* instead of aborting mid-`Scene.create`.
- Clamp `padding` to `[0, 0.5)` and `distance` to a positive finite (fallbacks already exist).
- In `_mapWall`: coerce `door` to `daWall.door === 1 ? 1 : 0` (v14 wall `door` is `0|1`).
- In `_mapLight`: drop `color` unless it matches `/^#[0-9a-f]{6}$/i`; clamp `alpha` to `[0,1]`.
- Use `Number()`/`parseFloat` (not `parseInt`) for elevations in `#onImport` validation + override
  build (IMP-05, `importer-dialog.js:658-659,678-679`) so fractional elevations aren't silently
  truncated.
- Surface skipped **orphan** files as a `ui.notifications.warn` in `importFolder` (IMP-08,
  `da-importer.js:391-393`) mirroring the mixed-map toast.

**Risk + mitigation.** Risk: over-strict validation rejects a legitimately unusual-but-valid export.
Mitigation: only reject values that would *fail `Scene.create` anyway* (non-finite / ≤0 grid); clamp
(not reject) soft values like padding; the import already had to produce these to succeed.

**Verification.** `node --check` + reasoning. The exact GridData minimum is INFERRED but the change is
strictly defensive (rejecting ≤0/NaN can't be worse than the current fatal abort). No runtime needed
to be safe; a live pass can later confirm the friendly toast path.

**Effort.** S.

---

## Phase 4 — Entry point: reliable consolidated hub (+ guarded scene-controls) + packaging/i18n scaffold

**Objective.** Replace the **DOM-scraped sidebar buttons** (off-strategy; silently vanish if v14
renames classes) with a documented, GM-gateable entry point — while navigating the fact that custom
**scene-control groups have multiple open v14 core bugs**. Lay the i18n/packaging scaffold here since
the control `title`s are localization keys anyway.

**Findings addressed.** S-12/F-2 (`main.js:49-84` DOM injection), S-12a/V11 (core bugs #12258,
#12904, #13814, #12803; tools throw without `onClick`/`onChange` #12761), F-3 (static `innerHTML`),
F-8/F-9 (`window.DA` global + no instance de-dup), F-11/F-12/F-10 (packaging/i18n/README).

**Changes (REWRITE).** See **[OPEN] decision** below for the mechanism. The plan implements the
**recommended hybrid (Option C)**:
- **Always-works consolidated entry (Option B core):** one GM-gated path that does not depend on the
  buggy control-group surface. Candidates: a small "Dungeon Alchemist" launcher (DialogV2 or a tiny
  ApplicationV2 with three buttons: Import / Add Stairs / Stairs Manager), reachable from the `api`
  and a single documented affordance. This is the reliable floor.
- **Progressive enhancement (Option A) behind guards:** add the `getSceneControlButtons` group per
  the integration audit's **verified** sketch (`integration-audit.md` migration note): object keyed by
  name, three `button:true` tools each with `onChange` (guarded on `active`), `visible: game.user.isGM`
  on group + tools, `activeTool` pointing at an existing tool, **no toggle+activeTool on the same tool**
  (avoids #12904), and "Link stairs" implemented as a **button that starts a guided pick**, not a
  toggle. Wrap registration so that if it ever throws, the consolidated hub still exists.
- Delete the `renderSceneDirectory` hook, the three `innerHTML` buttons, and the sidebar CSS
  (`module.css:2-9`) — net code reduction.
- De-dup app instances (F-9): factories look up `foundry.applications.instances.get(id)` and
  `bringToFront()` instead of stacking new windows.
- `window.DA` (F-8): assign in `init` (not `ready`, removing the undefined window) and document it as a
  *convenience alias only*; canonical surface stays `game.modules.get(id).api`.
- **i18n/packaging scaffold:** add `lang/en.json` + `languages` to `module.json`; wrap the new
  control/launcher `title`s and their toasts in `game.i18n.localize`. Add `relationships`, `media`
  (`docs/preview.webp`, `docs/importer-preview.webp`), `bugs` to `module.json`. (Full toast sweep is
  Phase 10.) Flip `manifest`/`download` to `main` only at release.
- Update README (F-10): document the namespaced API + stairs entry points; mark `AddRegion` legacy.

**Risk + mitigation.** Risk: the scene-controls group is the single biggest risk in the redo (open
core bugs, button-only-group rendering unconfirmed). Mitigation: **that's exactly why the hub is the
floor** — the module is fully usable via the consolidated entry even if the controls group is broken
or disabled on the target build. The group is additive and try/caught; pin `compatibility.verified`
to a build where it works.

**Verification.** `node --check` + reasoning for the hub (no live needed — it's plain ApplicationV2/
DialogV2, the patterns already used). **[NEEDS-LIVE]** only for the *scene-controls enhancement*
(V11): confirm a button-only group renders without selecting a layer on the target build. If it
misbehaves, ship with the group disabled by a flag and keep the hub. i18n: `node --check` + JSON
validate `en.json`.

**Effort.** M.

---

## Phase 5 — Guided, persistent stairs placement

**Objective.** Replace the **modal → toast → click → manual floor switch → toast → click → toast**
flow with guided, persistent placement. The in-flow level picker also **sidesteps the broken
level-detection for the write path** (it captures the level the GM *explicitly chose*, not an
inferred one) — so this hardens correctness, not just UX.

**Findings addressed.** S-14 (`portal-wizard.js:90-134` `startAddStairs`: transient
`ui.notifications.info` at `:97,:107,:129`; manual floor switch `:107`; no ghost; cancel-step-2 loses
step-1 `:112`; no re-entrancy state). Complements Phase 2 (S-07) for creation.

**Changes (REWRITE the wizard).** Small wizard controller with:
- a **persistent step banner** pinned to the canvas (a DOM element, not a toast): "Step N of M",
  Cancel/Back, the chosen mode/label;
- a **ghost** of the placed entrance (keep the `pickCanvasRectangle` preview Graphics on canvas,
  dimmed, until done);
- an **in-flow destination-level picker** (dropdown in the banner that calls the fixed `viewLevel`,
  Phase 2) so the GM never hunts the native nav and the captured level is **explicit**;
- explicit **Back** that re-opens step 1 without losing state; re-entrancy guard so a second
  placement can't start mid-flow.
- Add a `canvasTearDown`/scene-change abort that calls `pickCanvasRectangle`'s `cleanup()` + rejects,
  so a mid-pick scene switch can't strand capture listeners (F-5).

**Risk + mitigation.** Risk: a banner/ghost built on PIXI/canvas layers that differ on the target
build. Mitigation: the banner is plain DOM (robust); the ghost reuses the **already feature-detected**
`pickCanvasRectangle` preview (degrades to no-ghost, never crash); the level picker is guarded
(Phase 2). The flow still completes (placement works) even if the ghost or picker degrade.

**Verification.** `node --check` + reasoning. **[NEEDS-LIVE]** for the on-canvas ghost/banner
placement feel; degrades to "no ghost / use native nav" if a guess is wrong. Defer to v0.2.1 so the
v0.2.0 cut isn't gated on a live-tuned UI.

**Effort.** L.

---

## Phase 6 — Link-aware Manager + unified `bindPortals`; relocate legacy helpers

**Objective.** Deliver the headline editing fix: "Edit" must understand **links**, not just open the
raw native region sheet. Back it with one idempotent bind function so create/link/re-link stop
stacking behaviors and minting duplicate linkIds. Finish relocating the legacy helpers so the legacy
file can be retired in Phase 10.

**Findings addressed.** S-13 (`portal-manager.js:106-113` `#onEdit` opens entrance sheet only),
S-04 (`portal-core.js:250-268` always mints a new `linkId`; can't extend a group), S-05
(`:221-231,:260-267` appends teleport behaviors — duplicates), S-09 (shape/level helpers assume a
single rectangle/level), S-16/F-14 (relocate `getSceneLevels`/`getCurrentLevelId`/`pickCanvasRectangle`,
fold span-binding).

**Changes (REWRITE).**
- **Single `bindPortals({ regions, mode, label, twoWay })`** used by both `createLinkedStairs` and
  direct-connect: reuse an existing `linkId` if any input region already has one (else mint); upsert
  the portal flag; **replace** (not append) the region's `teleportToken` behavior
  (`region.behaviors.filter(b => b.type === "teleportToken")` → update/delete extras → create one).
  Idempotent re-link.
- **Link-aware Manager edit:** replace `#onEdit` with a small link editor (DialogV2 or ApplicationV2)
  bound to `linkId` — edit label/mode/two-way, "re-pick destination", "add end", "go to partner" —
  writing through `bindPortals`. Keep a secondary "Open native region sheet" for shape/elevation
  (defer authoritative shape editing to native, per STRATEGY).
- **Shape/level robustness (S-09):** `regionCenter`/`regionLevelId` prefer a native bounds/centroid
  (`region.bounds`/`shape.bounds`) and fall back to rectangle math; handle ellipse/polygon so a
  GM-converted shape doesn't null the overlay/Manager.
- **Fold span-binding (legacy verdict):** add a "same-spot multi-floor" option that uses native
  `changeLevel` *as one behavior inside the portal model* (preferred — strictly more native) or
  generates N teleport ends at the same x,y. No parallel transit system.

**Risk + mitigation.** Risk: editing live region behaviors is the most write-heavy change.
Mitigation: all writes GM-gated (Phase 1); `bindPortals` is idempotent (re-running converges);
behavior replace-in-place removes the duplicate-stacking footgun rather than adding to it.

**Verification.** `node --check` + reasoning (the dedupe/replace logic is statically checkable).
The native bounds accessor (S-09) is INFERRED → feature-detected with rectangle fallback. Manager
edits can be smoke-tested live but the logic degrades safely.

**Effort.** L.

---

## Phase 7 — Honest click-to-use: native auto-on-enter + sight-gated hint

**Objective.** Stop shipping a player feature that **likely fails for real players** and violates the
strategy (a client-side token write). Be honest: ship the native auto-on-enter path + a sight-gated
*hint* label; defer real click-to-use to a later phase behind a confirmed GM relay. This **reduces
surface area** — on-strategy.

**Findings addressed.** S-10/V6 (`portal-player-overlay.js:58-71` `usePortal` does
`token.document.update` client-side; `:101-104` pointerdown), F-(31).

**Changes (REWRITE down).**
- Remove the client-side `token.document.update` move. Rely on native `teleportToken` auto-firing
  when a token enters the region (which the system already creates).
- Keep the sight-gated label as a **hint only** (hover/affordance), not an actuator.
- Document the deferred real click-to-use (GM-relay via `DialogV2.query`/socket → GM validates
  owner+range+sight+cooldown → GM `token.update`) as a future phase behind a confirmed transport.

**Risk + mitigation.** Risk: users expecting click-to-use. Mitigation: native auto-on-enter is the
honest, robust behavior and matches "build on native"; the hint stays. Net: fewer ways to fail.

**Verification.** `node --check` + reasoning. **[NEEDS-LIVE]** to confirm native auto-on-enter fires
with the Phase 2 payload (same V1 confirm). Degrades to "label is a hint, walk onto it" — which is the
intended native behavior — if anything is off.

**Effort.** M.

---

## Phase 8 — Importer modernization: native `static TABS` + `_onFirstRender` + cheaper rows

**Objective.** The biggest reduction of custom UI surface in the importer: replace the hand-rolled
tabs (DOM-only active state; listeners re-bound every render) with native ApplicationV2 `static TABS`,
move one-time wiring to `_onFirstRender`, and stop rebuilding every row on every render. Do this
**after** correctness/safety and **before** Phase-2-style edit-mode would build on the fragile
foundation. Careful — it's working moat code.

**Findings addressed.** IMP-02/F-13 (`importer-dialog.js:208-222` manual tab wiring; `importer.hbs:14-18`;
`module.css:32-65`), IMP-03 (`:193-290` per-render wiring of range/door/uniform-height/advanced/info),
IMP-09 (`_populateLevelsTab` full teardown+rebuild every render), IMP-11 (consolidate tooltips),
IMP-12/IMP-13 (stale "Visible" comments; `#onClose` JSDoc).

**Changes (REWRITE).**
- `static TABS = { primary: { tabs: [{id:"scene"},{id:"doors"},{id:"levels"}], initial:"scene" } }`;
  template nav `<a data-tab data-group="primary">` + panels `<section class="tab" data-tab data-group="primary">`;
  delete the `_onRender` tab block and the `da-tab-btn--active`/`da-tab-panel--hidden` CSS. Native tabs
  persist `this.tabGroups.primary` across renders and bind clicks for us.
- Move range/door-preview/uniform-height/advanced/info wiring into `_onFirstRender`; keep only
  state-reflecting work in `_onRender`.
- Guard the Levels rebuild with a generation token (`if (this._lastBuiltGen === this._floorGen) return`)
  so unchanged renders don't thrash the DOM / re-decode video thumbnails.
- Drop the bespoke door-preview tooltip for native `dataset.tooltip`/CSS hover-scale; keep the enlarged
  *media* preview (real value) but scope it to the dialog element. Delete stale "Visible" comments; fix
  `#onClose` JSDoc.

**Risk + mitigation.** This is the **one importer rewrite touching the moat** — highest care. Risk:
the exact v14 `static TABS` contract / `.tab.active` class is INFERRED. Mitigation: the fallback (tabs
don't switch) is **immediately obvious** in any live smoke test and harmless to data (no import path
changes); keep the change isolated to tabs/wiring (don't touch pairing/`Scene.create`). Sequenced
after the safety phases so it builds on a gated, validated base.

**Verification.** `node --check` + reasoning. **[NEEDS-LIVE]** to confirm the `static TABS` shape and
`.active` class before deleting the CSS (HANDOFF §7.4 explicitly says do this WITH a live world). If
the guess is wrong, tabs simply don't switch — visible instantly, no data risk.

**Effort.** M.

---

## Phase 9 — Overlay perf: cache labels by region id + safe level-change redraw

**Objective.** Stop the player overlay re-allocating a `PIXI.Text` + Graphics per visible portal on
every refresh, and give both overlays a redraw on floor change without inventing a core hook.

**Findings addressed.** S-08 (`portal-player-overlay.js:109-160` rebuilds all children every refresh;
missing active-level redraw), S-11 (`portal-overlay.js:55-108` no level-change redraw), F-16
(GM overlay redraw un-debounced), F-15/F-4 (region hooks fire for non-viewed scenes), F-20 (isolate
PIXI immediate-mode behind one helper).

**Changes (PATCH→small REWRITE).**
- **Cache by region id:** `Map<regionId, PIXI.Container>`; on refresh reposition/show-hide existing
  containers, only build/destroy on actual add/remove; rebuild text only when the label string changes.
  Recompute cheap gates (proximity/sight/level) every refresh but mutate `.visible`.
- **Debounce** the GM overlay redraw like the player overlay (120 ms); coalesce the three region hooks;
  early-return region hooks unless `doc.parent?.id === canvas.scene?.id` (F-4/F-15).
- **Safe level-change redraw:** no invented hook. Options that degrade safely: also schedule on
  `canvasPan`/`refreshToken`; have the Phase-5 wizard/Manager `viewLevel` fire our own
  `Hooks.callAll("daLevelChanged")` and listen for it; last resort a low-frequency ticker check of
  `canvas.level?.id` that redraws only on change.
- Wrap PIXI immediate-mode drawing behind one tiny helper (`drawRect`/`drawRing`) so a future PIXI v8
  bump is a one-file change (F-20).

**Risk + mitigation.** Risk: caching introduces a stale-container bug. Mitigation: keyed by region id
with explicit add/remove; the existing teardown on `canvasTearDown` is preserved. Level-change signal
uses only documented hooks + our own event — never a guessed core hook.

**Verification.** `node --check` + reasoning. **[NEEDS-LIVE]** to confirm the level-change signal
actually redraws on floor switch; until then overlays are merely *stale after a silent floor switch*
(today's behavior), never crashing.

**Effort.** M.

---

## Phase 10 — Polish: retire legacy `AddRegion` UX, i18n sweep, packaging, hygiene

**Objective.** Remove the parallel legacy transit UX (now that portals + Phase-6 span-binding cover
it), finish i18n, and close packaging/hygiene gaps.

**Findings addressed.** S-16/legacy verdict + F-14 (retire `region-adder-dialog.js`,
`templates/region-adder.hbs`, `createMultiLevelRegion`, the `AddRegion` API entry; the `system:{}`
`changeLevel` fragility), F-12 (i18n sweep across remaining toasts), F-11 (packaging finalize),
F-19 (cap `_ensureUniqueSubfolder` loop), F-17 (optional same-origin assert on media HEAD),
remaining IMP/S low-severity hygiene (IMP-10, S-18 `regionUuid` fallback throws not fabricates,
S-19 `#onGoto` settle, S-20 nits).

**Changes (PATCH/TRIM).**
- **Only after Phase 0/6 relocations land**, delete `region-adder-dialog.js` +
  `templates/region-adder.hbs` + its CSS + the `AddRegion` API entry; `region-adder.js` shrinks to a
  thin re-export shim (or is removed once nothing imports it). `git grep changeLevel` should then show
  only the intentional Phase-6 span-binding use.
- i18n: move all remaining `ui.notifications.*` and dialog titles to `lang/en.json` keys.
- Packaging: finalize `relationships`/`media`/`bugs`; flip `manifest`/`download` to `main`; bump
  `compatibility.verified` to the live-confirmed build.
- Hygiene: cap the directory-collision loop; `regionUuid` throws instead of fabricating a non-portable
  absolute UUID (S-18); `#onGoto` activates the Regions layer / awaits a tick before `control()` (S-19).

**Risk + mitigation.** Risk: deleting the legacy file before all helpers are relocated. Mitigation:
**hard dependency on Phase 0 + Phase 6** completing first; `git grep` the moved symbols before delete.

**Verification.** `node --check`; `git grep` for dangling imports + `changeLevel`/`AddRegion`
references; JSON-validate `en.json`. No runtime needed for the deletions.

**Effort.** M.

---

## v0.2.0 — first shippable cut

**= Phases 0 → 1 → 2 → 3 → 4 (hub).** This is the smallest set that yields a **meaningfully better,
safe** release without gating on live-tuned UI:

- **Safety:** every write is GM-gated (Phase 1). *(static)*
- **Correctness:** stairs no longer silently bind to the wrong floor, and the teleport payload uses the
  v14-canonical plural field (Phase 2). *(static change; one live confirm, degrades to today's behavior
  if wrong)*
- **Robustness:** no malformed DA file can abort a whole import (Phase 3). *(static)*
- **On-strategy entry point:** the fragile DOM-scrape is gone, replaced by a reliable consolidated hub
  that always works, with the scene-controls group as a guarded enhancement; i18n/packaging scaffold in
  place (Phase 4). *(static for the hub; live only for the optional group)*

Everything in this cut is **statically verifiable or degrades to current behavior** — it does not
*depend* on a successful live test to be safe to ship. The single highest-value live confirmation
(Phase 2's level/teleport check) should run before tagging, but its failure mode is "no worse than
today," so it does not block the release on availability of a world.

**Deferred to v0.2.1+:** guided placement (5), link-aware Manager (6), honest click-to-use (7),
importer tabs modernization (8), overlay perf (9), legacy retirement + i18n sweep (10).

---

## Open decisions for the maintainer

### 1. Entry-point mechanism — **[OPEN], the main one**

| Option | What | Pros | Cons |
|---|---|---|---|
| **A** | Scene-controls group only (`getSceneControlButtons`) with guards/fallback | Most native; correct home for canvas tools; GM-gateable; net code reduction | Custom groups have **open v14 core bugs** (#12258/#12904/#13814/#12803); button-only-group rendering unconfirmed → risk the entry point is broken on some builds |
| **B** | Single consolidated Toolkit window/button that always works | Maximally reliable; plain ApplicationV2/DialogV2 (no live unknowns); easy to verify statically | Less "native-feeling"; not in the canvas toolbar where region tools belong |
| **C (recommended)** | **Hybrid:** consolidated hub as the reliable floor **+** scene-controls group as a guarded progressive enhancement | Always usable (B) even if the group is broken; gets the native toolbar placement (A) when the build supports it; honest degradation | Slightly more code than either alone (two entry surfaces) |

**Recommendation: C.** It satisfies STRATEGY's "integrate via documented points / no scraping" via the
controls group, while the no-live-runtime constraint and the documented core bugs make a
**guaranteed-working fallback non-negotiable**. The hub is statically verifiable; the group is additive
and try/caught. If the maintainer prefers minimal surface, fall back to **B** for v0.2.0 and add the
group later once verified on the target build. **Avoid A-only** until the core bugs are confirmed fixed
on the pinned build.

*Sub-decisions if A or C:* implement "Link stairs" as a **button that starts a guided pick** (not a
toggle, per #12904); pin `compatibility.verified` to a build where the group renders.

### 2. Keep an importer entry in the Scenes directory too? — **[OPEN]**

Importing is conceptually a *directory* operation. **Recommendation:** only if a **documented**
Scenes-directory affordance exists in v14; otherwise drop the duplicate and rely on the hub + `api`.
**Never** re-add it via DOM scraping. Low stakes.

### 3. Same-spot multi-floor span-binding mechanism — **[OPEN]**

Fold via (a) native `changeLevel` as one behavior inside the portal model, or (b) generate N teleport
ends at the same x,y. **Recommendation: (a)** — strictly more native and free (it's what the legacy
tool already used, minus its dead UX). Decide during Phase 6.

### 4. `window.DA` global — **[OPEN], minor**

Keep as documented convenience alias, rename to `window.DungeonAlchemistToolkit`, or drop entirely
(canonical stays `game.modules.get(id).api`). **Recommendation:** keep `DA` as an explicitly-documented
alias, assigned in `init`; cheap and already wired.

---

## Out of scope / explicitly NOT doing

- **No new player-facing features.** No real click-to-use GM-relay in this plan (Phase 7 *removes* the
  broken one and documents the relay as future work behind a confirmed transport).
- **No standalone Levels editor.** Post-import level editing stays in the **native Levels tab**
  (STRATEGY §6, already retired in v0.1.0). At most a one-click "Open native Levels tab" shortcut.
- **No re-implementation of native Regions/behaviors/navigation/surfaces.** We call `teleportToken`,
  `changeLevel`, `viewLevel`/`cycleLevel`, Regions V2 — never shadow them.
- **No PIXI v8 migration now.** Foundry v14 is PIXI v7; we only *isolate* the immediate-mode drawing
  behind one helper (Phase 9) so the eventual v8 bump is a one-file change.
- **No speculative API rewrites.** We do not replace a working schema-adaptive path with a hardcoded
  one; we keep feature-detection and only re-order/relabel (Phase 2).
- **No second transit system.** The legacy `changeLevel` *tool UX* is retired, not paralleled; its one
  useful concept is folded into portals.
- **No blind schema-shape edits.** Per-level `fog`/`textures` sub-keys and the wall `light` restriction
  (IMP-06/IMP-07) are **not** changed offline — they're a live-confirm-then-align item, not a code
  change in this plan.
- **No repo migration / branch flip work** beyond noting the `module.json` `manifest`/`download` must
  flip to `main` at release (HANDOFF §4 covers migration).

---

## Dependency notes (what must precede what)

- **Phase 0 precedes 1, 2, 5, 6, 10** — the `requireGM`/`levels.js`/`canvas-pick.js` seams and the
  helper relocations unblock the gate, the level-API fix, the wizard, the Manager, and the legacy
  deletion.
- **Phase 2 precedes 5, 7, 9** — the fixed `viewLevel`/level-detection is consumed by the guided level
  picker (5), is what makes native auto-on-enter land on the right floor (7), and feeds the overlays'
  level filter / redraw signal (9). The corrected teleport payload (2) is what 7 confirms live.
- **Phase 6's `bindPortals` precedes the link-aware Manager edit** (same phase) and is the write path
  the Manager and direct-connect share.
- **Phase 0 + Phase 6 both precede Phase 10's legacy deletion** — the shared helpers must be fully
  relocated (0) and span-binding folded (6) before `region-adder-dialog.js`/`createMultiLevelRegion`
  can be removed.
- **Phases 1–3 should precede the UI rewrites (4–9)** — correctness/safety on a gated, validated base
  before building UI on top (and 8 specifically must land before any future importer edit-mode).
- **i18n scaffold (Phase 4) precedes the i18n sweep (Phase 10)** — keys/`en.json` exist before the
  bulk wrap.

*This is a proposal. No source files were modified; the only file written is this plan.*
