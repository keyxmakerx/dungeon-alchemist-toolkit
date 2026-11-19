/**
 * Unit tests for floor names and heights counted from the street-level floor.
 *
 * Runs against the real module (scripts/floor-naming.js), which is pure.
 *
 *   Run:  node test/floor-naming.test.mjs
 */

import { floorKind, floorRange } from "../scripts/floor-naming.js";

let passed = 0, failed = 0;
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}  ${detail}`); }
}
const kind = (...a) => { const k = floorKind(...a); return `${k.kind}${k.n || ""}`; };
const range = (...a) => { const r = floorRange(...a); return `${r.bottom}..${r.top}`; };

console.log("A: what a floor is called");
{
  check("the street-level floor is the ground floor", kind(1, 1) === "ground");
  check("just above it is upper floor 1", kind(2, 1) === "upper1");
  check("two above is upper floor 2", kind(3, 1) === "upper2");
  check("just below it is basement 1", kind(0, 1) === "basement1");
  check("two below is basement 2", kind(0, 2) === "basement2");
  check("a file named roof above the street is a roof", kind(3, 1, true) === "roof");
  check("a file named roof at street level is still the ground floor", kind(1, 1, true) === "ground");
  check("a file named roof below the street is a basement", kind(0, 1, true) === "basement1");
  check("lowest floor at street level: nothing is a basement", kind(0, 0) === "ground" && kind(1, 0) === "upper1");
}

console.log("B: heights");
{
  check("street level starts at 0", range(1, 1, 10) === "0..10");
  check("the floor above starts just over it", range(2, 1, 10) === "11..20");
  check("and the next one over that", range(3, 1, 10) === "21..30");
  check("the floor below ends just under zero", range(0, 1, 10) === "-10..-1");
  check("two below", range(0, 2, 10) === "-20..-11");
  check("another floor height", range(2, 1, 5) === "6..10" && range(0, 1, 5) === "-5..-1");
  check("a bad height falls back to 10", range(1, 1, 0) === "0..10" && range(1, 1, NaN) === "0..10");
  check("a part height is rounded down", range(2, 1, 10.9) === "11..20");

  // A token's height has to belong to exactly one floor.
  const floors = [0, 1, 2, 3, 4].map((i) => floorRange(i, 2, 10));
  let clean = true;
  for (let i = 1; i < floors.length; i++) if (!(floors[i - 1].top < floors[i].bottom)) clean = false;
  check("no two floors share a height", clean, JSON.stringify(floors));
  check("every floor's bottom is below its top", floors.every((f) => f.bottom < f.top));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
