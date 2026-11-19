/**
 * Deciding what a drag from the desktop is, for the folder-drop import. Pure
 * (no Foundry, no DOM), so it is unit-tested.
 */

import { collectFloorPairs } from "./floor-grouping.js";

/**
 * Whether something being dragged in from the desktop could be a Dungeon
 * Alchemist export. While a drag is in the air a browser tells only each
 * item's kind and type: a folder is a file with no type, and an export dragged
 * as loose files is pictures or videos together with .json files. Anything
 * else (one picture for a tile, a PDF) is left alone.
 *
 * @param {{kind:string, type:string}[]} items
 * @returns {boolean}
 */
export function looksLikeExportDrag(items) {
  const files = (items ?? []).filter((i) => i?.kind === "file");
  if (!files.length) return false;
  if (files.some((i) => !i.type)) return true;
  const hasJson = files.some((i) => /json/i.test(i.type));
  const hasMedia = files.some((i) => /^(image|video)\//i.test(i.type));
  return hasJson && hasMedia;
}

/**
 * From a list of file names, the ones that make up floors: each floor's .json
 * and the one picture or video paired with it. Stray files are left behind.
 *
 * @param {string[]} names
 * @returns {string[]}
 */
export function exportFileNames(names) {
  const out = [];
  for (const pair of collectFloorPairs(names ?? [])) out.push(pair.json, pair.media);
  return out;
}

/**
 * A folder name that is safe to create inside the world, keeping it readable
 * because the scene may be named after it.
 *
 * @param {string} name
 * @returns {string}
 */
export function safeFolderName(name) {
  const clean = String(name ?? "")
    .replace(/[\\/:*?"<>|#%]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return clean || "Dungeon Alchemist map";
}
