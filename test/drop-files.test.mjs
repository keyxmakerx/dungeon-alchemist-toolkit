/**
 * Unit tests for deciding what a drag from the desktop is, for the folder-drop
 * import: the toolkit must take an export and leave every other drop alone.
 *
 * Runs against the real module (scripts/drop-files.js), which is pure.
 *
 *   Run:  node test/drop-files.test.mjs
 */

import { looksLikeExportDrag, exportFileNames, safeFolderName } from "../scripts/drop-files.js";

let passed = 0, failed = 0;
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}  ${detail}`); }
}
const file = (type) => ({ kind: "file", type });

console.log("A: a drag in the air");
{
  check("a folder (a file with no type)", looksLikeExportDrag([file("")]) === true);
  check("pictures together with json files", looksLikeExportDrag([file("image/jpeg"), file("application/json")]) === true);
  check("a video together with a json file", looksLikeExportDrag([file("video/webm"), file("application/json")]) === true);
  check("one picture, for a tile, is left alone", looksLikeExportDrag([file("image/png")]) === false);
  check("several pictures are left alone", looksLikeExportDrag([file("image/png"), file("image/webp")]) === false);
  check("a json file on its own is left alone", looksLikeExportDrag([file("application/json")]) === false);
  check("a PDF is left alone", looksLikeExportDrag([file("application/pdf")]) === false);
  check("dragged text is left alone", looksLikeExportDrag([{ kind: "string", type: "text/plain" }]) === false);
  check("a token dragged inside Foundry is left alone", looksLikeExportDrag([{ kind: "string", type: "" }]) === false);
  check("nothing is left alone", looksLikeExportDrag([]) === false && looksLikeExportDrag(undefined) === false);
}

console.log("B: the files that make up floors");
{
  const names = exportFileNames(["Inn-_00.jpg", "Inn-_00.json", "Inn-_01.webm", "Inn-_01.json", "notes.txt", "cover.png", "stray.json"]);
  check("each floor's json and its picture or video", names.slice().sort().join() === "Inn-_00.jpg,Inn-_00.json,Inn-_01.json,Inn-_01.webm", names.join());
  check("a picture with no json is not a floor", exportFileNames(["cover.png"]).length === 0);
  check("a json with no picture is not a floor", exportFileNames(["stray.json"]).length === 0);
  check("nothing in, nothing out", exportFileNames([]).length === 0 && exportFileNames(undefined).length === 0);
}

console.log("C: a safe folder name");
{
  check("a plain name is kept", safeFolderName("Inn by the Lake") === "Inn by the Lake");
  check("path and reserved characters go", safeFolderName('a/b\\c:d*e?f"g<h>i|j#k%l') === "a b c d e f g h i j k l", safeFolderName('a/b\\c:d*e?f"g<h>i|j#k%l'));
  check("it cannot climb out of the folder", !safeFolderName("../../etc").includes("..") && !safeFolderName("../../etc").includes("/"), safeFolderName("../../etc"));
  check("leading and trailing dots and spaces go", safeFolderName("  .hidden. ") === "hidden");
  check("runs of spaces become one", safeFolderName("Inn   by  the Lake") === "Inn by the Lake");
  check("an empty name gets a default", safeFolderName("") === "Dungeon Alchemist map" && safeFolderName(null) === "Dungeon Alchemist map");
  check("a name of only dots gets a default", safeFolderName("...") === "Dungeon Alchemist map");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
