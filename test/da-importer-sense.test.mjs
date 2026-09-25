/**
 * Unit tests for _senseEnum's handling of unknown DA wall sense values (#8).
 *
 * Runs against the REAL shipping module (scripts/da-importer.js) — no Foundry
 * runtime needed, since _senseEnum is pure.
 *
 *   Run:  node test/da-importer-sense.test.mjs
 */

import { _senseEnum } from "../scripts/da-importer.js";

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
