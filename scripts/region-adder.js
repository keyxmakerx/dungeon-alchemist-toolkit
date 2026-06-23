/**
 * Multi-Level Region Adder (legacy `DA.AddRegion` internals).
 *
 * Foundry v14 native Scene Levels expose Region documents that may be bound to
 * one or many levels via the `levels: string[]` field. Pairing that with a
 * `changeLevel` Region Behavior gives a single shape that acts as a transit
 * point across several floors (stairs, ladders, elevators). `createMultiLevelRegion`
 * wraps the bookkeeping needed to build that payload from a click position and a
 * set of target level IDs.
 *
 * NOTE (Phase 0): the shared helpers `getSceneLevels`/`getCurrentLevelId`
 * (→ `levels.js`) and `pickCanvasRectangle` (→ `canvas-pick.js`) were relocated so
 * the portal system can use them without importing this legacy tool. They are
 * re-exported here so existing importers keep working until this file is retired.
 */

import { getSceneLevels, getCurrentLevelId } from "./levels.js";
import { pickCanvasRectangle } from "./canvas-pick.js";
import { requireGM } from "./util.js";

// Backward-compatible re-exports of the relocated helpers.
export { getSceneLevels, getCurrentLevelId, pickCanvasRectangle };

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
 * @param {number} params.x        World X. Top-left of the rect when width/height
 *                                 are given; otherwise the center of the fallback square.
 * @param {number} params.y        World Y (see `x`).
 * @param {number} [params.width]  Rectangle width (world units, > 0). Omit for a 1-grid square.
 * @param {number} [params.height] Rectangle height (world units, > 0). Omit for a 1-grid square.
 * @param {string[]} params.levelIds  Level _ids the region must appear on.
 * @param {string} [params.name]   Region name; defaults to "Multi-Level Region".
 * @returns {Promise<RegionDocument>}
 */
export async function createMultiLevelRegion({ scene, x, y, width, height, levelIds, name = "Multi-Level Region" }) {
  if (!requireGM()) return null;
  if (!scene) throw new Error("No scene provided.");
  if (!Array.isArray(levelIds) || levelIds.length === 0) {
    throw new Error("levelIds must be a non-empty array.");
  }

  const gridSize = scene.grid?.size ?? 100;
  const levels = getSceneLevels(scene).filter((l) => levelIds.includes(l._id));
  if (levels.length === 0) {
    throw new Error("None of the provided level ids exist on the scene.");
  }

  // Resolve the rectangle. An explicit positive width/height is used as-is
  // (x,y = top-left); otherwise fall back to a 1-grid square centered on (x,y).
  // v14 RectangleShapeData requires strictly positive width/height, so guard it.
  const hasSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  const rect = hasSize
    ? { x, y, width, height }
    : { x: x - gridSize / 2, y: y - gridSize / 2, width: gridSize, height: gridSize };
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    throw new Error("Region rectangle has invalid dimensions.");
  }

  const minBottom = Math.min(...levels.map((l) => l.elevation?.bottom ?? 0));
  const maxTop = Math.max(...levels.map((l) => l.elevation?.top ?? 10));

  const regionData = {
    name,
    color: "#b0cc28",
    elevation: { bottom: minBottom, top: maxTop },
    levels: levelIds,
    // visibility omitted — inherit the v14 default (LAYER_UNLOCKED). The old literal `2`
    // is a magic int against v14's reworked Region visibility enum and may misbehave.
    highlightMode: "shapes",
    displayMeasurements: false,
    hidden: false,
    shapes: [
      {
        type: "rectangle",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        hole: false,
        rotation: 0
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
