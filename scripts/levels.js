/**
 * Scene-level helpers shared across the importer, the legacy region tool, and the
 * stairs/portal system. Relocated verbatim from `region-adder.js` (Phase 0) so the
 * portal modules can depend on level lookups without importing the legacy tool.
 * `region-adder.js` re-exports these for backward compatibility.
 */

/**
 * Return the active scene's levels sorted by their bottom elevation ascending.
 * Bottom-most floor first, top-most last — so caller indices correspond to
 * "going up = +1, going down = -1" semantics.
 *
 * @param {Scene} scene
 * @returns {object[]} Array of level data objects (plain or document-like).
 */
export function getSceneLevels(scene) {
  if (!scene) return [];
  const collection = scene.levels;
  // v14 may expose either a Collection (with .contents) or a plain array
  // depending on whether the scene was hydrated as a Document.
  // Prefer the Collection's .contents; the array fallback reads .values() so a
  // bare Map yields level objects, not [key, value] entry tuples.
  const levels = collection?.contents
    ? collection.contents.slice()
    : Array.from(collection?.values?.() ?? collection ?? []);
  levels.sort((a, b) => (a.elevation?.bottom ?? 0) - (b.elevation?.bottom ?? 0));
  return levels;
}

/**
 * Detect the level the user is currently viewing, via the documented v14
 * surfaces: the canvas's viewed level, then the user's, then the scene's
 * configured initial level, then the bottom-most floor. Each is probed
 * defensively — a build that lacks one falls through to the next, so the worst
 * case is the bottom-level fallback (the prior effective behavior, never a crash).
 *
 * @param {Scene} scene
 * @returns {string|null} Level `_id`, or null if the scene has no levels.
 */
export function getCurrentLevelId(scene) {
  if (!scene) return null;
  const levels = getSceneLevels(scene);
  const validIds = new Set(levels.map((l) => l._id));
  const candidates = [
    canvas?.level?.id ?? canvas?.level?._id,
    canvas?._viewOptions?.level,
    game.user?.viewedLevel,
    scene.initialLevel
  ];
  // Only accept a candidate that is actually a level on this scene; a stale/initial
  // id (e.g. a deleted level) would otherwise mislead callers.
  for (const c of candidates) {
    if (typeof c === "string" && validIds.has(c)) return c;
  }
  // Diagnosable from the console without a live debugger: if a multi-level scene
  // can't resolve the viewed level, the v14 accessor name differs on this build.
  if (levels.length > 1) {
    console.debug("[DA Toolkit] getCurrentLevelId: no live viewed-level match; falling back to the bottom floor. If stairs bind to the wrong floor, the v14 viewed-level accessor differs on this build.");
  }
  return levels[0]?._id ?? null;
}

/**
 * Switch the viewed level via the documented v14 nav surface:
 * SceneNavigation#viewLevel, else Scene#view({ level }). Guarded — if neither
 * exists on the running build it resolves to a no-op (callers still pan/control).
 * Wrap calls in try/catch at the call site.
 *
 * @param {string} levelId
 */
export async function viewLevel(levelId) {
  if (!levelId) return;
  if (typeof ui?.nav?.viewLevel === "function") {
    await ui.nav.viewLevel(levelId);
  } else if (typeof canvas?.scene?.view === "function") {
    await canvas.scene.view({ level: levelId });
  } else {
    return;
  }
  // No confirmed core hook fires on a level change, so emit our own so the
  // GM/player overlays can redraw for the newly-viewed floor.
  try { Hooks.callAll("daLevelChanged", levelId); } catch (_) { /* ignore */ }
}
