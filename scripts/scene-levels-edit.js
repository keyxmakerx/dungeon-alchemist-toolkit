/**
 * Native Scene-Level write helpers for Level Manager floor editing.
 *
 * A Level is an embedded Scene document on v14, so each edit is an embedded
 * create / update / delete naming only the floor it touches. Every other floor
 * is left alone and keeps its `_id`.
 *
 * Only native LevelData fields (`name`, `elevation`, `sort`, `background.src`)
 * and the Scene's `initialLevel` are written. Cross-level visibility stays in
 * Foundry's Levels tab (`openNativeLevels`).
 *
 * Regions, walls and lights bind to a floor by level `_id`, so rename,
 * re-elevate and reorder keep them attached.
 */

import { getSceneLevels, getInitialLevelId } from "./levels.js";
import { requireGM, t } from "./util.js";

/**
 * Serializes level writes: each task reads the current levels before it
 * writes, so without ordering a later stale read (blur-commit then button
 * action) would act on the wrong elevations.
 * @type {Promise<unknown>}
 */
let _writeChain = Promise.resolve();

/**
 * Enqueue a level-write task so it runs after any in-flight write completes.
 * A throwing task rejects its own promise but does not break the chain.
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
 * Whether this scene keeps its levels as embedded Level documents (v14). A
 * build that does not gets the whole-array write instead.
 * @param {Scene} scene
 * @returns {boolean}
 */
function hasEmbeddedLevels(scene) {
  try {
    if (scene?.constructor?.metadata?.embedded?.Level) return true;
    return scene?.levels?.documentClass?.documentName === "Level";
  } catch (_) {
    return false;
  }
}

/**
 * Whole-array fallback for a build without embedded Level documents: write
 * every floor back with only the target fields changed, then warn if the count
 * or any `_id` drifted.
 *
 * @param {Scene} scene
 * @param {object[]} nextLevels  The complete array (every floor, plain objects).
 * @param {object} [extra]       Extra Scene fields for the same update.
 */
async function writeLevelsArray(scene, nextLevels, extra = {}) {
  await scene.update({ levels: nextLevels, ...extra });
  const afterIds = new Set(getSceneLevels(scene).map((l) => l._id));
  const drifted = afterIds.size !== nextLevels.length || nextLevels.some((l) => !afterIds.has(l._id));
  if (drifted) ui.notifications?.warn?.(t("DAT.Dash.UpdateDrift"));
}

/**
 * Run one level write and report a failure as a toast instead of a rejection.
 *
 * @param {string} context                Short label for the console.
 * @param {() => Promise<T>} write
 * @returns {Promise<T|false>}            The write's result, or false if it threw.
 * @template T
 */
async function attempt(context, write) {
  try {
    return await write();
  } catch (err) {
    console.error(`[DA Toolkit] level write failed (${context}):`, err);
    ui.notifications?.error?.(t("DAT.Dash.UpdateFailed", { error: err.message }));
    return false;
  }
}

/**
 * Apply per-floor changes (each `{_id, ...changed fields}`).
 *
 * @param {Scene} scene
 * @param {object[]} changes
 * @param {string} context
 * @returns {Promise<boolean>}
 */
function updateLevels(scene, changes, context) {
  return attempt(context, async () => {
    if (hasEmbeddedLevels(scene)) {
      await scene.updateEmbeddedDocuments("Level", changes);
      return true;
    }
    const byId = new Map(changes.map((c) => [c._id, c]));
    const next = getSceneLevels(scene).map(levelToObject).map((l) => {
      const c = byId.get(l._id);
      return c ? foundry.utils.mergeObject(l, c, { inplace: false }) : l;
    });
    await writeLevelsArray(scene, next);
    return true;
  });
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
    if (!requireGM()) return false;
    if (!scene || !levelId) return false;
    const target = getSceneLevels(scene).find((l) => l._id === levelId);
    if (!target) return false;

    const change = { _id: levelId };
    if (typeof patch.name === "string" && patch.name.trim() && patch.name.trim() !== target.name) {
      change.name = patch.name.trim();
    }
    // Only apply a fully-numeric, well-ordered elevation (bottom < top); a bad
    // range is ignored here (the Level Manager warns the user separately).
    if (Number.isFinite(patch.bottom) && Number.isFinite(patch.top) && patch.bottom < patch.top) {
      const cur = target.elevation ?? {};
      if (patch.bottom !== cur.bottom || patch.top !== cur.top) {
        change.elevation = { bottom: patch.bottom, top: patch.top };
      }
    }
    if (Object.keys(change).length === 1) return true;     // idempotent — nothing to write
    return updateLevels(scene, [change], `updateLevel ${levelId}`);
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
    if (!requireGM()) return false;
    if (!scene || !levelId) return false;
    const ascending = getSceneLevels(scene).map(levelToObject);   // bottom-first
    const i = ascending.findIndex((l) => l._id === levelId);
    if (i < 0) return false;
    const j = i + (dir > 0 ? 1 : -1);
    if (j < 0 || j >= ascending.length) return false;             // already at an end

    const a = ascending[i], b = ascending[j];
    const band = (l) => ({ bottom: l.elevation?.bottom ?? 0, top: l.elevation?.top ?? 0 });
    return updateLevels(scene, [
      { _id: a._id, elevation: band(b), sort: b.sort ?? j },
      { _id: b._id, elevation: band(a), sort: a.sort ?? i }
    ], `moveLevel ${levelId} ${dir}`);
  });
}

/**
 * Set which floor is shown when the scene loads (native Scene `initialLevel`).
 *
 * @param {Scene} scene
 * @param {string} levelId
 * @returns {Promise<boolean>}
 */
export function setStartLevel(scene, levelId) {
  return enqueue(async () => {
    if (!requireGM()) return false;
    if (!scene || !levelId) return false;
    if (!getSceneLevels(scene).some((l) => l._id === levelId)) return false;
    if (getInitialLevelId(scene) === levelId) return true;       // idempotent
    return attempt("setStartLevel", async () => {
      await scene.update({ initialLevel: levelId });
      return true;
    });
  });
}

/**
 * Swap a single floor's background map image/video. Other fields (elevation, name,
 * visibility) and the level `_id` are preserved — so the floor's stairs, tokens, and
 * lights stay put; only the artwork changes. Ideal for re-exporting one floor from
 * Dungeon Alchemist without rebuilding the scene.
 *
 * @param {Scene} scene
 * @param {string} levelId
 * @param {string} src   New media path.
 * @returns {Promise<boolean>}
 */
export function replaceLevelImage(scene, levelId, src) {
  return enqueue(async () => {
    if (!requireGM()) return false;
    if (!scene || !levelId || !src) return false;
    if (!getSceneLevels(scene).some((l) => l._id === levelId)) return false;
    return updateLevels(scene, [{ _id: levelId, background: { src } }], `replaceLevelImage ${levelId}`);
  });
}

/**
 * Append a new floor above the current top floor, stacked one unit higher with the
 * given height. Inherits the top floor's background color so it matches its siblings.
 *
 * @param {Scene} scene
 * @param {{name?:string, src?:string, height?:number}} [opts]
 * @returns {Promise<string|false>}  The new level's `_id`, or false on failure.
 */
export function addLevel(scene, { name, src, height = 10 } = {}) {
  return enqueue(async () => {
    if (!requireGM()) return false;
    if (!scene) return false;
    const levels = getSceneLevels(scene).map(levelToObject);   // bottom-first
    const sample = levels[levels.length - 1];
    const prevTop = sample?.elevation?.top ?? 0;
    const bottom = levels.length ? prevTop + 1 : 0;
    const h = Number.isFinite(height) && height >= 1 ? height : 10;
    const newLevel = {
      name: name?.trim() || `Floor ${levels.length}`,
      elevation: { bottom, top: bottom + h },
      background: { src: src || null, color: sample?.background?.color ?? null, tint: "#ffffff", alphaThreshold: 0.75 },
      foreground: { src: null, tint: "#ffffff", alphaThreshold: 0.75 },
      fog: { src: null },
      textures: { anchorX: 0.5, anchorY: 0.5, fit: "fill", scaleX: 1, scaleY: 1 },
      visibility: { levels: [] },
      sort: levels.length,
      flags: {}
    };
    return attempt("addLevel", async () => {
      if (hasEmbeddedLevels(scene)) {
        const created = await scene.createEmbeddedDocuments("Level", [newLevel]);
        return created?.[0]?.id ?? false;
      }
      const withId = { _id: foundry.utils.randomID(), ...newLevel };
      await writeLevelsArray(scene, [...levels, withId]);
      return withId._id;
    });
  });
}

/**
 * Remove a floor from the scene. Refuses to remove the last remaining floor. Note
 * this only drops the level entry (its background image); tokens/lights/walls/regions
 * the GM placed on that floor remain in the scene and may need manual cleanup — the
 * Level Manager warns about this before calling.
 *
 * @param {Scene} scene
 * @param {string} levelId
 * @returns {Promise<boolean>}
 */
export function removeLevel(scene, levelId) {
  return enqueue(async () => {
    if (!requireGM()) return false;
    if (!scene || !levelId) return false;
    const levels = getSceneLevels(scene).map(levelToObject);
    if (levels.length <= 1) {
      ui.notifications?.warn?.(t("DAT.Dash.LastFloor"));
      return false;
    }
    const next = levels.filter((l) => l._id !== levelId);
    if (next.length === levels.length) return false;   // id not found
    // The start floor must always point at a surviving level. Hand the role to
    // the new bottom floor before the delete, so the scene is never left
    // pointing at a deleted id.
    const extra = getInitialLevelId(scene) === levelId ? { initialLevel: next[0]._id } : {};
    return attempt(`removeLevel ${levelId}`, async () => {
      if (hasEmbeddedLevels(scene)) {
        if (extra.initialLevel) await scene.update(extra);
        await scene.deleteEmbeddedDocuments("Level", [levelId]);
        return true;
      }
      await writeLevelsArray(scene, next, extra);
      return true;
    });
  });
}

/**
 * Escape hatch: open the scene's native config sheet (where the Levels tab handles
 * cross-level visibility). Best-effort tab switch; falls back to the sheet's
 * default tab if the running build doesn't expose `changeTab`.
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
