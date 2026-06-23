/**
 * Player-facing portal labels (the Stairways-style affordance).
 *
 * For a *player* (not the GM), shows a hoverable "Stairs" label over a portal
 * when their own token can SEE it (line of sight) and is within range; clicking
 * the label uses the stair (we nudge the token onto the region so the native
 * teleportToken behavior fires its confirm + move). Hidden (trap) regions never
 * show a label.
 *
 * ⚠️ Live-v14 / best-effort: this leans on `canvas.visibility.testVisibility`
 * (LOS), `canvas.interface`/`canvas.controls` (a PIXI parent), PIXI v7 Graphics,
 * and owned-token detection — all feature-detected and try/catch-wrapped. If a
 * piece isn't available it simply shows no label (the core walk-in stairs still
 * work). Confirm the LOS call + the click-to-use nudge on a live world and tune.
 */

import { getScenePortals, regionCenter, regionLevelId } from "./portal-core.js";
import { getCurrentLevelId } from "../levels.js";

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
  try {
    _layer = new PIXI.Container();
    _layer.zIndex = 200;
    parent.addChild(_layer);
  } catch (_) {
    _layer = null;
  }
  return _layer;
}

/** Nudge the token onto the region so native teleportToken fires (confirm + move). */
async function usePortal(region, token) {
  try {
    const c = regionCenter(region);
    if (!c || !token?.document) return;
    const gs = canvas?.scene?.grid?.size ?? 100;
    const w = (token.document.width ?? 1) * gs;
    const h = (token.document.height ?? 1) * gs;
    await token.document.update({ x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) });
  } catch (err) {
    ui.notifications?.warn?.("Couldn't use that stair — try walking onto it.");
    console.warn("[DA Toolkit] usePortal failed:", err);
  }
}

function buildLabel(center, text, region, token) {
  const cont = new PIXI.Container();
  cont.x = center.x;
  cont.y = center.y;
  cont.eventMode = "static";
  cont.cursor = "pointer";

  const label = new PIXI.Text(String(text), {
    fontFamily: "Signika, sans-serif",
    fontSize: 16,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 3,
    align: "center"
  });
  label.anchor.set(0.5, 1);
  label.y = -10;

  const padX = 6;
  const padY = 3;
  const bg = new PIXI.Graphics();
  bg.beginFill(0x000000, 0.5);
  bg.drawRoundedRect(-label.width / 2 - padX, -label.height - 10 - padY, label.width + padX * 2, label.height + padY * 2, 4);
  bg.endFill();

  cont.addChild(bg, label);
  cont.on("pointerover", () => cont.scale.set(1.08));
  cont.on("pointerout", () => cont.scale.set(1));
  cont.on("pointerdown", (ev) => {
    ev?.stopPropagation?.();
    usePortal(region, token);
  });
  return cont;
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
      layer.addChild(buildLabel(c, portal.label || region.name || "Stairs", region, token));
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
  for (const h of ["createRegion", "updateRegion", "deleteRegion"]) Hooks.on(h, () => scheduleRefresh());
}
