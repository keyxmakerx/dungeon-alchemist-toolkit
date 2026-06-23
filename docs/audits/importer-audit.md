# Importer Pipeline Audit — Dungeon Alchemist Toolkit (v14)

**Scope.** Read-only audit of the **importer pipeline only**: `scripts/da-importer.js`
(DA folder → Scene + Levels + walls/doors/lights), `scripts/importer-dialog.js`
(ApplicationV2 importer UI with hand-rolled tabs), `templates/importer.hbs`,
the importer-relevant parts of `scripts/constants.js`, and the importer-relevant parts of
`styles/module.css`. Out of scope: the portal/stairs system, `region-adder*`, `main.js`
beyond the importer entry point. This builds on the prior consolidated audit
(`docs/AUDIT.md`) and the strategy in `docs/STRATEGY.md`; items already fixed in v0.1.0
(non-v14 `fog.mode` removed, per-entry wall/light guards added, Region `visibility` magic
int gone, Visible-Levels dropdown machinery removed) are noted as resolved and not
re-litigated.

**Verified vs Inferred disclaimer.** `node --check` passes on all three scripts
(`da-importer.js`, `importer-dialog.js`, `constants.js`) — **VERIFIED**. There is **no
Foundry runtime** here, and the official v14 API docs at `foundryvtt.com/api/v14/...`
return **HTTP 403** to the fetch tool (WebSearch works, WebFetch does not). So every claim
about a v14 **document schema shape** is **INFERRED** from reasoning + WebSearch snippets
unless stated otherwise. WebSearch did confirm two load-bearing facts: v14 replaced the
numeric scene `fog.mode` with **fog *exploration* modes** (Disabled / Individual / Shared),
and TextureData changed in the 14.354 release — both consistent with the current code.
Everything provable from the source text itself (control flow, missing guards, stale
comments, listener lifecycle, CSS) is marked **VERIFIED**. **Do not ship schema-shape fixes
without a live v14 confirmation** — where a fix depends on an exact field name I say so.

---

## Prioritized findings

### IMP-01 — No GM gate on any importer write (Scene.create, FilePicker.upload, createDirectory)
- **Severity:** High
- **Location:** `scripts/da-importer.js:144` (`importFolder` entry), `:324` (`Scene.create`),
  `:85`/`:100` (`createDirectory`), `:128` (`FP.upload`); dialog entry
  `scripts/importer-dialog.js:641` (`#onImport`), `:91` (`#onBrowse`). Grep for
  `isGM`/`canUserModify` in `scripts/` returns **only** the two portal-overlay files —
  nothing in the importer path.
- **Problem:** Nothing checks `game.user.isGM` before browsing, creating world
  directories, uploading files, or calling `Scene.create`. The sidebar button and the
  `DA.Importer()` API are reachable by any user whose client renders the Scenes directory.
- **Why it matters:** STRATEGY §3.6 and HANDOFF §6 both make "**GM-gate every scene write**"
  an explicit, non-negotiable commitment. A non-GM who reaches the dialog will, best case,
  get a confusing server-side permission rejection mid-pipeline (partial folder created,
  some media uploaded, then `Scene.create` throws) — exactly the "corrupt a Scene / leave
  junk behind" failure the strategy wants prevented. Worst case depends on world permission
  config. This is the single clearest violation of a stated guardrail in the whole pipeline.
- **Recommended fix (PATCH):** Add an early guard at the top of `#onImport` **and**
  `importFolder` — `if (!game.user.isGM) { ui.notifications.warn("Only a GM can import a
  Dungeon Alchemist folder."); return null; }`. Belt-and-braces: also gate the sidebar
  button injection in `main.js` on `game.user.isGM` so non-GMs never see the entry point.
  Tiny change, closes the gap completely.
- **Confidence:** VERIFIED (absence of guard is provable; the runtime consequence of an
  ungated write is INFERRED).

### IMP-02 — Hand-rolled tab system is fragile and re-binds listeners on every render
- **Severity:** High (architecture / strategy), Low (runtime today)
- **Location:** `templates/importer.hbs:14-18` (`.da-tab-btn`/`.da-tab-panel`),
  `scripts/importer-dialog.js:208-222` (manual click wiring in `_onRender`),
  `styles/module.css:32-65`.
- **Problem:** Tabs are three `<button class="da-tab-btn">` + three `<div
  class="da-tab-panel">` toggled by a hand-written click handler that flips
  `da-tab-btn--active`, `aria-selected`, and `da-tab-panel--hidden`. The handler is wired
  **inside `_onRender`**, which runs on **every** render — and because nothing removes the
  old listeners, any future `this.render()` (e.g. when the planned "edit existing scene"
  mode lands, per `docs/PLAN.md` Phase 2) stacks duplicate click listeners on the surviving
  buttons. The active tab is **DOM-only state**: a re-render resets the view to the
  template's hard-coded default (Scene Defaults active, `importer.hbs:15`), silently
  throwing away which tab the user was on.
- **Why it matters:** STRATEGY §3.4/§3.5 ("integrate via native extension points",
  "robustness over surface area") and the HANDOFF/PLAN both name this as a planned
  conversion to native ApplicationV2 `static TABS`. Native tabs persist the active tab in
  `this.tabGroups`, auto-bind clicks via the framework (no `_onRender` wiring), survive
  re-renders, and handle ARIA — deleting ~15 lines of JS + the bespoke CSS state classes.
  This is the highest-leverage "reduce custom surface area" win in the dialog.
- **Recommended fix (REWRITE):** Adopt native tabs. Sketch:
  - Add `static TABS = { primary: { tabs: [{id:"scene"},{id:"doors"},{id:"levels"}],
    initial: "scene" } };` (group id `primary`).
  - In the template, mark the nav `<a data-tab="scene" data-group="primary">` and panels
    `<section class="tab" data-tab="scene" data-group="primary">`; let the mixin add
    `.active`. Drop `da-tab-btn--active`/`da-tab-panel--hidden` and their CSS.
  - Delete the `_onRender` tab block (`:208-222`). The framework binds clicks and tracks
    `this.tabGroups.primary`.
  - **Live-verify** the exact `static TABS` shape and the `.tab.active` class name on a v14
    build before deleting the CSS (the v14 ApplicationV2 tab API is INFERRED here).
- **Confidence:** VERIFIED that the current approach is DOM-only and re-binds per render;
  INFERRED on the precise native-TABS API surface.

### IMP-03 — `_onRender` re-binds *all* static-form listeners every render (range, door preview, uniform-height, advanced toggle, info button) + double `_populateLevelsTab`
- **Severity:** Medium
- **Location:** `scripts/importer-dialog.js:193-290`. Listeners added unconditionally each
  render: range `input` (`:203`), door select `change` + body-tooltip `mouseenter/leave`
  (`:233`,`:237`,`:249`), `uniformFloorHeight` `change` (`:258`), `showAdvanced` `change`
  (`:275`), info-icon `click` (`:285`). `_populateLevelsTab()` is called at `:289` **and**
  again inside the uniform-height handler path; `_onBrowse` also calls it (`:122`).
- **Problem:** ApplicationV2 re-rendering replaces the part's DOM, so the *elements* are
  fresh and old listeners die with them — meaning today this is not a leak. But the moment
  any code calls `this.render()` without a full teardown (Phase 2 edit-mode will), or if a
  partial re-render reuses nodes, these handlers double up. The pattern is exactly what the
  prior audit flagged as A5 ("move static-form listeners into `_onFirstRender`"). Separately,
  `_populateLevelsTab` runs a full teardown + rebuild on **every** render even when nothing
  changed (see IMP-09).
- **Why it matters:** Robustness-over-surface-area (STRATEGY §3.5). One-time wiring belongs
  in `_onFirstRender`; per-render work should be idempotent. This is also a prerequisite for
  the tab/edit-mode rewrites — doing those on top of per-render wiring multiplies the bug
  surface.
- **Recommended fix (PATCH, enabling future REWRITE):** Move the range, door-preview,
  uniform-height, advanced-toggle, and info-button wiring into `_onFirstRender(context,
  options)` (bind once). Keep only state-reflecting work (set `advToggle.checked =
  this._advancedView`, sync the range display text) in `_onRender`. Leave
  `_populateLevelsTab()` in `_onRender` but make it cheap (IMP-09).
- **Confidence:** VERIFIED (wiring is unconditional and in `_onRender`); the leak is latent
  until something triggers a re-render.

### IMP-04 — Untrusted DA numeric fields beyond wall.c / light.x,y are passed through unvalidated
- **Severity:** Medium
- **Location:** Scene payload `scripts/da-importer.js:281-296` — `width: first.width`,
  `height: first.height`, `size: first.grid`, `padding: first.padding ?? 0.25`,
  `distance: first.gridDistance ?? 5`. Light config `:505-508` — `dim`/`bright` guarded
  (good), but `color: daLight.tintColor ?? null` and `alpha: daLight.tintAlpha ?? 0.5` are
  pass-through. Wall `:473` — `door: daWall.door ?? 0` pass-through.
- **Problem:** The v0.1.0 hardening guarded `wall.c` (`:467`) and `light.x/y/dim/bright`
  (`:496`,`:505-506`) — good. But the **scene-level** geometry from `floors[0].data`
  (`width`, `height`, `grid`) is taken raw. DA JSON is external (STRATEGY §3.6: "trust
  nothing external"). A missing/`0`/negative/`"123"`-string `width`/`height`/`grid` would
  reach `Scene.create`: `grid: 0` or a non-numeric grid size is the dangerous one (grid size
  has a documented minimum; `0` or `NaN` can fail validation and **abort the entire
  import**, the exact whole-Scene-loss failure mode the per-entry guards were added to
  prevent — except this one isn't per-entry, it's fatal). `door` accepts only `0|1` in the
  v14 wall schema; a stray `2` from a malformed export would fail validation. `tintColor`
  that isn't a valid color string can also fail the LightData color field.
- **Why it matters:** The whole point of the v0.1.0 wall/light guards was "one bad entry
  shouldn't lose every floor." Leaving the scene-wide dimensions and the door/color fields
  unvalidated re-opens a fatal path through a different door. This is the same class of bug
  the strategy explicitly calls out as already-found-and-must-fix.
- **Recommended fix (PATCH):** Validate the three scene dimensions up front with a clear
  toast: `const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0)
  throw new Error(\`first floor JSON has invalid ${name}: ${v}\`); return n; };` for
  `width`/`height`/`grid` (wrap the existing try/catch around `Scene.create`, or fail before
  it with a notification). Clamp `padding`/`distance` to sane finite values. In `_mapWall`,
  coerce `door` to `daWall.door === 1 ? 1 : 0`. In `_mapLight`, drop `color` if it isn't a
  string matching `/^#[0-9a-f]{6}$/i`.
- **Confidence:** VERIFIED that the fields are unvalidated; INFERRED that `grid:0`/`NaN`
  aborts `Scene.create` (consistent with how the wall/light guards were justified, but the
  exact GridData minimum is an INFERRED schema detail — confirm live).

### IMP-05 — Decimal elevations are silently truncated by `parseInt`
- **Severity:** Low
- **Location:** `scripts/importer-dialog.js:658-659` (validation), `:678-679`
  (`levelOverrides` build) — all use `parseInt(..., 10)`. The number inputs declare
  `step="1"` (`importer-dialog.js:561`,`:568`) but the user can still type `7.5`.
- **Problem:** `parseInt("7.5", 10) === 7`. A user who enters fractional elevations gets
  silently floored, and the validation at `:660` (`b >= t`) runs on the truncated values, so
  `bottom=7.5, top=7.9` becomes `7 >= 7` → flagged as an error the user didn't make, or
  `7.2/7.8` → `7/7` silently collapses the level to zero height downstream
  (`Number.isFinite` passes `7`).
- **Why it matters:** Surprising UX (STRATEGY values "robustness"); the user's typed value
  is discarded without a word. Elevations in Foundry are floats.
- **Recommended fix (PATCH):** Use `Number(...)`/`parseFloat(...)` consistently for
  bottom/top in both the validation loop and the override build, keeping the
  `Number.isFinite` gate. `da-importer.js:227-228` already accepts any finite number, so the
  importer side is fine — only the dialog truncates.
- **Confidence:** VERIFIED.

### IMP-06 — Light `config` and Wall docs omit several v14 schema fields (rely on defaults)
- **Severity:** Low (INFERRED could be Medium)
- **Location:** Light `scripts/da-importer.js:504-513`; Wall `:468-476`.
- **Problem:** The emitted `LightData.config` sets `dim/bright/color/alpha/angle/coloration/
  luminosity/animation` but omits v13/v14 fields such as `negative`, `priority`,
  `attenuation`, `darkness:{min,max}`. The wall doc omits `dir`, `threshold`, and — notably
  for a tool that maps DA *sense* restrictions — the v14 wall **`light`** restriction
  (walls in v14 restrict light independently of sight). These rely on the schema applying
  defaults for absent keys.
- **Why it matters:** v14 `DataModel` fills defaults for missing fields on create, so this
  is **almost certainly fine** — but it's worth a deliberate decision: (a) DA walls that
  block sight presumably should also block light; currently `light` defaults (likely to
  `NORMAL`/blocking) rather than being derived from `daWall.sense`, which may or may not
  match intent; (b) `luminosity: 0.5` is a **magic number** with no comment (the scene-level
  `globalLight.luminosity` is `0` at `:307`, an inconsistency). Confirm the light
  restriction default and whether DA exports a separate light flag.
- **Recommended fix (PATCH):** Leave omitted fields to defaults but (1) add a one-line
  comment that defaults are intentional, (2) consider `light: _senseEnum(daWall.sense ?? 1)`
  to mirror sight if DA semantics warrant it, (3) name the `0.5`/`360`/`coloration:1` magic
  numbers with a comment or a small `const`. **Verify the v14 wall `light` field name and
  the LightData defaults on a live build before changing behavior.**
- **Confidence:** INFERRED (schema completeness can't be confirmed offline; field omission
  is VERIFIED).

### IMP-07 — Per-level `fog`/`textures`/`environment` payload assumes v14 Level sub-schema
- **Severity:** Low (INFERRED)
- **Location:** `scripts/da-importer.js:239-244` — each Level emits `foreground:{src,tint,
  alphaThreshold}`, `fog:{src,tint}`, `textures:{anchorX,anchorY,fit,scaleX,scaleY}`.
- **Problem:** The code already correctly dropped `textures.offsetX/offsetY/rotation` (per
  the 14.354 TextureData change — WebSearch-confirmed that 14.354 reworked TextureData) and
  omits scene `fog.mode`. Remaining concern: whether the **Level** document's `fog`
  sub-object still takes `{src, tint}` in v14 (the scene-level fog moved to *exploration*
  modes; the per-Level background-fog overlay may have a different shape now), and whether
  `background`/`foreground` carry the same `alphaThreshold` key. `docs/PLAN.md:160` says the
  Level schema (`_id,name,elevation,background,foreground,fog,textures,visibility,sort,
  flags`) was confirmed against the official v14 API — so the **top-level keys are
  VERIFIED-by-prior-work**, but the **sub-field shapes** of `fog`/`textures` were not
  enumerated there.
- **Why it matters:** A wrong sub-field would fail `Scene.create` for the whole import
  (fatal). Low severity only because prior work confirmed the field names exist; the risk is
  a renamed/removed *sub*-key.
- **Recommended fix:** No code change without live verification. **Action:** on a v14 world,
  create a Level via the native UI and dump `level.toObject()` to confirm `fog`/`textures`/
  `background` sub-keys, then align if needed. Document the confirmation in ARCHITECTURE.
- **Confidence:** INFERRED (top-level keys VERIFIED via PLAN; sub-keys unconfirmed offline).

### IMP-08 — Orphan / mixed-map / roof detection reports inconsistently (console vs toast)
- **Severity:** Low
- **Location:** Orphans → `console.warn` only (`scripts/da-importer.js:391-393`); mixed-map
  → `ui.notifications.warn` (`:166-168`); roof pre-mark → `ui.notifications.info`
  (`importer-dialog.js:118-121`).
- **Problem:** Three "we did something heuristic to your data" signals use three different
  channels. Skipped unpaired files (a `.json` with no media, or vice-versa) warn **only to
  the console** — a GM who mis-exported a folder sees floors silently missing with no
  in-app hint, while the *mixed-map* case (arguably less common) gets a toast. The
  `collectFloorPairs` orphan path is also unreachable from the dialog's eager browse
  (`#onBrowse` discards the return and re-derives), so the orphan warning only fires during
  the second browse inside `importFolder`.
- **Why it matters:** "Validate DA input … degrade gracefully" (STRATEGY §3.6) implies the
  user should *know* when input was dropped. Silent console-only warnings fail that for the
  most common mistake (a missing sibling file).
- **Recommended fix (PATCH):** Surface orphans as a `ui.notifications.warn` (count +
  first few stems) in `importFolder`, mirroring the mixed-map toast. Optionally show the
  orphan/mixed signals in the Levels tab itself (a small banner) so they're visible before
  the user clicks Import.
- **Confidence:** VERIFIED.

### IMP-09 — `_populateLevelsTab` fully tears down + rebuilds the list (innerHTML="") and re-mounts every `<video>`/`<img>` on each render
- **Severity:** Low (magnitude), Medium (code smell)
- **Location:** `scripts/importer-dialog.js:438-622`; called from `_onRender:289`,
  `_onBrowse:122`, `_reorderFloors:430`, uniform-height handler `:264`.
- **Problem:** Every call runs `_teardownThumbVideos()` then `list.innerHTML = ""`
  (`:462`) and rebuilds **all** rows from scratch — new `<input>`s, new `<video>/<img>`
  thumbnails (`_buildThumbEl` at `:526`), re-attached drag/drop and mouseenter/leave
  listeners, re-applied size badges. For a re-render that changed nothing, this thrashes the
  DOM, re-decodes thumbnails (video `preload="metadata"` re-fires), and re-creates N×~6
  listeners. The continuous-capture listener on `list` (`:448-453`) is re-wired because
  `innerHTML=""` keeps the `list` node but a *full* part re-render replaces it — either way
  it's re-attached.
- **Why it matters:** Honest magnitude: a typical DA scene is a **handful of floors** (2–6),
  so the cost is negligible in practice — this is **not** a user-visible perf problem today.
  But it's the kind of "rebuild the world on every render" pattern that becomes a real
  problem the moment edit-mode (Phase 2) starts calling `this.render()` on a 10-floor tower
  with video backgrounds, and it makes the code harder to reason about (every render = full
  teardown). Worth fixing as part of the tabs/edit-mode rewrite, not urgently on its own.
- **Recommended fix (PATCH, fold into REWRITE):** Only rebuild when `_floorPairs` identity
  changed (track a generation token); otherwise reflect `_levelState` into existing inputs
  without re-creating nodes. Better: once tabs are native and rows are template-driven,
  render rows from context in the `.hbs` and reserve imperative work for the thumbnail
  `<video>` lifecycle only. Lowest-effort interim: guard the rebuild with
  `if (this._lastBuiltGen === this._floorGen) return;`.
- **Confidence:** VERIFIED (teardown+rebuild is unconditional); magnitude assessment is a
  judgment call, stated honestly as low for typical inputs.

### IMP-10 — HEAD size-probe is best-effort but issues N parallel requests and only covers local sources
- **Severity:** Low
- **Location:** `scripts/importer-dialog.js:324-353` (`_probeMediaSizes`), constant
  `scripts/constants.js:20` (`MEDIA_SIZE_WARN_BYTES = 50*1024*1024`).
- **Problem:** This is actually **well-guarded** — gated to `data`/`public` sources
  (`:325`), `credentials:"omit"`, `cache:"no-store"`, a 10s AbortController, a
  generation token to discard stale batches, and all failures swallowed (`:345`). Good. The
  minor issues: (a) it fires `Promise.all` over all floors at once — fine for a handful, a
  thundering herd only for pathological floor counts; (b) for **video** floors,
  `Content-Length` from a HEAD is the right signal, but the probe duplicates information the
  browser will fetch anyway when the thumbnail `<video preload="metadata">` mounts —
  arguably the size could be read from the thumbnail load instead of a separate request;
  (c) the warning threshold is a single global constant with no per-image-vs-video
  distinction (a 50 MB still image is far worse than a 50 MB video, but both warn
  identically).
- **Why it matters:** It's a nice-to-have that's already robust; flagging only so the
  redundancy with the thumbnail load is on record. No strategy violation.
- **Recommended fix (PATCH, optional):** Leave as-is (it's defensive and correct). If
  simplifying later, consider deriving size from the thumbnail's network entry or dropping
  the probe in favor of a post-import "scene is large" check. Not worth doing now.
- **Confidence:** VERIFIED (behavior read from source).

### IMP-11 — Body-appended hover tooltips for thumbnails and door preview (custom, not native)
- **Severity:** Low
- **Location:** Level-thumb tooltip `scripts/importer-dialog.js:533-548` (creates
  `.da-level-tooltip` on `document.body`, autoplaying `<video>`); door-preview tooltip
  `:236-252` (`.da-door-tooltip` on `document.body`); CSS `styles/module.css:91-110`,
  `:394-412`; teardown in `_teardownThumbVideos:304-307` and `_onClose:634-637`.
- **Problem:** Two bespoke `position:fixed` tooltips are reparented to `document.body` and
  manually positioned via `getBoundingClientRect()`. The prior audit (AUDIT.md C4) already
  flagged "body-appended hover tooltips → use native `dataset.tooltip`." The size-badge code
  at `:371`/`:374` **does** use `dataset.tooltip` (native) — so the codebase is inconsistent:
  small tooltips are native, the enlarged media preview is hand-rolled. The hand-rolled ones
  carry real lifecycle hazards: an orphaned `.da-level-tooltip` if the list rebuilds
  mid-hover (handled at `:304-307`, but only because someone remembered), and a live
  `<video>` decoder appended to `body` (handled at `:545`).
- **Why it matters:** STRATEGY §3.4/§3.5 — prefer native, minimize custom DOM lifecycle. The
  *enlarged media* preview is a genuine convenience native tooltips can't do (native tooltip
  is text), so this one has *some* justification — unlike the door-preview tooltip, which is
  just a bigger image and could plausibly be a native tooltip or a simpler hover-scale.
- **Recommended fix (PATCH):** Keep the enlarged **media** preview (it's real value) but
  consider scoping it to the dialog element instead of `document.body`, or gate the
  autoplaying video behind a short hover-intent delay so quick passes don't spin up decoders.
  Replace the **door-preview** enlarged tooltip with a native `dataset.tooltip` or a CSS
  hover-scale — it adds lifecycle code for marginal value.
- **Confidence:** VERIFIED.

### IMP-12 — Stale references to the removed "Visible" column in comments/CSS
- **Severity:** Low (hygiene)
- **Location:** `scripts/importer-dialog.js:61` (JSDoc: `"Show advanced columns" state
  (Roof / Start / Visible)`); `styles/module.css:276` (comment: `advanced cells (Roof /
  Start / Visible)`). The Visible-Levels dropdown was removed in v0.1.0 (HANDOFF §3,
  AUDIT B2).
- **Problem:** Comments and a CSS note still describe a "Visible" advanced column that no
  longer exists (the template has only Roof + Start advanced columns,
  `importer.hbs:159-171`, `da-importer.js` visibility now derived solely from the roof
  shortcut). Misleads the next reader into thinking a visibility control is still wired.
- **Why it matters:** Minor, but the prior audit (AUDIT.md E) already noted ARCHITECTURE
  drift; this is the same drift leaking into source comments. Cheap to fix while touching
  these files.
- **Recommended fix (PATCH):** Delete "/ Visible" from both comments.
- **Confidence:** VERIFIED.

### IMP-13 — `#onClose` JSDoc understates what it does; `_onClose` order vs super
- **Severity:** Low (hygiene)
- **Location:** `scripts/importer-dialog.js:624-639`.
- **Problem:** The JSDoc says "Remove any lingering door texture tooltip" but the method
  also tears down all thumbnail videos, aborts the size probe, and removes the level
  tooltip. Accurate enough functionally, but the doc undersells it. (No correctness bug —
  the teardown order is fine and it does call `super._onClose`.)
- **Recommended fix (PATCH):** Update the JSDoc to list all four teardown actions.
- **Confidence:** VERIFIED.

---

## Hand-rolled tabs → native `static TABS`: fragility & rewrite scope

**Current fragility (VERIFIED from source):**
- Active-tab is **DOM-only**; any re-render resets to the template default
  (`importer.hbs:15`) and discards the user's place (IMP-02).
- Click listeners are wired in `_onRender` with no removal, so they **stack** on every
  re-render once edit-mode/Phase-2 introduces `this.render()` calls (IMP-02/IMP-03).
- ARIA (`aria-selected`) and visibility (`da-tab-panel--hidden`) are both hand-maintained in
  the click handler — two sources of truth that can desync.
- The CSS carries bespoke state classes (`da-tab-btn--active`, `da-tab-panel--hidden`,
  `styles/module.css:56-65`) that exist only to reimplement what native tabs style.

**What a native-TABS rewrite entails (small, ~net negative LOC):**
1. `static TABS = { primary: { tabs: [{id:"scene",label:...},{id:"doors",...},
   {id:"levels",...}], initial: "scene" } }`.
2. Template: nav `<a data-tab data-group="primary">`, panels `<section class="tab"
   data-tab data-group="primary">`; remove `da-tab-btn--active`/`da-tab-panel--hidden`.
3. Delete the `_onRender` tab block (`:208-222`); the mixin binds clicks and persists
   `this.tabGroups.primary` across renders.
4. Remove the now-dead CSS state rules; restyle `.tab`/`.active`.
5. **Live-verify** the v14 ApplicationV2 tab contract (the `static TABS` shape, the
   `_prepareTabs`/`changeTab` hooks, and whether the mixin wants `tabGroups` initialized) —
   this is the one INFERRED piece; do it WITH a running v14 world per HANDOFF §7.4, not
   blind. Risk is low because the fallback (tabs don't switch) is obvious and immediate in
   testing.

**Verdict:** REWRITE, and it pairs naturally with IMP-03 (move one-time wiring to
`_onFirstRender`) and IMP-09 (stop rebuilding rows every render). Doing all three together
is the cleanest path and is exactly the "earn every UI / build on native" direction in
STRATEGY §3.

---

## UX problems (specifics)

- **Levels tab discoverability:** the placeholder ("Select a folder above to see level
  rows", `importer.hbs:173`) is only visible *on the Levels tab*, but the folder Browse
  control is *above the tabs*. A user who browses a folder while on the Scene Defaults tab
  gets no signal that the Levels tab now has content. Consider a count badge on the Levels
  tab button after a successful browse. (VERIFIED layout.)
- **Browse flow browses twice:** `#onBrowse` browses eagerly to populate rows
  (`importer-dialog.js:105`) and `importFolder` browses again as source-of-truth
  (`da-importer.js:149`). Functionally fine, but a slow/remote folder is hit twice, and the
  two could disagree if the folder changed between browse and import (rare). (VERIFIED.)
- **Drag-to-reorder is `#`-handle only and HTML5-DnD based** (`importer-dialog.js:516-524`):
  no keyboard alternative, and the drop target is the whole row while the drag source is
  just the index badge — discoverable only via the tooltip "Drag to reorder this floor."
  Acceptable for a power feature; note it's not accessible. (VERIFIED.)
- **Reorder silently restacks elevations** (`_recomputeElevations:402-412`): any manual
  Bottom/Top edits on moved floors are overwritten by the default stack after a drag (names
  and roof are preserved, elevations are not). This is the prior audit's A3/A4 concern
  partially addressed — the behavior is intentional but **undocumented in the UI**; a user
  who hand-tuned elevations then reordered will be surprised. Add a hint or only restack
  default-valued rows. (VERIFIED.)
- **Roof-on-reorder semantics:** the roof flag means "reveal the level at index `i-1`"
  (`da-importer.js:257`), computed at import from final order. `_recomputeElevations` clears
  `isRoof` when a floor lands at index 0 (`:409`) — good — but a roof dragged to a middle
  position now reveals a *different* lower floor than the user intended, silently. (VERIFIED;
  matches prior audit A4, only half-mitigated.)
- **Persistence asymmetry:** scene/door selections persist across opens
  (`_saveCurrentDefaults:176-182`) but Levels-tab edits do not (correctly — they're
  folder-specific). Within a session, Levels edits survive re-renders via the
  continuous-capture listener (`:448-453`) — this is the prior A1/A2 fix and it works.
  (VERIFIED.)
- **Error messaging is generally good** — every failure path has a `ui.notifications`
  toast with context, which satisfies HANDOFF §6. The one gap is orphan files (console-only,
  IMP-08).

---

## Redo opportunities (worth rewriting now, while it's early)

The user wants to "redo as much as possible early," and STRATEGY biases hard toward
**less custom surface area**. Ranked by value:

1. **Native tabs (IMP-02) + one-time wiring (IMP-03) + cheaper row rebuild (IMP-09), as one
   change.** This is the single biggest reduction in custom UI surface in the importer and
   is an explicit planned item (HANDOFF §7.4, PLAN Phase 1). Doing it now — *before* the
   Phase 2 "edit existing scene" mode introduces `this.render()` calls — avoids building
   edit-mode on top of a fragile, leak-prone tab/wiring/rebuild foundation. **REWRITE.**
2. **GM gate everywhere (IMP-01).** Not a rewrite, but do it now and permanently — it's a
   stated guardrail currently unmet, and it's trivial. **PATCH, immediately.**
3. **Input-validation hardening for scene dimensions + door/color (IMP-04).** Finish the job
   the v0.1.0 wall/light guards started so there is **no** remaining fatal path from a
   malformed DA file. Cheap, high-robustness, on-strategy. **PATCH.**
4. **Decide the per-level `fog`/`textures` + light/wall field questions against a live v14
   world (IMP-06, IMP-07).** Not code-now, but the *highest-value verification* — these are
   the only places a schema drift could turn one bad field into a whole-import failure, and
   they can't be settled offline. Bundle into the next live-test session and record the
   result in ARCHITECTURE (which AUDIT.md E already says is stale).
5. **Tooltip consolidation (IMP-11).** Keep the enlarged media preview, drop the bespoke
   door-preview tooltip. Small, aligns the codebase on native `dataset.tooltip`. **PATCH.**

Everything else (IMP-05, -08, -10, -12, -13) is low-cost cleanup to fold in opportunistically
while touching these files.

---

## Top 5 priorities

1. **IMP-01 (High) — Add a `game.user.isGM` gate to `#onImport`/`importFolder` (and the
   sidebar button).** A stated, non-negotiable guardrail (STRATEGY §3.6) is currently unmet;
   any non-GM can drive Scene/file writes. PATCH, trivial. *(VERIFIED)*
2. **IMP-02 (High) — Convert the hand-rolled `.da-tab-btn`/`.da-tab-panel` system to native
   ApplicationV2 `static TABS`.** Removes DOM-only active-tab state and per-render listener
   stacking; the headline "build on native / reduce surface area" win and an already-planned
   item. REWRITE (live-verify the tab API). *(VERIFIED problem; INFERRED API)*
3. **IMP-04 (Medium) — Validate untrusted scene dimensions (`width`/`height`/`grid`) and the
   `door`/`tintColor` fields before `Scene.create`.** Closes the last remaining *fatal*
   whole-import abort path from malformed DA JSON — the same class the v0.1.0 per-entry
   guards targeted. PATCH. *(VERIFIED gap; INFERRED abort behavior)*
4. **IMP-03 (Medium) — Move one-time form wiring (range, door, uniform-height, advanced,
   info) into `_onFirstRender`.** Prevents duplicate listeners once edit-mode adds
   `this.render()`, and is a prerequisite for the tab rewrite. PATCH. *(VERIFIED)*
5. **IMP-06 / IMP-07 (Low offline, High to verify) — Confirm v14 sub-schema shapes for Level
   `fog`/`textures`, the wall `light` restriction, and LightData defaults on a live v14
   world.** The only places offline analysis can't rule out a one-field-fails-the-whole-
   import schema drift; settle them in the next live session and update ARCHITECTURE.
   *(INFERRED — explicitly needs runtime)*
