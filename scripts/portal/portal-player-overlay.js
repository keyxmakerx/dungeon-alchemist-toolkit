/**
 * Player-facing portal labels (a sight-gated hint, Stairways-style).
 *
 * For a *player* (not the GM), shows a "Stairs" hint label over a portal when
 * their own token can SEE it (line of sight) and is within range. The label is a
 * HINT, not an actuator: using a stair is the native behavior — walk the token
 * onto the region and the native teleportToken fires its confirm + move. (A
 * client-side token move issued by a player is unreliable and violates GM
 * authority, so it was removed; a real GM-relayed click-to-use is deferred to a
 * future phase behind a confirmed transport.) Hidden (trap) regions never show a
 * label.
 *
 * ⚠️ Live-v14 / best-effort: leans on `canvas.visibility.testVisibility` (LOS),
 * `canvas.interface`/`canvas.controls` (a PIXI parent), PIXI v7 Graphics, and
 * owned-token detection — all feature-detected and try/catch-wrapped. If a piece
 * isn't available it simply shows no label (native walk-in stairs still work).
 */

import { getScenePortals, regionCenter, regionLevelId } from "./portal-core.js";
import { getCurrentLevelId } from "../levels.js";
import { drawCanvasLabel } from "./canvas-label.js";
import { t } from "../util.js";

/** @type {PIXI.Container|null} */
let _layer = null;
let _debounce = null;

/** A token the current (non-GM) user owns, preferring the controlled one. */
function ownedToken() {
  const placeables = canvas?.tokens?.placeables ?? [];
  return (
    canvas?.tokens?.controlled?.[0] ??
    placeables.find((t) => t.actor?.isOwner || t.document?.isOwner) ??
    null
  );
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

function buildLabel(center, text) {
  // The sight-gated "Stairs" hint shares the canvas-label builder with the GM
  // overlay; the player-specific bit is the click hint, passed as onClick.
  return drawCanvasLabel(center, text, {
    interactive: true,
    cursor: "help",
    onClick: (ev) => {
      ev?.stopPropagation?.();
      ui.notifications?.info?.(t("DAT.Stairs.UseHint"));
    }
  });
}

/** Recompute and redraw the player's portal labels (own token, current level). */
export function refreshPlayerPortalLabels() {
  if (game.user?.isGM) return; // GM uses the Manager + GM overlay
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
    const range = gs * 4; // ~4 squares — "in range" to use

    for (const { region, portal } of getScenePortals(scene)) {
      if (region.hidden) continue;                                   // traps stay invisible
      if (currentLevel && regionLevelId(region) !== currentLevel) continue; // current level only
      const c = regionCenter(region);
      if (!c) continue;
      if (Math.hypot(c.x - tc.x, c.y - tc.y) > range) continue;      // proximity cull first
      if (!hasSight(token, c)) continue;                              // then the LOS test
      layer.addChild(buildLabel(c, portal.label || region.name || "Stairs"));
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
