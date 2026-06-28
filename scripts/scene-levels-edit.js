/**
 * Native Scene-Level write helpers (P2 — dashboard floor editing).
 *
 * Every edit goes through `scene.update({ levels })` with the COMPLETE levels
 * array — only the target fields changed — so a wholesale array replace can never
 * drop a floor. After each write we read the levels back and warn if the count or
 * any `_id` drifted (worst case is a no-op, never silent data loss).
 *
 * No parallel data model: we only ever write native LevelData fields
 * (`name`, `elevation`, `sort`) and the Scene's `initialLevel`. Deletion and
 * cross-level visibility stay in Foundry's native Levels tab (the dashboard's
 * "Open Scene Config" escape hatch), which handles their cascades safely.
 *
 * Regions/portals bind to a floor by its level `_id` (see portal-core.js
 * `regionLevelId`), so renaming, re-elevating, or reordering a floor keeps its
 * stairs attached.
 */

import { getSceneLevels } from "./levels.js";

/**
 * Serialize all level-array writes. Two edits fired close together (e.g. an input
 * blur-commit immediately followed by a button action) each read the full array,
 * mutate, and write it back; without ordering, the later stale read would clobber
 * the earlier write. The chain guarantees each task reads AFTER the previous wrote.
 * @type {Promise<unknown>}
 */
let _writeChain = Promise.resolve();

/**
 * Enqueue a level-write task so it runs after any in-flight write completes.
 * The chain survives a throwing task (errors are isolated, not swallowed for the
 * caller — the returned promise still rejects).
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueue(task) {
  const run = _writeChain.then(task, task);
  _writeChain = run.then(() => {}, () => {});
  return run;
}

/** Plain-object snapshot of a level (DataModel-safe — strips getters/methods). */
function levelToObject(level) {
  return typeof level?.toObject === "function" ? level.toObject() : foundry.utils.deepClone(level);
}

/**
 * Commit a complete levels array and verify it round-tripped. Must be called from
 * inside an `enqueue`d task (it reads + writes without its own locking).
 *
 * @param {Scene} scene
 * @param {object[]} nextLevels  The complete array (every floor, plain objects).
 * @param {string} context       Short label for diagnostics.
 * @returns {Promise<boolean>}   true if the write was applied (verification only warns).
 */
async function writeAndVerify(scene, nextLevels, context) {
  const beforeIds = new Set(getSceneLevels(scene).map((l) => l._id));
  try {
    await scene.update({ levels: nextLevels });
  } catch (err) {
    console.error(`[DA Toolkit] scene.update(levels) failed (${context}):`, err);
    ui.notifications?.error?.(`Floor update failed: ${err.message}`);
    return false;
  }
  // Read-back verification: the floor count and every id must survive the write.
  const after = getSceneLevels(scene);
  const afterIds = new Set(after.map((l) => l._id));
  if (after.length !== nextLevels.length) {
    console.debug(`[DA Toolkit] level count drift after ${context}: sent ${nextLevels.length}, got ${after.length}`, { after });
    ui.notifications?.warn?.("Floor update may not have applied cleanly — check the Levels tab.");
  } else {
    const missing = [...beforeIds].filter((id) => !afterIds.has(id));
    if (missing.length) {
      console.debug(`[DA Toolkit] level id drift after ${context}: missing ${missing.join(", ")}`, { after });
      ui.notifications?.warn?.("A floor's id changed during the update — check that stairs still connect.");
    }
  }
  return true;
}

/**
 * Rename and/or re-elevate one floor. Empty/invalid fields are skipped, so callers
 * can pass the raw form values without pre-filtering. No-ops (and reports success)
 * when nothing actually changes, so it's safe to call as a "flush" before another
 * action without producing a redundant scene update.
 *
 * @param {Scene} scene
 * @param {string} levelId
 * @param {{name?:string, bottom?:number, top?:number}} patch
 * @returns {Promise<boolean>}
 */
export function updateLevel(scene, levelId, patch = {}) {
  return enqueue(async () => {
    if (!scene || !levelId) return false;
    const levels = getSceneLevels(scene).map(levelToObject);
    const target = levels.find((l) => l._id === levelId);
    if (!target) return false;

    let changed = false;
    if (typeof patch.name === "string" && patch.name.trim() && patch.name.trim() !== target.name) {
      target.name = patch.name.trim();
      changed = true;
    }
    // Only apply a fully-numeric, well-ordered elevation (bottom < top); a bad
    // range is ignored here (the dashboard warns the user separately).
    if (Number.isFinite(patch.bottom) && Number.isFinite(patch.top) && patch.bottom < patch.top) {
      const cur = target.elevation ?? {};
      if (patch.bottom !== cur.bottom || patch.top !== cur.top) {
        target.elevation = { ...cur, bottom: patch.bottom, top: patch.top };
        changed = true;
      }
    }
    if (!changed) return true;     // idempotent — nothing to write
    return writeAndVerify(scene, levels, `updateLevel ${levelId}`);
  });
}

/**
 * Move a floor one slot up or down the building by SWAPPING its elevation band
 * (and `sort`) with the adjacent floor. The set of elevation bands is preserved
 * (no overlaps introduced) — the two floors simply trade vertical position, which
 * is the intuitive result in an elevation-ordered list.
 *
 * @param {Scene} scene
 * @param {string} levelId
 * @param {number} dir   +1 = up (toward higher elevation), -1 = down.
 * @returns {Promise<boolean>}
 */
export function moveLevel(scene, levelId, dir) {
  return enqueue(async () => {
    if (!scene || !levelId) return false;
    const ascending = getSceneLevels(scene).map(levelToObject);   // bottom-first
    const i = ascending.findIndex((l) => l._id === levelId);
    if (i < 0) return false;
    const j = i + (dir > 0 ? 1 : -1);
    if (j < 0 || j >= ascending.length) return false;             // already at an end

    const a = ascending[i], b = ascending[j];
    [a.elevation, b.elevation] = [b.elevation, a.elevation];      // trade bands
    [a.sort, b.sort] = [b.sort, a.sort];                          // keep sort consistent
    return writeAndVerify(scene, ascending, `moveLevel ${levelId} ${dir}`);
  });
}

/**
 * Set which floor is shown when the scene loads (native Scene `initialLevel`).
 * A separate field from the levels array, so it never collides with a level edit.
 *
 * @param {Scene} scene
 * @param {string} levelId
 * @returns {Promise<boolean>}
 */
export function setStartLevel(scene, levelId) {
  return enqueue(async () => {
    if (!scene || !levelId) return false;
    if (!getSceneLevels(scene).some((l) => l._id === levelId)) return false;
    if (scene.initialLevel === levelId) return true;             // idempotent
    try {
      await scene.update({ initialLevel: levelId });
      return true;
    } catch (err) {
      console.error("[DA Toolkit] setStartLevel failed:", err);
      ui.notifications?.error?.(`Couldn't set the start floor: ${err.message}`);
      return false;
    }
  });
}

/**
 * Escape hatch: open the scene's native config sheet (where the Levels tab handles
 * cross-level visibility and floor deletion). Best-effort tab switch; falls back to
 * the sheet's default tab if the running build doesn't expose `changeTab`.
 *
 * @param {Scene} scene
 */
export function openNativeLevels(scene) {
  if (!scene) return;
  try {
    const sheet = scene.sheet;
    if (!sheet) return;
    sheet.render(true);
    if (typeof sheet.changeTab === "function") {
      // Defer so the tab exists in the DOM before we switch to it.
      setTimeout(() => { try { sheet.changeTab("levels", "sheet"); } catch (_) { /* default tab is fine */ } }, 50);
    }
  } catch (err) {
    console.warn("[DA Toolkit] openNativeLevels failed (non-fatal):", err);
  }
}
