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
 * Best-effort detection of the level the user is currently viewing.
 * Foundry v14 surfaces the active level through several candidate properties
 * depending on the canvas pipeline state — we probe each in order and fall
 * back to `scene.initialLevel` then to the bottom-most level.
 *
 * @param {Scene} scene
 * @returns {string|null} Level `_id`, or null if the scene has no levels.
 */
export function getCurrentLevelId(scene) {
  if (!scene) return null;
  const levels = getSceneLevels(scene);
  const validIds = new Set(levels.map((l) => l._id));
  const candidates = [
    canvas?.scene?.activeLevel?._id,
    canvas?.environment?.activeLevel?._id,
    canvas?.activeLevel?._id,
    game.user?.activeLevel,
    scene.initialLevel
  ];
  // Only accept a candidate that is actually a level on this scene; a stale/initial
  // id (e.g. a deleted level) would otherwise mislead the starting-level dropdown.
  for (const c of candidates) {
    if (typeof c === "string" && validIds.has(c)) return c;
  }
  return levels[0]?._id ?? null;
}
