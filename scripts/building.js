/**
 * The building seen from the side: which floors each stair joins, which lane
 * its bar is drawn in, and which floors a party cannot reach from the start
 * floor. Pure (no Foundry), so the Level Manager's picture is unit-tested.
 *
 * Floors are numbered bottom-first, as `getSceneLevels` returns them.
 *
 * @typedef {object} StairSpan
 * @property {string} linkId
 * @property {"stairs"|"teleport"|"trap"} mode
 * @property {number[]} floors   Floor indexes the stair touches (any order, may repeat).
 * @property {boolean} [oneWay]  Only the entrance leads anywhere.
 * @property {number} [from]     Entrance floor index (used when one-way).
 */

/** The lowest and highest floor a stair touches, or null if it touches none. */
export function spanRange(span) {
  const floors = (span?.floors ?? []).filter((f) => Number.isInteger(f) && f >= 0);
  if (!floors.length) return null;
  return { low: Math.min(...floors), high: Math.max(...floors) };
}

/**
 * Give each stair a lane (a column beside the floor stack) so no two bars in
 * one lane overlap. Longer stairs take the inner lanes. A stair that would need
 * more than `maxLanes` columns is left out and counted, so the picture never
 * grows wider than the window.
 *
 * @param {StairSpan[]} spans
 * @param {number} [maxLanes=6]
 * @returns {{placed: Array<StairSpan & {lane:number, low:number, high:number}>, lanes:number, hidden:number}}
 */
export function assignLanes(spans, maxLanes = 6) {
  const ranged = [];
  for (const span of spans ?? []) {
    const r = spanRange(span);
    if (r) ranged.push({ ...span, ...r });
  }
  ranged.sort((a, b) => (b.high - b.low) - (a.high - a.low) || a.low - b.low || String(a.linkId).localeCompare(String(b.linkId)));

  /** @type {Array<Array<{low:number, high:number}>>} */
  const lanes = [];
  const placed = [];
  let hidden = 0;
  for (const span of ranged) {
    let lane = lanes.findIndex((taken) => taken.every((t) => span.high < t.low || span.low > t.high));
    if (lane < 0) {
      if (lanes.length >= maxLanes) { hidden++; continue; }
      lanes.push([]);
      lane = lanes.length - 1;
    }
    lanes[lane].push({ low: span.low, high: span.high });
    placed.push({ ...span, lane });
  }
  return { placed, lanes: lanes.length, hidden };
}

/**
 * Floors a party starting on `startIndex` cannot get to by stairs and
 * teleports. A trap is never counted as a way in: players are not meant to
 * need one. A one-way stair only leads away from its entrance.
 *
 * @param {number} floorCount
 * @param {number} startIndex
 * @param {StairSpan[]} spans
 * @returns {Set<number>}
 */
export function unreachableFloors(floorCount, startIndex, spans) {
  const out = new Set();
  if (!(floorCount > 1)) return out;
  const start = Number.isInteger(startIndex) && startIndex >= 0 && startIndex < floorCount ? startIndex : 0;
  const edges = Array.from({ length: floorCount }, () => new Set());
  for (const span of spans ?? []) {
    if (span?.mode === "trap") continue;
    const floors = [...new Set((span?.floors ?? []).filter((f) => Number.isInteger(f) && f >= 0 && f < floorCount))];
    if (floors.length < 2) continue;
    if (span.oneWay && floors.includes(span.from)) {
      for (const f of floors) if (f !== span.from) edges[span.from].add(f);
    } else {
      for (const a of floors) for (const b of floors) if (a !== b) edges[a].add(b);
    }
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of edges[queue.shift()]) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  for (let i = 0; i < floorCount; i++) if (!seen.has(i)) out.add(i);
  return out;
}

/**
 * Whether any stair or teleport joins two different floors.
 * @param {StairSpan[]} spans
 * @returns {boolean}
 */
export function hasCrossFloorStairs(spans) {
  return (spans ?? []).some((s) => s?.mode !== "trap" && new Set(s?.floors ?? []).size > 1);
}
