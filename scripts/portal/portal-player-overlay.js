/**
 * Player-facing stair labels. A label shows over a stair when the player's own
 * token is near it and can see it; clicking the label walks that token there.
 *
 * The click only starts an ordinary move of the player's own token along a
 * path Foundry's own pathfinder found, so walls and locked doors stop it the
 * same as a drag would, and the stair fires exactly as if the player had
 * walked. Where there is no pathfinder the label falls back to a hint and
 * moves nothing. Traps, and the far end of a one-way stair, get no label.
 *
 * Everything here is feature-detected and wrapped: if a canvas API is missing,
 * no label shows and walking onto the stair still works.
 */

import { getScenePortals, getRegionBehaviors, regionCenter, regionLevelId } from "./portal-core.js";
import { getCurrentLevelId } from "../levels.js";
import { drawCanvasLabel } from "./canvas-label.js";
import { t } from "../util.js";

/** @type {PIXI.Container|null} */
let _layer = null;
let _debounce = null;
let _walking = false;

/** A token the current (non-GM) user owns, preferring the controlled one. */
function ownedToken() {
  const placeables = canvas?.tokens?.placeables ?? [];
  return (
    canvas?.tokens?.controlled?.[0] ??
    placeables.find((t) => t.actor?.isOwner || t.document?.isOwner) ??
    null
  );
}

/**
 * Whether stepping on this region takes a token anywhere. The far end of a
 * one-way link has no transit behavior, so it gets no "use me" hint.
 */
function isUsable(region) {
  return getRegionBehaviors(region).some((b) =>
    (b?.type === "teleportToken" || b?.type === "changeLevel") && !b.disabled);
}

/** Best-effort line-of-sight test from the token to a point. */
function hasSight(token, point) {
  try {
    if (typeof canvas?.visibility?.testVisibility === "function") {
      return canvas.visibility.testVisibility(point, { object: token });
    }
  } catch (_) { /* fall through */ }
  return true; // can't test -> don't hide
}

function ensureLayer() {
  const parent = canvas?.interface ?? canvas?.controls;
  if (!parent) return null;
  if (_layer && !_layer.destroyed && _layer.parent) return _layer;
  // Self-heal: a prior layer detached by a canvas rebuild (without canvasTearDown)
  // is destroyed here rather than leaked.
  try { _layer?.destroy({ children: true }); } catch (_) { /* ignore */ }
  _layer = null;
  try {
    _layer = new PIXI.Container();
    _layer.zIndex = 200;
    parent.addChild(_layer);
  } catch (_) {
    _layer = null;
  }
  return _layer;
}

/** Where a token's top-left corner goes so that it stands on the stair. */
function standingSpot(token, region, center) {
  const doc = token.document;
  const half = { x: (token.w ?? 0) / 2, y: (token.h ?? 0) / 2 };
  const plain = { x: center.x - half.x, y: center.y - half.y };
  try {
    const snapped = doc?.getSnappedPosition?.(plain);
    if (!Number.isFinite(snapped?.x) || !Number.isFinite(snapped?.y)) return plain;
    // A stair drawn off the grid can be missed by a snapped token: then stand
    // on its exact centre instead.
    const inside = region?.testPoint?.({ x: snapped.x + half.x, y: snapped.y + half.y, elevation: doc.elevation ?? 0 });
    return inside === false ? plain : { x: snapped.x, y: snapped.y };
  } catch (_) {
    return plain;
  }
}

/** Walk the player's own token onto a stair, the way a drag would. */
async function walkToStair(token, region, center) {
  const doc = token?.document;
  if (typeof token?.findMovementPath !== "function" || typeof doc?.move !== "function") {
    ui.notifications?.info?.(t("DAT.Stairs.UseHint"));
    return;
  }
  try {
    const dest = standingSpot(token, region, center);
    const job = token.findMovementPath([{ x: doc.x, y: doc.y, elevation: doc.elevation }, dest], {});
    const path = (await job?.promise) ?? job?.result ?? null;
    const last = Array.isArray(path) ? path[path.length - 1] : null;
    // The pathfinder hands back as far as it got: only a path that ends on the
    // stair is walked, so a token is never left halfway to a closed door.
    if (!last || Math.abs(last.x - dest.x) > 1 || Math.abs(last.y - dest.y) > 1) {
      ui.notifications?.info?.(t("DAT.Stairs.WalkNoPath"));
      return;
    }
    const steps = path.length > 1 ? path.slice(1) : path;
    const arrived = await doc.move(steps, {});
    if (arrived === false) ui.notifications?.info?.(t("DAT.Stairs.WalkStopped"));
  } catch (err) {
    console.warn("[DA Toolkit] walking to the stair failed (non-fatal):", err);
    ui.notifications?.info?.(t("DAT.Stairs.UseHint"));
  }
}

function buildLabel(token, region, center, text) {
  return drawCanvasLabel(center, t("DAT.Stairs.WalkLabel", { label: text }), {
    interactive: true,
    cursor: "pointer",
    onClick: (ev) => {
      ev?.stopPropagation?.();
      // One walk at a time: a second click mid-walk would queue a second move.
      if (_walking) return;
      _walking = true;
      walkToStair(token, region, center).finally(() => { _walking = false; });
    }
  });
}

/** Recompute and redraw the player's portal labels (own token, current level). */
export function refreshPlayerPortalLabels() {
  if (game.user?.isGM) return; // the GM has the overlay and the Level Manager
  const scene = canvas?.scene;
  const layer = ensureLayer();
  if (!scene || !layer) return;

  try {
    for (const child of layer.removeChildren()) child.destroy({ children: true });

    const token = ownedToken();
    if (!token) return;
    const tc = token.center ?? { x: token.x, y: token.y };
    const currentLevel = getCurrentLevelId(scene);
    const gs = scene.grid?.size ?? 100;
    const range = gs * 4; // near enough to mean it

    for (const { region, portal } of getScenePortals(scene)) {
      // Neither end of a trap is labelled: the landing spot would give it away.
      if (region.hidden || portal.mode === "trap") continue;
      if (!isUsable(region)) continue;
      if (currentLevel && regionLevelId(region) !== currentLevel) continue; // current level only
      const c = regionCenter(region);
      if (!c) continue;
      if (Math.hypot(c.x - tc.x, c.y - tc.y) > range) continue;      // proximity cull first
      if (!hasSight(token, c)) continue;                              // then the LOS test
      layer.addChild(buildLabel(token, region, c, portal.label || region.name || t("DAT.Stairs.DefaultName")));
    }
  } catch (err) {
    console.warn("[DA Toolkit] player portal labels failed (non-fatal):", err);
  }
}

function scheduleRefresh() {
  clearTimeout(_debounce);
  _debounce = setTimeout(() => refreshPlayerPortalLabels(), 120); // debounce token churn
}

export function teardownPlayerPortalLabels() {
  clearTimeout(_debounce);
  _debounce = null;
  try {
    _layer?.parent?.removeChild(_layer);
    _layer?.destroy({ children: true });
  } catch (_) { /* ignore */ }
  _layer = null;
}

/** Register the player-overlay hooks once at init (no-op for the GM at draw time). */
export function registerPlayerPortalHooks() {
  Hooks.on("canvasReady", () => scheduleRefresh());
  Hooks.on("canvasTearDown", () => teardownPlayerPortalLabels());
  Hooks.on("controlToken", () => scheduleRefresh());
  Hooks.on("updateToken", () => scheduleRefresh());
  Hooks.on("sightRefresh", () => scheduleRefresh());
  Hooks.on("daLevelChanged", () => scheduleRefresh());
  for (const h of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(h, (doc) => { if (doc?.parent?.id === canvas?.scene?.id) scheduleRefresh(); });
  }
}
