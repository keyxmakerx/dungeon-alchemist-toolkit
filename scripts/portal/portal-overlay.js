/**
 * GM-only link overlay — draws a faint, translucent line between the two ends of
 * a *same-level* portal link (the "single-layer connection" the maintainer asked
 * for), plus a subtle ring on every portal end on the current level so the GM can
 * see at a glance which regions are stairs/portals.
 *
 * Pure presentation: no document writes, GM-only, redrawn on an event (never per
 * frame). Cross-level links can't be a line (only one end is on screen at a time),
 * so those ends just get the ring marker.
 *
 * ⚠️ Live-v14 notes: this draws into `canvas.controls` with the PIXI v7
 * immediate-mode Graphics API (same approach as the region picker). Both are
 * confirmed present in v14 but are not public-API guarantees; everything here is
 * feature-detected and try/catch-wrapped so a failure degrades to "no overlay"
 * rather than breaking the canvas. The active-level redraw hook name is uncertain
 * — switching levels may need a manual refresh until it's confirmed live.
 */

import { getPortalLinkGroups, regionCenter, regionLevelId } from "./portal-core.js";
import { getCurrentLevelId } from "../levels.js";

/** @type {PIXI.Graphics|null} */
let _overlay = null;
let _drawDebounce = null;

const LINK_COLOR = 0xb0cc28;

/** Lazily (re)create the overlay Graphics on the controls layer. */
function ensureOverlay() {
  if (!canvas?.controls) return null;
  if (_overlay && !_overlay.destroyed && _overlay.parent) return _overlay;
  try {
    _overlay = new PIXI.Graphics();
    _overlay.eventMode = "none";
    _overlay.zIndex = 100;
    canvas.controls.addChild(_overlay);
  } catch (_) {
    _overlay = null;
  }
  return _overlay;
}

/** Remove the overlay (on scene teardown). */
export function teardownPortalOverlay() {
  clearTimeout(_drawDebounce);
  try {
    _overlay?.parent?.removeChild(_overlay);
    _overlay?.destroy();
  } catch (_) { /* ignore */ }
  _overlay = null;
}

/**
 * Redraw the overlay for the current scene + viewed level. GM-only and fully
 * guarded; safe to call from any hook.
 */
export function drawPortalOverlay() {
  if (!game.user?.isGM) return;
  const scene = canvas?.scene;
  const g = ensureOverlay();
  if (!g || !scene) return;

  try {
    g.clear();
    const currentLevel = getCurrentLevelId(scene);
    const ringR = (scene.grid?.size ?? 100) * 0.35;

    for (const [, entries] of getPortalLinkGroups(scene)) {
      const onLevel = entries.filter((e) => {
        const lid = regionLevelId(e.region);
        // If we can't resolve the viewed level, show everything rather than nothing.
        return !currentLevel || lid === currentLevel;
      });

      // Ring marker on each portal end visible on this level.
      for (const e of onLevel) {
        const c = regionCenter(e.region);
        if (!c) continue;
        g.lineStyle(2, LINK_COLOR, 0.5);
        g.drawCircle(c.x, c.y, ringR);
      }

      // Connecting line only when both ends share the current view (same layer).
      if (onLevel.length >= 2) {
        const centers = onLevel.map((e) => regionCenter(e.region)).filter(Boolean);
        const [c0, ...rest] = centers;
        for (const c of rest) {
          g.lineStyle(3, LINK_COLOR, 0.35);
          g.moveTo(c0.x, c0.y);
          g.lineTo(c.x, c.y);
        }
      }
    }
  } catch (err) {
    console.warn("[DA Toolkit] portal overlay draw failed (non-fatal):", err);
  }
}

/** Debounced redraw — coalesces a burst of region edits into one draw. */
function scheduleDraw() {
  clearTimeout(_drawDebounce);
  _drawDebounce = setTimeout(() => drawPortalOverlay(), 120);
}

/**
 * Register the hooks that keep the overlay fresh. Called once at init. Redraws on
 * canvas ready, on a level change (our own `daLevelChanged` signal — emitted when
 * the toolkit switches levels), and on create/update/delete of a Region *on the
 * current scene* (debounced). A native floor switch still has no confirmed core
 * hook; pan or re-open the Manager to refresh in that case.
 */
export function registerPortalOverlayHooks() {
  Hooks.on("canvasReady", () => drawPortalOverlay());
  Hooks.on("canvasTearDown", () => teardownPortalOverlay());
  Hooks.on("daLevelChanged", () => scheduleDraw());
  for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(hook, (doc) => { if (doc?.parent?.id === canvas?.scene?.id) scheduleDraw(); });
  }
}
