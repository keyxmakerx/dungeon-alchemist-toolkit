/**
 * Unit tests for how a Dungeon Alchemist wall becomes a Foundry wall.
 *
 * Runs against the REAL shipping module (scripts/da-importer.js) — no Foundry
 * runtime needed, since the mapping is pure.
 *
 *   Run:  node test/da-importer-sense.test.mjs
 */

import { _senseEnum, _mapWall } from "../scripts/da-importer.js";

let passed = 0, failed = 0;
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}  ${detail}`); }
}

console.log("A: known DA values map to the correct v14 enum");
{
  check("0 -> NONE (0)", _senseEnum(0) === 0);
  check("1 -> NORMAL (20)", _senseEnum(1) === 20);
  check("2 -> LIMITED (10)", _senseEnum(2) === 10);
}

console.log("B: an unknown value falls back to NONE and warns instead of failing silently");
{
  const calls = [];
  const origWarn = console.warn;
  console.warn = (...args) => calls.push(args.join(" "));
  try {
    const result = _senseEnum(3);
    check("unknown value 3 -> NONE (0)", result === 0, `got ${result}`);
    check("warns once about the unknown value", calls.length === 1, `got ${calls.length} warnings`);
    check("warning names the offending value", calls[0]?.includes("3"), calls[0]);
  } finally {
    console.warn = origWarn;
  }
}

console.log("C: light follows sight, so a window lets light through");
{
  const c = [0, 0, 100, 0];
  const wall = _mapWall({ c, move: 1, sense: 1, sound: 1, door: 0 }, "L1");
  check("solid wall blocks sight and light", wall.sight === 20 && wall.light === 20, JSON.stringify(wall));
  const win = _mapWall({ c, move: 1, sense: 0, sound: 0, door: 0 }, "L1");
  check("window blocks movement only", win.move === 20 && win.sight === 0 && win.light === 0, JSON.stringify(win));
  const lim = _mapWall({ c, move: 1, sense: 2, sound: 1, door: 0 }, "L1");
  check("limited wall limits sight and light", lim.sight === 10 && lim.light === 10, JSON.stringify(lim));
  check("wall is bound to its floor", wall.levels.join() === "L1");
}

console.log("D: doors");
{
  const c = [0, 0, 100, 0];
  check("door stays a door", _mapWall({ c, door: 1 }, "L1").door === 1);
  check("secret door stays a secret door", _mapWall({ c, door: 2 }, "L1").door === 2);
  check("an unknown door value becomes a plain wall", _mapWall({ c, door: 7 }, "L1").door === 0);
  const tex = _mapWall({ c, door: 2 }, "L1", "door.webp", "woodBasic");
  check("secret door takes the chosen texture and sound", tex.animation?.texture === "door.webp" && tex.doorSound === "woodBasic", JSON.stringify(tex));
  check("a plain wall takes neither", _mapWall({ c, door: 0 }, "L1", "door.webp", "woodBasic").animation === undefined);
  check("a malformed wall is skipped", _mapWall({ c: [0, 0, NaN, 0] }, "L1") === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
if (failed > 0) process.exit(1);
