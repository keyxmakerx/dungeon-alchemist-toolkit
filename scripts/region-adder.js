/**
 * Multi-Level Region Adder helpers.
 *
 * Why this module exists:
 * Foundry v14 native Scene Levels expose Region documents that may be bound to
 * one or many levels via the `levels: string[]` field. Pairing that with a
 * `changeLevel` Region Behavior gives a single shape that acts as a transit
 * point across several floors (stairs, ladders, elevators). This module wraps
 * the small amount of bookkeeping needed to build that payload from a click
 * position and a set of target level IDs, mirroring the structure observed in
 * the reference scene `fvtt-Scene-teste-region-level-64LHWi9sQ5kbkNt7.json`.
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
  const candidates = [
    canvas?.scene?.activeLevel?._id,
    canvas?.environment?.activeLevel?._id,
    canvas?.activeLevel?._id,
    game.user?.activeLevel,
    scene.initialLevel
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  const levels = getSceneLevels(scene);
  return levels[0]?._id ?? null;
}

/**
 * Wait for the user's next left-click on the canvas and resolve with the
 * world-space coordinates. Pressing Escape rejects with `"cancelled"`.
 *
 * Implementation note:
 * Listeners are attached in capture phase so they fire before Foundry's own
 * canvas pointer handlers (avoiding accidental token selection / drag).
 *
 * @returns {Promise<{x:number, y:number}>}
 */
export function pickCanvasPosition() {
  return new Promise((resolve, reject) => {
    const view = canvas.app?.view ?? canvas.app?.canvas;
    if (!view) {
      reject(new Error("Canvas view is not available."));
      return;
    }

    /** @param {MouseEvent} event */
    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const pos = canvas.mousePosition;
      cleanup();
      resolve({ x: pos.x, y: pos.y });
    };

    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      reject(new Error("cancelled"));
    };

    const cleanup = () => {
      view.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("da-region-picking");
    };

    view.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("da-region-picking");
  });
}

/**
 * Create a single multi-level Region on the given Scene at the given world
 * coordinates, bound to every level in `levelIds` and carrying a default
 * `changeLevel` behavior. The shape is a 1-grid-square rectangle centered on
 * the click.
 *
 * Why one region (not many): Foundry's Region.levels field is a Set of level
 * ids — one document is enough to make the shape appear on every requested
 * floor, and the `changeLevel` behavior lets the user pick a destination at
 * runtime from that set.
 *
 * @param {object} params
 * @param {Scene} params.scene
 * @param {number} params.x        World X (canvas coords).
 * @param {number} params.y        World Y (canvas coords).
 * @param {string[]} params.levelIds  Level _ids the region must appear on.
 * @param {string} [params.name]   Region name; defaults to "Multi-Level Region".
 * @returns {Promise<RegionDocument>}
 */
export async function createMultiLevelRegion({ scene, x, y, levelIds, name = "Multi-Level Region" }) {
  if (!scene) throw new Error("No scene provided.");
  if (!Array.isArray(levelIds) || levelIds.length === 0) {
    throw new Error("levelIds must be a non-empty array.");
  }

  const gridSize = scene.grid?.size ?? 100;
  const levels = getSceneLevels(scene).filter((l) => levelIds.includes(l._id));
  if (levels.length === 0) {
    throw new Error("None of the provided level ids exist on the scene.");
  }

  const minBottom = Math.min(...levels.map((l) => l.elevation?.bottom ?? 0));
  const maxTop = Math.max(...levels.map((l) => l.elevation?.top ?? 10));

  const regionData = {
    name,
    color: "#b0cc28",
    elevation: { bottom: minBottom, top: maxTop },
    levels: levelIds,
    visibility: 2,
    highlightMode: "shapes",
    displayMeasurements: false,
    hidden: false,
    shapes: [
      {
        type: "rectangle",
        x: x - gridSize / 2,
        y: y - gridSize / 2,
        width: gridSize,
        height: gridSize,
        hole: false,
        anchorX: 0,
        anchorY: 0,
        rotation: 0,
        gridBased: false
      }
    ],
    behaviors: [
      {
        name: "Change Level",
        type: "changeLevel",
        system: {},
        disabled: false,
        flags: {}
      }
    ]
  };

  const created = await scene.createEmbeddedDocuments("Region", [regionData]);
  return created[0];
}
