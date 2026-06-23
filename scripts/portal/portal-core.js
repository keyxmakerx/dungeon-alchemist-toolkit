/**
 * Stair / Portal core — data model + create-and-link logic.
 *
 * Design (see docs/STAIRS-PORTAL-DESIGN.md): a "portal" is a native v14 Region
 * carrying a native **`teleportToken`** Region Behavior. We build ON that native
 * behavior — it does the actual move (cross-level, cross-position), supports
 * multiple `destinations`, a `choice` confirm dialog, and `revealed` destination
 * names. This module supplies the gap native lacks: a one-call way to create a
 * *linked pair* (or group) of portal regions and wire their `destinations` at
 * each other, plus a `flags` stamp so the Manager and the GM overlay can find and
 * group them.
 *
 * Live-v14 schema: rather than hardcode guessed field names, `buildTeleportBehavior`
 * reads the running world's behavior schema
 * (`CONFIG.RegionBehavior.dataModels.teleportToken.schema`) and emits exactly the
 * fields it declares (core v12–v14 uses a single `destination` Region UUID +
 * `choice`; we also fill `destinations`/`revealed` if a build exposes them). This
 * matches the rest of the module's feature-detect-and-degrade approach.
 */

import { MODULE_ID, PORTAL_FLAG, FLOOR_HEIGHT } from "../constants.js";
import { getSceneLevels } from "../region-adder.js";

/**
 * Mode presets — map the friendly mode to native `teleportToken` config + look.
 * - stairs/teleport: confirm before moving (`choice`) and show the destination
 *   name (`revealed`); the region is visible. (teleport = same-level link.)
 * - trap: silent (`choice:false`), hidden region, one-way (no return behavior).
 */
export const MODE_PRESETS = {
  stairs:   { choice: true,  revealed: true,  hidden: false, color: "#b0cc28" },
  teleport: { choice: true,  revealed: true,  hidden: false, color: "#28a0cc" },
  trap:     { choice: false, revealed: false, hidden: true,  color: "#cc4628" }
};

/**
 * A Region's global UUID (e.g. "Scene.abc.Region.def"), used as a teleport
 * destination reference.
 * @param {RegionDocument} region
 * @returns {string}
 */
export function regionUuid(region) {
  return region?.uuid ?? `Scene.${region?.parent?.id}.Region.${region?.id}`;
}

/**
 * Read our portal flag off a Region (or null if it isn't a portal).
 * @param {RegionDocument} region
 * @returns {{linkId:string,label:string,mode:string,role:string}|null}
 */
export function getPortalFlag(region) {
  if (!region) return null;
  if (typeof region.getFlag === "function") return region.getFlag(MODULE_ID, PORTAL_FLAG) ?? null;
  return region.flags?.[MODULE_ID]?.[PORTAL_FLAG] ?? null;
}

/**
 * All portal regions on a scene, each with its parsed flag.
 * @param {Scene} scene
 * @returns {{region:RegionDocument, portal:object}[]}
 */
export function getScenePortals(scene) {
  const coll = scene?.regions;
  const regions = coll?.contents ?? Array.from(coll?.values?.() ?? coll ?? []);
  const out = [];
  for (const region of regions) {
    const portal = getPortalFlag(region);
    if (portal) out.push({ region, portal });
  }
  return out;
}

/**
 * Group a scene's portals by their shared `linkId`.
 * @param {Scene} scene
 * @returns {Map<string, {region:RegionDocument, portal:object}[]>}
 */
export function getPortalLinkGroups(scene) {
  const groups = new Map();
  for (const entry of getScenePortals(scene)) {
    const id = entry.portal?.linkId;
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  return groups;
}

/** First level id a region is bound to (portals are single-level). */
export function regionLevelId(region) {
  const lv = region?.levels;
  if (!lv) return null;
  if (lv instanceof Set) return [...lv][0] ?? null;
  if (Array.isArray(lv)) return lv[0] ?? null;
  return [...(lv.values?.() ?? [])][0] ?? null;
}

/** Center point (world coords) of a region's first rectangle shape, or null. */
export function regionCenter(region) {
  const s = region?.shapes?.[0];
  if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.width)) return null;
  return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
}

/**
 * Build the RegionDocument source for one portal end. Bound to a single level
 * (each end can sit on a different floor at a different spot); elevation is set
 * to that level's range so it reads as "on" the floor.
 * @returns {object}
 */
function buildPortalRegionData({ scene, x, y, width, height, levelId, flag, color, hidden }) {
  const level = getSceneLevels(scene).find((l) => l._id === levelId) ?? getSceneLevels(scene)[0];
  const bottom = level?.elevation?.bottom ?? 0;
  const top = level?.elevation?.top ?? bottom + FLOOR_HEIGHT;
  // RectangleShapeData requires strictly positive dimensions.
  const gridSize = scene.grid?.size ?? 100;
  const w = Number.isFinite(width) && width > 0 ? width : gridSize;
  const h = Number.isFinite(height) && height > 0 ? height : gridSize;
  return {
    name: flag.label || "Portal",
    color,
    elevation: { bottom, top },
    levels: levelId ? [levelId] : [],
    // visibility omitted -> inherit the v14 default; `hidden` controls player visibility.
    highlightMode: "shapes",
    hidden: !!hidden,
    shapes: [{ type: "rectangle", x, y, width: w, height: h, hole: false, rotation: 0 }],
    flags: { [MODULE_ID]: { [PORTAL_FLAG]: { ...flag } } }
  };
}

/**
 * Build a native `teleportToken` RegionBehavior source.
 *
 * Emits the `system` payload by reading the LIVE behavior schema so we use the
 * field names the running world actually defines — core v12–v14 uses a single
 * `destination` (Region UUID) + `choice`; we also set `destinations`/`revealed`
 * if a build exposes them. If the schema can't be read we emit a superset; a
 * DataModel drops keys it doesn't know, so the extra keys are harmless.
 *
 * Note: core teleportToken targets ONE destination per behavior, so for a
 * multi-segment group only the first (`primary`) destination is wired from the
 * entrance — the standard entrance→exit pair is unaffected.
 *
 * @param {object} p
 * @param {string[]} p.destinations  Region UUID(s) to teleport into (first = primary).
 * @param {boolean} p.choice         Prompt the player to confirm/pick first.
 * @param {boolean} p.revealed       Reveal destination name(s) in the prompt (if supported).
 * @returns {object}
 */
function buildTeleportBehavior({ destinations, choice, revealed }) {
  const dests = [...destinations];
  const primary = dests[0] ?? null;

  const schema = globalThis.CONFIG?.RegionBehavior?.dataModels?.teleportToken?.schema;
  const hasField = (f) => {
    try { return !!(schema?.has?.(f) || schema?.fields?.[f]); } catch { return false; }
  };

  let system;
  if (schema && (hasField("destination") || hasField("destinations"))) {
    system = {};
    if (hasField("destination"))  system.destination  = primary;
    if (hasField("destinations")) system.destinations = dests;
    if (hasField("choice"))       system.choice       = !!choice;
    if (hasField("revealed"))     system.revealed     = !!revealed;
  } else {
    // Schema unreadable — emit both shapes; the DataModel keeps only valid keys.
    system = { destination: primary, destinations: dests, choice: !!choice, revealed: !!revealed };
  }

  return { name: "Teleport", type: "teleportToken", system, disabled: false, flags: {} };
}

/**
 * Create a linked stair/portal group from a set of placed rectangles.
 *
 * `segments[0]` is the entrance; `segments[1..]` are destination(s). Entering the
 * entrance offers those destination(s) (a confirm/picker when `choice`). When
 * `twoWay`, each destination also links back to the entrance.
 *
 * @param {object} params
 * @param {Scene} params.scene
 * @param {Array<{x:number,y:number,width:number,height:number,levelId:string}>} params.segments
 *        At least 2 (entrance + ≥1 destination).
 * @param {"stairs"|"teleport"|"trap"} [params.mode="stairs"]
 * @param {string} [params.label="Stairs"]  Player-facing name (the region name).
 * @param {boolean} [params.twoWay=true]     Destinations link back to the entrance.
 * @returns {Promise<RegionDocument[]>} The created portal regions (entrance first).
 */
export async function createLinkedStairs({ scene, segments, mode = "stairs", label = "Stairs", twoWay = true }) {
  if (!scene) throw new Error("No scene provided.");
  if (!Array.isArray(segments) || segments.length < 2) {
    throw new Error("A portal needs an entrance and at least one destination.");
  }
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.stairs;
  const linkId = foundry.utils.randomID();
  // Traps are one-way regardless of the twoWay flag (you fall in, you don't climb back).
  const bidirectional = mode === "trap" ? false : twoWay;

  // 1) Create every region first (no behavior yet) so their UUIDs exist.
  const regionData = segments.map((seg, i) =>
    buildPortalRegionData({
      scene,
      x: seg.x, y: seg.y, width: seg.width, height: seg.height,
      levelId: seg.levelId,
      flag: { linkId, label, mode, role: i === 0 ? "entrance" : "destination" },
      color: preset.color,
      // Hide the entrance only for traps; destinations stay as configured.
      hidden: preset.hidden && i === 0
    })
  );
  const regions = await scene.createEmbeddedDocuments("Region", regionData);
  if (!regions?.length) throw new Error("Region creation returned no documents.");

  // 2) Wire teleport behaviors with the now-known UUIDs.
  const uuids = regions.map((r) => regionUuid(r));
  const entrance = regions[0];
  const destUuids = uuids.slice(1);

  await entrance.createEmbeddedDocuments("RegionBehavior", [
    buildTeleportBehavior({ destinations: destUuids, choice: preset.choice, revealed: preset.revealed })
  ]);

  if (bidirectional) {
    for (let i = 1; i < regions.length; i++) {
      await regions[i].createEmbeddedDocuments("RegionBehavior", [
        buildTeleportBehavior({ destinations: [uuids[0]], choice: preset.choice, revealed: preset.revealed })
      ]);
    }
  }

  return regions;
}

/**
 * Link two *existing* regions into a portal pair (direct-connect flow): stamps
 * the portal flag on both and gives each a `teleportToken` behavior pointing at
 * the other. Existing teleport behaviors on those regions are left in place
 * (the caller may want to dedupe).
 *
 * @param {object} params
 * @param {RegionDocument} params.regionA  Entrance.
 * @param {RegionDocument} params.regionB  Destination.
 * @param {"stairs"|"teleport"|"trap"} [params.mode="stairs"]
 * @param {string} [params.label="Stairs"]
 * @param {boolean} [params.twoWay=true]
 * @returns {Promise<void>}
 */
export async function linkExistingRegions({ regionA, regionB, mode = "stairs", label = "Stairs", twoWay = true }) {
  if (!regionA || !regionB) throw new Error("Two regions are required to link.");
  if (regionA === regionB || regionA.id === regionB.id) throw new Error("Cannot link a region to itself.");
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.stairs;
  const linkId = foundry.utils.randomID();
  const bidirectional = mode === "trap" ? false : twoWay;

  await regionA.setFlag(MODULE_ID, PORTAL_FLAG, { linkId, label, mode, role: "entrance" });
  await regionB.setFlag(MODULE_ID, PORTAL_FLAG, { linkId, label, mode, role: "destination" });

  await regionA.createEmbeddedDocuments("RegionBehavior", [
    buildTeleportBehavior({ destinations: [regionUuid(regionB)], choice: preset.choice, revealed: preset.revealed })
  ]);
  if (bidirectional) {
    await regionB.createEmbeddedDocuments("RegionBehavior", [
      buildTeleportBehavior({ destinations: [regionUuid(regionA)], choice: preset.choice, revealed: preset.revealed })
    ]);
  }
}

/**
 * Delete every region in a portal link group (both/all ends).
 * @param {Scene} scene
 * @param {string} linkId
 * @returns {Promise<void>}
 */
export async function deletePortalLink(scene, linkId) {
  const ids = getScenePortals(scene)
    .filter((e) => e.portal?.linkId === linkId)
    .map((e) => e.region.id);
  if (ids.length) await scene.deleteEmbeddedDocuments("Region", ids);
}
