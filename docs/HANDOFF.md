# Handoff & Migration — Dungeon Alchemist Toolkit

**Authoritative continuation doc.** If you're a fresh session picking this up,
read this top-to-bottom first, then `docs/STRATEGY.md` and `docs/STAIRS-TESTING.md`.

---

## 0. TL;DR
- **Project:** *Dungeon Alchemist Toolkit* — a Foundry VTT **v14** module: (1) imports
  Dungeon Alchemist multi-floor exports into one native multi-level Scene, and (2)
  adds a stairs/portal system built on native `teleportToken`.
- **Code lives** on branch **`claude/festive-newton-i8l7nk`** of the fork
  **`keyxmakerx/da-level-importer`** (HEAD `b6cf7de`). You can access that repo.
- **Your first job:** migrate this code into its new home
  **`keyxmakerx/dungeon-alchemist-toolkit`** (§4), then live-test the stairs (§3),
  then continue (§7).
- **License:** GPL-3.0, an independent fork of `github.com/brunocalado/da-level-importer`
  by **Bruno Calado (Mestre Digital)** — keep that attribution (`NOTICE` + README).

## 1. Identity
- module id (machine): `dungeon-alchemist-toolkit` — this is the `MODULE_ID` constant
  AND the install-folder name baked into template paths
  (`modules/dungeon-alchemist-toolkit/...`). Changing it means changing both.
- title: `Dungeon Alchemist Toolkit` · version: `0.1.0`.
- No third-party runtime deps (no socketlib — native `DialogV2.query`/`teleportToken`
  cover what we'd otherwise need sockets for).

## 2. North star & guardrails (full text: `docs/STRATEGY.md`)
The durable value is **DA → Foundry v14 import automation** — exploiting DA-specific
context (per-floor files/names/structure) native can't have. Guardrails:
1. **Build ON native** (Scene Levels, Regions V2, native behaviors `teleportToken`/
   `changeLevel`/`defineSurface`, level-aware nav). Never duplicate or fight native.
2. **Earn every custom UI** — only where we're clearly better, ideally via DA context.
3. **Defer authoritative ongoing editing to native** (we pre-populate/accelerate).
4. **Integrate via documented extension points** — no native-DOM scraping, no parallel
   reimplementations.
5. **Robustness over surface area** — small, native-backed, every flow try/catch-guarded
   with a clear `ui.notifications` toast.
The 4-point test for any feature: (a) does native already do it well? (b) do we make it
meaningfully better via DA context? (c) zero-conflict native integration? (d) small/robust
enough not to be a bug source?

## 3. Current state
**v0.1.0 relaunch — DONE (node-checked, not yet live-tested):**
- Renamed `da-level-importer` → `dungeon-alchemist-toolkit` + GPL-3.0 attribution.
- Hardened the import: removed invalid Scene `fog.mode`; per-entry guards for malformed
  wall `c` / light `x,y` (one bad entry no longer aborts the whole `Scene.create`);
  dropped the Region `visibility` magic int.
- **Removed** the standalone "Edit Levels" mode and the "Visible Levels" dropdown
  (audit-sanctioned; defer that editing to v14's native **Levels tab** in Scene Config).
  Kept the DA-aware import conveniences (filename naming, auto-stacked elevations, roof
  shortcut, media preview).

**Stairs/portal system — BUILT but UNTESTED** (5 modules in `scripts/portal/`):
- API on `window.DA`: `AddStairs()`, `LinkStairs()`, `StairsManager()`; sidebar buttons
  "DA Add Stairs / Portal" and "DA Stairs Manager".
- Modes: `stairs` (cross-level, confirm) · `teleport` (same-level) · `trap` (hidden,
  silent, one-way). Built on native `teleportToken` (`choice` = confirm dialog,
  `revealed` = destination names, `destinations` = multi-target).
- Plus a Stairs Manager panel, a GM-only link overlay, and sight-gated clickable player
  "Stairs" labels.

**⚠️ #1 verify-live item:** `buildTeleportBehavior` in `scripts/portal/portal-core.js`
now reads the live `teleportToken` schema
(`CONFIG.RegionBehavior.dataModels.teleportToken.schema`) and emits only the fields it
declares (core v12–v14: a single `destination` UUID + `choice`), instead of hardcoding the
earlier `destinations`/`revealed` guess. This still wants a live confirm: if a token walks
onto a stair and nothing happens, dump that schema (or an existing teleport region's
`behaviors[0].system`) and align/report. The rest of the verify-live list (level-view API,
LOS test, click-to-use nudge, canvas/PIXI layers) is in `docs/STAIRS-TESTING.md` — all are
feature-detected + guarded, so wrong guesses degrade to "no overlay", never a crash.

## 4. Migration → `keyxmakerx/dungeon-alchemist-toolkit`
1. **Seed the new repo** with this branch's contents (HEAD `b6cf7de`). Preferred (keeps
   history): add the fork as a remote, fetch `claude/festive-newton-i8l7nk`, and push it
   to the new repo's working branch. Acceptable: copy the full file tree as one initial
   commit ("Import Dungeon Alchemist Toolkit v0.1.0 from fork"). Either way, bring ALL
   tracked files (scripts/, templates/, styles/, docs/, module.json, NOTICE, LICENSE,
   README.md, CHANGELOG.md, the demo assets if present).
2. **Fix `module.json` URLs** to the new repo (keep `id`, `title`, `version`, `authors`,
   `flags`):
   - `"url": "https://github.com/keyxmakerx/dungeon-alchemist-toolkit"`
   - `"manifest": "https://raw.githubusercontent.com/keyxmakerx/dungeon-alchemist-toolkit/refs/heads/<BRANCH>/module.json"`
   - `"download": "https://codeload.github.com/keyxmakerx/dungeon-alchemist-toolkit/zip/refs/heads/<BRANCH>"`
   (`<BRANCH>` = the new repo's working branch; switch to `main` once merged.)
3. **README install URL:** replace `da-level-importer` → `dungeon-alchemist-toolkit` in the
   manifest link. **Do NOT touch** the upstream attribution link
   (`github.com/brunocalado/da-level-importer`) in README Credits or in `NOTICE` — those
   are intentional and required by GPL-3.0.
4. **Verify:** `node --check` on every `scripts/**/*.js`. Then
   `git grep da-level-importer` should return ONLY the two attribution references
   (README credits + NOTICE). Anything else is a missed rename.
5. The old fork can then be left as-is; close any open PR upstream on
   `brunocalado/da-level-importer` (a courteous "forking into a standalone project" note).

## 5. Module & doc map
```
scripts/
  main.js              init/ready hooks, window.DA API, sidebar buttons, overlay hooks
  constants.js         MODULE_ID, FLOOR_HEIGHT, settings key, PORTAL_FLAG, size-warn
  da-importer.js       the import pipeline (DA folder -> Scene + Levels + walls/doors/lights)
  importer-dialog.js   the importer UI (ApplicationV2; hand-rolled tabs — see §7.4)
  region-adder.js      legacy helpers + the legacy changeLevel region tool internals
  region-adder-dialog.js  legacy "DA.AddRegion" dialog (no button; superseded by portals)
  portal/
    portal-core.js     data model (portal flag) + createLinkedStairs / linkExistingRegions
    portal-wizard.js   options prompt + place-then-link + direct-connect (LinkStairs)
    portal-manager.js  the Stairs Manager panel (ApplicationV2)
    portal-overlay.js  GM-only link line + portal ring markers (PIXI, hook-driven)
    portal-player-overlay.js  sight-gated clickable player "Stairs" labels
templates/  importer.hbs, region-adder.hbs, portal-manager.hbs
styles/     module.css
docs/       STRATEGY.md, AUDIT.md, REBRAND-PLAN.md, STAIRS-PORTAL-DESIGN.md,
            STAIRS-TESTING.md, ARCHITECTURE.md (provisional), HANDOFF.md (this)
```

## 6. Conventions
- module id everywhere is `dungeon-alchemist-toolkit`.
- Every user-facing flow is `try/catch`-wrapped with a clear `ui.notifications` toast;
  GM-gate writes; validate external DA input.
- No native-DOM scraping; no parallel reimplementation of native v14 features.
- There is **no Foundry runtime in CI** — verify with `node --check` and rely on live
  testing in a v14 world.
- Commits: descriptive message ending in a `Co-Authored-By:` trailer. Never put model
  identifiers in committed artifacts (commit messages, code, docs).

## 7. Next steps (suggested order)
1. **Migrate** (§4); `node --check` green; URLs fixed.
2. **Live-test the stairs** per `docs/STAIRS-TESTING.md`; fix the `teleportToken` schema
   (§3) if needed; then bump to **v0.2.0** + add a CHANGELOG entry.
3. **Retire the legacy `DA.AddRegion`** (changeLevel) tool now that portals supersede it —
   or fold its one useful bit (level-span binding) into the portal flow.
4. **Importer tabs → native ApplicationV2 `static TABS`** (deferred during the relaunch as a
   risky working-code rewrite; do it WITH live verification, not blind).
5. Optional design follow-ups in `docs/STAIRS-PORTAL-DESIGN.md` (relative-position landing,
   active-level overlay redraw once the hook name is confirmed live).
