/**
 * Floor names and heights counted from the street, the way a building is used:
 * the floor at street level starts at 0, floors under it are basements below
 * zero, floors over it count up. Pure (no Foundry), so it is unit-tested.
 *
 * Floors are numbered bottom-first.
 */

/**
 * What a floor is, relative to the street-level floor.
 *
 * @param {number} index        This floor's index (0 = lowest).
 * @param {number} groundIndex  Index of the street-level floor.
 * @param {boolean} [roofNamed] The file's name says "roof".
 * @returns {{kind:"roof"|"basement"|"ground"|"upper", n:number}}
 *   `n` counts away from the street: Basement 1 is just under it, Upper floor 1
 *   just over it. It is 0 for the ground floor and for a roof.
 */
export function floorKind(index, groundIndex, roofNamed = false) {
  const k = index - groundIndex;
  if (k > 0 && roofNamed) return { kind: "roof", n: 0 };
  if (k < 0) return { kind: "basement", n: -k };
  if (k === 0) return { kind: "ground", n: 0 };
  return { kind: "upper", n: k };
}

/**
 * A floor's default height range. Ranges never share a number, so a token's
 * height always belongs to exactly one floor.
 *
 * @param {number} index
 * @param {number} groundIndex
 * @param {number} height  Height of one floor, at least 1.
 * @returns {{bottom:number, top:number}}
 */
export function floorRange(index, groundIndex, height) {
  const h = Number.isFinite(height) && height >= 1 ? Math.floor(height) : 10;
  const k = index - groundIndex;
  if (k === 0) return { bottom: 0, top: h };
  if (k > 0) return { bottom: k * h + 1, top: (k + 1) * h };
  return { bottom: k * h, top: (k + 1) * h - 1 };
}
