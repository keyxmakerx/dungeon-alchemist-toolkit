/**
 * Unit tests for the side view of the building: which lane each stair's bar is
 * drawn in, and which floors cannot be reached from the start floor.
 *
 * Runs against the real module (scripts/building.js), which is pure.
 *
 *   Run:  node test/building.test.mjs
 */

import { spanRange, assignLanes, unreachableFloors, hasCrossFloorStairs } from "../scripts/building.js";

let passed = 0, failed = 0;
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}  ${detail}`); }
}
const stair = (linkId, floors, extra = {}) => ({ linkId, mode: "stairs", floors, ...extra });
const list = (set) => [...set].sort((a, b) => a - b).join();

console.log("A: the floors a stair touches");
{
  check("lowest and highest", JSON.stringify(spanRange(stair("a", [2, 0, 1]))) === '{"low":0,"high":2}');
  check("one floor is a span of one", JSON.stringify(spanRange(stair("a", [3, 3]))) === '{"low":3,"high":3}');
  check("no floors gives null", spanRange(stair("a", [])) === null);
  check("a floor that no longer exists is ignored", JSON.stringify(spanRange(stair("a", [-1, 2]))) === '{"low":2,"high":2}');
  check("nothing at all gives null", spanRange(undefined) === null);
}

console.log("B: lanes");
{
  const { placed, lanes, hidden } = assignLanes([stair("short", [0, 1]), stair("long", [0, 3]), stair("top", [2, 3])]);
  const lane = (id) => placed.find((p) => p.linkId === id)?.lane;
  check("the longest stair takes the first lane", lane("long") === 0, String(lane("long")));
  check("two stairs that do not overlap share a lane", lane("short") === lane("top") && lane("short") === 1);
  check("two lanes in all", lanes === 2 && hidden === 0);
  check("each bar carries its range", placed.find((p) => p.linkId === "top").low === 2 && placed.find((p) => p.linkId === "top").high === 3);

  const touching = assignLanes([stair("a", [0, 1]), stair("b", [1, 2])]);
  check("stairs that meet on a floor get separate lanes", touching.lanes === 2);

  const many = assignLanes(Array.from({ length: 5 }, (_, i) => stair(`s${i}`, [0, 1])), 3);
  check("no more lanes than asked for", many.lanes === 3 && many.placed.length === 3);
  check("the rest are counted, not dropped silently", many.hidden === 2);

  const gone = assignLanes([stair("gone", []), stair("ok", [0, 1])]);
  check("a stair with no floors is left out of the picture", gone.placed.length === 1 && gone.hidden === 0);
  check("no stairs, no lanes", assignLanes([]).lanes === 0 && assignLanes(undefined).placed.length === 0);
}

console.log("C: floors that cannot be reached from the start floor");
{
  check("no stairs: every other floor is cut off", list(unreachableFloors(3, 0, [])) === "1,2");
  check("a single floor is never cut off", unreachableFloors(1, 0, []).size === 0);
  check("a stairwell joins all its floors", unreachableFloors(3, 0, [stair("w", [0, 1, 2])]).size === 0);
  check("a chain of stairs reaches the top", unreachableFloors(3, 0, [stair("a", [0, 1]), stair("b", [1, 2])]).size === 0);
  check("a gap leaves the far floors cut off", list(unreachableFloors(4, 0, [stair("a", [0, 1]), stair("b", [2, 3])])) === "2,3");
  check("counted from the start floor, not the lowest", list(unreachableFloors(4, 3, [stair("a", [0, 1]), stair("b", [2, 3])])) === "0,1");
  check("a trap is never a way in", list(unreachableFloors(2, 0, [stair("t", [0, 1], { mode: "trap" })])) === "1");
  check("a teleport between floors counts", unreachableFloors(2, 0, [stair("t", [0, 1], { mode: "teleport" })]).size === 0);
  check("a one-way stair leads away from its entrance", unreachableFloors(2, 0, [stair("d", [0, 1], { oneWay: true, from: 0 })]).size === 0);
  check("and not back", list(unreachableFloors(2, 0, [stair("d", [0, 1], { oneWay: true, from: 1 })])) === "1");
  check("a stair on one floor joins nothing", list(unreachableFloors(2, 0, [stair("s", [0, 0])])) === "1");
  check("a bad start floor falls back to the lowest", list(unreachableFloors(2, 9, [])) === "1");
}

console.log("D: is anything joined at all");
{
  check("nothing yet", hasCrossFloorStairs([]) === false);
  check("a stair between two floors", hasCrossFloorStairs([stair("a", [0, 1])]) === true);
  check("a teleport within one floor does not count", hasCrossFloorStairs([stair("a", [1, 1], { mode: "teleport" })]) === false);
  check("a trap does not count", hasCrossFloorStairs([stair("a", [0, 1], { mode: "trap" })]) === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
