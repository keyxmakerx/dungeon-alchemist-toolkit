# Product Strategy & v14 Positioning

The north-star document. Every feature — existing or proposed — is judged against this.

## 1. North star

**"Dungeon Alchemist → Foundry v14, made effortless."**

We turn a folder of DA floor exports into a finished, **native** v14 multi-level Scene —
walls, doors, lights, levels, and transit between them — in seconds. Our value is
**automation + DA-awareness**, *not* re-implementing things Foundry already does.

## 2. What we are / are not

- **We ARE** a *bridge and automation layer*. We exploit DA-specific context (per-floor
  files, naming, structure, elevations) to do in one click what is otherwise taxing to do
  by hand in native UIs.
- **We are NOT** a replacement for native Levels / Regions / behaviors / navigation. We
  **build on** them, **register into** them, and **defer authoritative editing** to them.

The test for any feature: *"how much are we improving on native?"* If we're not
meaningfully easier/better — ideally by using DA context native can't have — we don't
build it.

## 3. Design principles (guardrails against replace / conflict / bugs)

1. **Build ON native.** Native Levels, Regions V2, native behaviors (`teleportToken`,
   `changeLevel`, `defineSurface`…), and level-aware navigation (`viewLevel`/`cycleLevel`)
   are the substrate. Never shadow or re-create them.
2. **Earn every UI.** Add a tool only where we're clearly easier/better than native —
   especially where we exploit **DA import context**. Otherwise, point users at native.
3. **Pre-populate, don't possess.** Our tools *accelerate and batch* (auto-fill from DA,
   place many things at once); **authoritative ongoing editing stays native.**
4. **Integrate, never parallel.** Extend through documented points (`RegionBehaviorType`,
   the Levels schema, scene controls). **No parallel systems, no scraping native DOM.**
5. **Robustness over surface area.** Less custom code = fewer bugs. Prefer native-backed
   paths; keep features small and testable.
6. **Trust nothing external.** DA exports are external data — validate/clamp before writes;
   GM-gate every scene write; degrade gracefully when native APIs differ.

## 4. Feature positioning

Verdicts: **INVEST** (core value) · **BUILD on native** (real gap we fill) · **TRIM**
(keep only the DA-context value, defer the rest) · **DEFER** (native does it; just use it).

| Capability | What native v14 does | Our added value | Verdict |
|---|---|---|---|
| **Import DA folder → Scene + Levels + walls/doors/lights** | Nothing DA-specific | The whole point: one-click automation from DA exports | **INVEST (core)** |
| **Per-level naming / elevation editing** | Native **Levels tab** (generic, authoritative) | DA-aware *pre-fill* at import time (filenames→names, auto elevations, roof shortcut, media preview) | **TRIM** — import-time only; ongoing editing defers to native (§5) |
| **Stairs / portals between levels** | `teleportToken` (+`destinations`/`revealed`), `changeLevel`, Regions | Linking UX (wizard + click-connect), Stairs Manager, sight-gated player hint overlay, GM link overlay, trap/confirm presets | **BUILD on native** |
| **Area blocking / surfaces** | Native `defineSurface` | None | **DEFER** |
| **Level navigation / floor switching** | Native `viewLevel`/`cycleLevel` | None (we just call them) | **DEFER** |
| **Region shapes** | Native rectangle/poly/ellipse + Ring/Emanation | None (support them) | **DEFER** |

## 5. Level editing: import-time convenience, native for the rest

The DA-aware pre-fill (filenames→names, auto-stacked elevations, roof shortcut, media
preview) lives in the **import flow**, where DA context exists. Ongoing per-floor editing
(rename, re-elevate, reorder, add/remove) lives in the Level Manager
(`scripts/scene-levels-edit.js`), which writes only native `LevelData` fields; level
deletion and cross-level visibility defer to Foundry's native Levels tab (an "Open Scene
Config" shortcut in the Level Manager). No parallel level editor exists.

## 6. How the other docs relate

- `STRATEGY.md` *(this)* — why/what; governs everything.
- `STAIRS-PORTAL-DESIGN.md` — the stairs system's data model, hooks and file layout.
- `ARCHITECTURE.md` — how the shipped code actually works.
