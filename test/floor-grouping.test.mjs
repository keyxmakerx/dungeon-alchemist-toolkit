/**
 * Unit tests for the DA folder → floor grouping contract.
 *
 * Runs against the REAL shipping module (scripts/floor-grouping.js) — no Foundry
 * runtime needed, since that module is pure. This is the regression guard for the
 * "upload a folder → one scene with one level per floor" fix.
 *
 *   Run:  node test/floor-grouping.test.mjs
 */

import {
  collectFloorPairs,
  distinctMapStems,
  mapName,
  isVideoPath,
  toKebab,
} from "../scripts/floor-grouping.js";

let passed = 0, failed = 0;
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}  ${detail}`); }
}
const P = (files) => collectFloorPairs(files);
// Build sibling image + json URLs for each floor name.
const mk = (names, exts = "jpg") => {
  const e = Array.isArray(exts) ? exts : names.map(() => exts);
  return names.flatMap((n, i) => [`/f/${n}.${e[i]}`, `/f/${n}.json`]);
};

console.log("A: canonical -_NN (the DA demo layout)");
{
  const p = P(mk(["Inn by the Lake-_00", "Inn by the Lake-_01", "Inn by the Lake-_02"]));
  check("3 floors, one map", p.length === 3);
  check("ordered 0,1,2", p.map((x) => x.index).join() === "0,1,2");
  check("scene name from canonical base", mapName(p, "data/Inn by the Lake") === "Inn by the Lake", mapName(p));
  check("no multi-map warning", distinctMapStems(p).length <= 1);
}

console.log("B: custom per-floor names -> one scene, named from folder");
{
  const p = P(mk(["Tavern Ground Floor", "Tavern Cellar", "Tavern Upstairs"]));
  check("3 floors, one scene", p.length === 3);
  check("name from folder", mapName(p, "data/The Prancing Pony") === "The Prancing Pony", mapName(p, "data/The Prancing Pony"));
  check("no false 'multiple maps' warning", distinctMapStems(p).length <= 1);
}

console.log("C/D: alternative numbering schemes still order + stay one map");
{
  const c = P(mk(["Dungeon_0", "Dungeon_1"]));
  check("Map_N ordered", c.map((x) => x.index).join() === "0,1");
  check("Map_N no false warning", distinctMapStems(c).length <= 1);
  const d = P(mk(["Keep - 0", "Keep - 1"], "png"));
  check("'Map - N' ordered", d.map((x) => x.index).join() === "0,1");
  check("'Map - N' name", mapName(d, "") === "Keep", mapName(d, ""));
}

console.log("E: TWO genuine DA maps in one folder -> warn, never drop");
{
  const p = P(mk(["Inn-_00", "Inn-_01", "Castle-_00"]));
  check("warns (2 distinct canonical bases)", distinctMapStems(p).length === 2, JSON.stringify(distinctMapStems(p)));
  check("still 3 pairs (merged into one scene, nothing dropped)", p.length === 3);
}

console.log("F: numeric (not lexical) ordering across padding");
{
  const p = P(mk(["Tower-_0", "Tower-_1", "Tower-_10", "Tower-_2"]));
  check("ordered 0,1,2,10 (not 0,1,10,2)", p.map((x) => x.index).join() === "0,1,2,10", p.map((x) => x.index).join());
}

console.log("G: lone single floor");
{
  const p = P(mk(["Goblin Cave"]));
  check("1 floor, no warning", p.length === 1 && distinctMapStems(p).length <= 1);
  check("name from stem when no folder", mapName(p, "") === "Goblin Cave", mapName(p, ""));
}

console.log("H: media preference + orphan surfacing");
{
  const p = P(["/f/Map-_00.jpg", "/f/Map-_00.webp", "/f/Map-_00.json", "/f/Lonely.json"]);
  check("1 paired floor", p.length === 1);
  check("prefers webp over jpg", p[0].media.endsWith(".webp"), p[0].media);
  check("orphan reported", p.orphans.length === 1 && /Lonely/.test(p.orphans[0]));
}

console.log("I: folder-name fallback; generic folder skipped");
{
  const p = P(mk(["Cellar", "Attic", "Ballroom"]));
  check("name from descriptive folder", mapName(p, "data/Haunted Manor") === "Haunted Manor", mapName(p, "data/Haunted Manor"));
  check("generic folder 'data' skipped -> a floor base", ["Cellar", "Attic", "Ballroom"].includes(mapName(p, "data")), mapName(p, "data"));
}

console.log("J: no-separator / bare-number indices");
{
  const p = P(mk(["Vault2", "Vault10", "Vault1"]));
  check("Vault1,2,10 numeric order", p.map((x) => x.stem).join() === "Vault1,Vault2,Vault10", p.map((x) => x.stem).join());
  const q = P(["/f/0.jpg", "/f/0.json", "/f/1.jpg", "/f/1.json"]);
  check("bare '0'/'1' -> indices 0,1", q.map((x) => x.index).join() === "0,1");
  check("bare-number scene name from folder", mapName(q, "data/Sewers") === "Sewers", mapName(q, "data/Sewers"));
}

console.log("K: duplicate index never drops a floor (stable tiebreak)");
{
  const p = P(["/f/A-_00.jpg", "/f/A-_00.json", "/f/B-_00.jpg", "/f/B-_00.json"]);
  check("both floors survive", p.length === 2, String(p.length));
  check("stable discovery order on tie", p.map((x) => x.stem).join() === "A-_00,B-_00", p.map((x) => x.stem).join());
}

console.log("L: URL-encoded / trailing-slash folder paths");
{
  const q = P(mk(["Foo", "Bar"]));
  check("URL-decoded folder used", mapName(q, "data/My%20Keep/") === "My Keep", mapName(q, "data/My%20Keep/"));
}

console.log("M: media helpers");
{
  check("isVideoPath webm", isVideoPath("x/scene.webm") === true);
  check("isVideoPath jpg", isVideoPath("x/scene.jpg") === false);
  check("isVideoPath tolerates query", isVideoPath("x/scene.mp4?123") === true);
  check("toKebab strips + lowercases", toKebab("Inn by the Lake!") === "inn-by-the-lake", toKebab("Inn by the Lake!"));
}

console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
