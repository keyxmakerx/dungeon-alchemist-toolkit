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
 * Live-v14 schema: `buildTeleportBehavior` reads the running world's behavior
 * schema (`CONFIG.RegionBehavior.dataModels.teleportToken.schema`) and emits the
 * fields it declares — preferring v14's canonical plural `destinations` (array of
 * Region UUIDs) over the deprecated singular `destination`, plus `choice`/`revealed`
 * when present. This matches the module's feature-detect-and-degrade approach.
 */

import { MODULE_ID, PORTAL_FLAG, FLOOR_HEIGHT } from "../constants.js";
import { getSceneLevels } from "../levels.js";
import { requireGM, t } from "../util.js";

/**
 * Mode presets — map the friendly mode to native `teleportToken` config + look.
 * - stairs/teleport: confirm before moving (`choice`) and show the destination
 *   name (`revealed`); the region is visible. (teleport = same-level link.)
 * - trap: silent (`choice:false`), hidden region, one-way (no return behavior).
 */
export const MODE_PRESETS = {
  stairs:   { choice: true,  revealed: true,  hidden: false, color: "#b0cc28", verbKey: "DAT.Stairs.VerbStairs" },
  teleport: { choice: true,  revealed: true,  hidden: false, color: "#28a0cc", verbKey: "DAT.Stairs.VerbTeleport" },
  trap:     { choice: false, revealed: false, hidden: true,  color: "#cc4628", verbKey: "" }
};

/**
 * The player-facing action verb for a mode ("Use stairs" / "Teleport"), used as
 * the teleport confirmation/picker message so it doesn't read as the generic
 * "teleport token". Empty for traps (silent, no prompt).
 * @param {string} mode
 * @returns {string}
 */
function modeVerb(mode) {
  const key = (MODE_PRESETS[mode] ?? MODE_PRESETS.stairs).verbKey;
  return key ? t(key) : "";
}

/**
 * A Region's global UUID (e.g. "Scene.abc.Region.def"), used as a teleport
 * destination reference.
 * @param {RegionDocument} region
 * @returns {string}
 */
export function regionUuid(region) {
  if (region?.uuid) return region.uuid;
  // Fabricate only when both ids exist; otherwise throw rather than hand back a
  // broken "Scene.undefined.Region.…" reference that would silently fail teleports.
  if (region?.parent?.id && region?.id) return `Scene.${region.parent.id}.Region.${region.id}`;
  throw new Error("Region has no resolvable UUID (cannot use it as a teleport destination).");
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

/** Synthetic linkId prefix for a legacy (unflagged `changeLevel`) region. */
export const LEGACY_LINK_PREFIX = "legacy:";

/**
 * A Region's behaviors as a plain array, tolerant of the v14 shape
 * (EmbeddedCollection with `.contents`/`.values()`, a Map-like, or an array).
 * @param {RegionDocument} region
 * @returns {object[]}
 */
export function getRegionBehaviors(region) {
  const b = region?.behaviors;
  if (!b) return [];
  if (Array.isArray(b)) return b;
  if (b.contents) return b.contents;
  if (typeof b.values === "function") return Array.from(b.values());
  return Array.from(b);
}

/**
 * A "legacy" stair region: a Region that acts as a floor transit (has a
 * `changeLevel` behavior) but carries no portal flag — the output of the old
 * `createMultiLevelRegion`/`DA.AddRegion` tool. These render on the canvas but
 * were invisible to the flag-based manager; we surface them so they can be
 * adopted or removed.
 * @param {RegionDocument} region
 * @returns {boolean}
 */
export function isLegacyStairRegion(region) {
  if (!region) return false;
  if (getPortalFlag(region)) return false;               // a real portal, not legacy
  return getRegionBehaviors(region).some((bh) => bh?.type === "changeLevel");
}

/**
 * A portal-flag-shaped descriptor synthesized for a legacy region so the shared
 * display paths can treat it as a single-end group. `legacy:true` lets consumers
 * offer Adopt/Remove instead of the linked-pair Edit.
 * @param {RegionDocument} region
 * @returns {{linkId:string,label:string,mode:string,role:string,legacy:boolean}}
 */
export function makeLegacyPortalDescriptor(region) {
  return {
    linkId: LEGACY_LINK_PREFIX + (region.id ?? region._id),
    label: region.name || "Stairs (legacy)",
    mode: "stairs",
    role: "legacy",
    legacy: true
  };
}

/**
 * All portal regions on a scene, each with its parsed flag. With
 * `includeLegacy`, also returns legacy `changeLevel` regions (no portal flag)
 * carrying a synthesized descriptor — used by the read/display paths so a region
 * that renders on the canvas is never invisible to the manager. Write paths call
 * this bare (includeLegacy defaults false) so they only ever see real portals.
 * @param {Scene} scene
 * @param {{includeLegacy?:boolean}} [opts]
 * @returns {{region:RegionDocument, portal:object, legacy?:boolean}[]}
 */
export function getScenePortals(scene, { includeLegacy = false } = {}) {
  const coll = scene?.regions;
  const regions = coll?.contents ?? Array.from(coll?.values?.() ?? coll ?? []);
  const out = [];
  for (const region of regions) {
    const portal = getPortalFlag(region);
    if (portal) { out.push({ region, portal }); continue; }   // flagged wins → never double-counted
    if (includeLegacy && isLegacyStairRegion(region)) {
      out.push({ region, portal: makeLegacyPortalDescriptor(region), legacy: true });
    }
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
  // includeLegacy: surface legacy changeLevel regions too. Each gets a unique
  // synthetic linkId, so it forms its own single-entry group and the existing
  // display loops (dashboard, manager, overlay) render it unchanged.
  for (const entry of getScenePortals(scene, { includeLegacy: true })) {
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

/**
 * Every level id a region is bound to. A flagged portal is always single-level
 * (buildPortalRegionData emits `levels:[levelId]`), but a legacy multi-level
 * region can span several floors — the solo-multi-level display paths use this
 * so such a region is listed on every floor it touches.
 * @param {RegionDocument} region
 * @returns {string[]}
 */
export function regionLevelIds(region) {
  const lv = region?.levels;
  if (!lv) return [];
  if (lv instanceof Set) return [...lv];
  if (Array.isArray(lv)) return [...lv];
  return [...(lv.values?.() ?? [])];
}

/**
 * Center point (world coords) of a region, robust to shape type. Prefers the
 * region's native bounds centroid; falls back to a rectangle center, a polygon
 * points average, then an ellipse center. Returns null if none resolve.
 */
export function regionCenter(region) {
  try {
    const b = region?.object?.bounds ?? region?.bounds;
    if (b && Number.isFinite(b.x) && Number.isFinite(b.width) && (b.width || b.height)) {
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
  } catch (_) { /* fall through to shape math */ }
  const s = region?.shapes?.[0];
  if (!s) return null;
  if (Number.isFinite(s.x) && Number.isFinite(s.width)) {           // rectangle
    const h = Number.isFinite(s.height) ? s.height : s.width;
    return { x: s.x + s.width / 2, y: s.y + h / 2 };
  }
  if (Array.isArray(s.points) && s.points.length >= 4) {            // polygon
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i + 1 < s.points.length; i += 2) { sx += s.points[i]; sy += s.points[i + 1]; n++; }
    if (n) return { x: sx / n, y: sy / n };
  }
  if (Number.isFinite(s.x) && Number.isFinite(s.y)) return { x: s.x, y: s.y }; // ellipse center
  return null;
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
    // Name each end by its floor so the native teleport picker reads by
    // destination ("Use stairs → Ground Floor / Upper Floor"). Editable after.
    name: level?.name || flag.label || "Portal",
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
 * Reads the LIVE behavior schema and emits the field names the running world
 * defines, preferring v14's canonical plural `destinations` (array of Region
 * UUIDs) over the deprecated singular `destination`, plus `choice`/`revealed`
 * when present. If the schema can't be read we emit a superset (plural first); a
 * DataModel drops keys it doesn't declare, so extra keys are harmless.
 *
 * With >1 destination, `choice` is forced on so native doesn't silently land on a
 * random target. The singular-only fallback wires just the first destination.
 *
 * @param {object} p
 * @param {string[]} p.destinations  Region UUID(s) to teleport into (first = primary).
 * @param {boolean} p.choice         Prompt the player to confirm/pick first.
 * @param {boolean} p.revealed       Reveal destination name(s) in the prompt (if supported).
 * @returns {object}
 */
function buildTeleportBehavior({ destinations, choice, revealed, message = "" }) {
  const dests = [...destinations];
  const primary = dests[0] ?? null;
  // >1 destination: force the confirm/picker so native doesn't silently pick at random.
  const wantChoice = dests.length > 1 ? true : !!choice;

  const schema = globalThis.CONFIG?.RegionBehavior?.dataModels?.teleportToken?.schema;
  const hasField = (f) => {
    try { return !!(schema?.has?.(f) || schema?.fields?.[f]); } catch { return false; }
  };

  // One-time diagnostic so the live field names are a single console line.
  if (!buildTeleportBehavior._logged) {
    buildTeleportBehavior._logged = true;
    try {
      console.debug("[DA Toolkit] teleportToken schema fields:", Object.keys(schema?.fields ?? {}));
      const df = schema?.fields?.dialog?.fields;
      if (df) console.debug("[DA Toolkit] teleportToken dialog sub-fields:", Object.keys(df));
    } catch { /* ignore */ }
  }

  let system;
  if (schema && (hasField("destinations") || hasField("destination"))) {
    system = {};
    if (hasField("destinations")) system.destinations = dests;       // v14 canonical (plural)
    else if (hasField("destination")) system.destination = primary;  // deprecated singular fallback
    if (hasField("choice"))   system.choice   = wantChoice;
    if (hasField("revealed")) system.revealed = !!revealed;
  } else {
    // Schema unreadable — emit plural first plus the singular shim; a DataModel
    // drops keys it doesn't declare, so the extra key is harmless.
    system = { destinations: dests, destination: primary, choice: wantChoice, revealed: !!revealed };
  }

  // Custom confirm/picker text so it reads "Use stairs" / "Teleport" instead of the
  // generic native message. v14 added a `dialog` field; its exact sub-schema can't be
  // read offline, so adaptively set only a string sub-field the live build declares
  // (unknown keys are dropped by the DataModel — never breaks creation, and degrades
  // to the native default). The one-time log above prints the real sub-field names.
  if (message && hasField("dialog")) {
    try {
      const df = schema?.fields?.dialog?.fields;
      if (df) {
        const dlg = {};
        for (const k of ["message", "prompt", "text", "content", "label", "title", "description"]) {
          if (df[k]) { dlg[k] = message; break; }
        }
        for (const k of ["display", "enabled", "show", "confirm"]) {
          if (df[k]) { dlg[k] = true; break; }
        }
        if (Object.keys(dlg).length) system.dialog = dlg;
      }
    } catch { /* native default text */ }
  }

  return { name: "Teleport", type: "teleportToken", system, disabled: false, flags: {} };
}

/**
 * Replace a region's teleportToken behavior(s) with a single one pointing at
 * `targets` (or remove it if `targets` is empty). Replacing — rather than
 * appending — keeps re-linking/editing idempotent instead of stacking duplicates.
 *
 * @param {RegionDocument} region
 * @param {string[]} targets   Destination Region UUIDs (empty = remove teleport).
 * @param {{choice:boolean,revealed:boolean}} preset
 */
async function replaceTeleportBehavior(region, targets, preset, message = "") {
  const behaviors = region.behaviors?.contents ?? Array.from(region.behaviors ?? []);
  const stale = behaviors.filter((b) => b.type === "teleportToken").map((b) => b.id);
  if (stale.length) await region.deleteEmbeddedDocuments("RegionBehavior", stale);
  if (targets.length) {
    await region.createEmbeddedDocuments("RegionBehavior", [
      buildTeleportBehavior({ destinations: targets, choice: preset.choice, revealed: preset.revealed, message })
    ]);
  }
}

/**
 * Wire a set of regions into one portal link — the single write path shared by
 * create, direct-connect, and the Manager's link editor. `regions[0]` is the
 * entrance; `regions[1..]` are destinations. Idempotent: reuses an existing
 * `linkId` if any input region already has one, upserts the portal flag, applies
 * the mode's look (color; a trap hides its entrance), and REPLACES each region's
 * teleport behavior (never appends). Traps are one-way regardless of `twoWay`.
 *
 * @param {object} params
 * @param {RegionDocument[]} params.regions  Entrance first, then destination(s).
 * @param {"stairs"|"teleport"|"trap"} [params.mode="stairs"]
 * @param {string} [params.label="Stairs"]
 * @param {boolean} [params.twoWay=true]
 * @returns {Promise<string|null>} the link id, or null if not a GM.
 */
export async function bindPortals({ regions, mode = "stairs", label = "Stairs", twoWay = true }) {
  if (!requireGM()) return null;
  if (!Array.isArray(regions) || regions.length < 2) {
    throw new Error("A portal link needs an entrance and at least one destination.");
  }
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.stairs;
  const bidirectional = mode === "trap" ? false : twoWay;
  // Reuse an existing link id so re-linking/editing converges instead of forking.
  const linkId = regions.map(getPortalFlag).find((f) => f?.linkId)?.linkId ?? foundry.utils.randomID();

  const uuids = regions.map((r) => regionUuid(r));
  const message = modeVerb(mode);
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const isEntrance = i === 0;
    await region.setFlag(MODULE_ID, PORTAL_FLAG, { linkId, label, mode, role: isEntrance ? "entrance" : "destination" });
    try { await region.update({ color: preset.color, hidden: !!(preset.hidden && isEntrance) }); } catch (_) { /* non-fatal */ }
    // Full mesh when two-way: every end reaches every OTHER end, so a spiral
    // staircase's floors all interconnect (from any floor, pick any other). One-way
    // (trap): only the entrance reaches the rest. For 2 ends this is unchanged.
    const targets = bidirectional
      ? uuids.filter((_, j) => j !== i)
      : (isEntrance ? uuids.slice(1) : []);
    await replaceTeleportBehavior(region, targets, preset, message);
  }
  return linkId;
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
  if (!requireGM()) return null;
  if (!scene) throw new Error("No scene provided.");
  if (!Array.isArray(segments) || segments.length < 2) {
    throw new Error("A portal needs an entrance and at least one destination.");
  }
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.stairs;
  const linkId = foundry.utils.randomID();

  // Create every region first (no behavior yet) so their UUIDs exist, then wire
  // the link via the shared bindPortals path (which replaces, never appends).
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

  await bindPortals({ regions, mode, label, twoWay });
  return regions;
}

/**
 * Link two *existing* regions into a portal pair (direct-connect). Delegates to
 * the shared bindPortals path: stamps the portal flag, applies the mode's look,
 * and REPLACES each region's teleport behavior (reusing an existing link id), so
 * re-linking never stacks duplicate behaviors.
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
  if (!requireGM()) return;
  if (!regionA || !regionB) throw new Error("Two regions are required to link.");
  if (regionA === regionB || regionA.id === regionB.id) throw new Error("Cannot link a region to itself.");
  await bindPortals({ regions: [regionA, regionB], mode, label, twoWay });
}

/**
 * Delete every region in a portal link group (both/all ends).
 * @param {Scene} scene
 * @param {string} linkId
 * @returns {Promise<void>}
 */
export async function deletePortalLink(scene, linkId) {
  if (!requireGM()) return;
  // A legacy region is a single Region keyed by a synthetic "legacy:<id>" linkId
  // (kept after the GM gate so a non-GM can't drive the delete).
  if (typeof linkId === "string" && linkId.startsWith(LEGACY_LINK_PREFIX)) {
    const rid = linkId.slice(LEGACY_LINK_PREFIX.length);
    if (scene?.regions?.get?.(rid)) await scene.deleteEmbeddedDocuments("Region", [rid]);
    return;
  }
  const ids = getScenePortals(scene)
    .filter((e) => e.portal?.linkId === linkId)
    .map((e) => e.region.id);
  if (ids.length) await scene.deleteEmbeddedDocuments("Region", ids);
}

/**
 * Adopt a legacy `changeLevel` region as a managed portal by stamping it with a
 * real portal flag (idempotent — a region that already has a flag is left as-is).
 * The region's `changeLevel` behavior is deliberately kept, so runtime transit
 * keeps working; only the manager's view of it changes.
 * @param {Scene} scene
 * @param {string} linkId  A "legacy:<regionId>" synthetic id, or a bare region id.
 * @returns {Promise<string|null>}  The portal linkId now on the region.
 */
export async function adoptLegacyRegion(scene, linkId) {
  if (!requireGM()) return null;
  const rid = (typeof linkId === "string" && linkId.startsWith(LEGACY_LINK_PREFIX))
    ? linkId.slice(LEGACY_LINK_PREFIX.length)
    : linkId;
  const region = scene?.regions?.get?.(rid);
  if (!region) throw new Error("Legacy region not found.");
  const existing = getPortalFlag(region);
  if (existing) return existing.linkId ?? null;
  const newLinkId = foundry.utils.randomID();
  await region.setFlag(MODULE_ID, PORTAL_FLAG, {
    linkId: newLinkId,
    label: region.name || "Stairs",
    mode: "stairs",
    role: "entrance"
  });
  return newLinkId;
}
