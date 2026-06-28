/**
 * GM-only portal overlay — shows, on the current level, what every stair / portal /
 * trap connects to:
 *   • a per-link coloured ring + mode icon on each portal end (each linked pair has
 *     its own stable colour);
 *   • a translucent connecting line + midpoint label between two ends on the SAME
 *     floor;
 *   • a "↑ Floor"/"↓ Floor" badge on an end whose partner is on ANOTHER floor (incl.
 *     the straight up/down case where both ends share x,y — the far end is simply on
 *     a different level, so it gets a badge instead of a line).
 *
 * Pure presentation: no document writes, GM-only, redrawn on an event (never per
 * frame, except a RAF-coalesced redraw while a portal is being dragged).
 *
 * ⚠️ Live-v14 notes: draws into `canvas.controls` with PIXI v7. Everything is
 * feature-detected and try/catch-wrapped, so a failure degrades to "no overlay"
 * rather than breaking the canvas.
 */

import { getPortalLinkGroups, regionCenter, regionLevelId } from "./portal-core.js";
import { getCurrentLevelId, getSceneLevels } from "../levels.js";
import { linkColor } from "./portal-color.js";
import { drawCanvasLabel } from "./canvas-label.js";

/** @type {PIXI.Graphics|null} */
let _overlay = null;
/** @type {PIXI.Container|null} Sibling layer for text (icons, labels, badges). */
let _labels = null;
let _drawDebounce = null;

/** Friendly glyph per portal mode. */
const MODE_GLYPH = { stairs: "🪜", teleport: "🌀", trap: "🕳️" };

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

/** Lazily (re)create the text/icon layer above the graphics. */
function ensureLabelLayer() {
  if (!canvas?.controls) return null;
  if (_labels && !_labels.destroyed && _labels.parent) return _labels;
  try {
    _labels = new PIXI.Container();
    _labels.eventMode = "none";
    _labels.zIndex = 101;
    canvas.controls.addChild(_labels);
  } catch (_) {
    _labels = null;
  }
  return _labels;
}

/** Remove the overlay (on scene teardown). */
export function teardownPortalOverlay() {
  clearTimeout(_drawDebounce);
  try {
    _overlay?.parent?.removeChild(_overlay);
    _overlay?.destroy();
  } catch (_) { /* ignore */ }
  try {
    _labels?.parent?.removeChild(_labels);
    _labels?.destroy({ children: true });
  } catch (_) { /* ignore */ }
  _overlay = null;
  _labels = null;
}

/**
 * Redraw the overlay for the current scene + viewed level. GM-only and fully
 * guarded; safe to call from any hook.
 */
export function drawPortalOverlay() {
  if (!game.user?.isGM) return;
  const scene = canvas?.scene;
  const g = ensureOverlay();
  const labels = ensureLabelLayer();
  if (!g || !scene) return;

  try {
    g.clear();
    if (labels) for (const c of labels.removeChildren()) c.destroy({ children: true });

    const currentLevel = getCurrentLevelId(scene);
    const ringR = (scene.grid?.size ?? 100) * 0.35;

    // Level elevation + name maps, computed once (the overlay redraws often).
    const levels = getSceneLevels(scene);
    const elevById = new Map(levels.map((l) => [l._id, l.elevation?.bottom ?? 0]));
    const nameById = new Map(levels.map((l) => [l._id, l.name || "Level"]));
    const viewedBottom = elevById.get(currentLevel) ?? 0;

    for (const [linkId, entries] of getPortalLinkGroups(scene)) {
      const color = linkColor(linkId);

      // Partition ends: on the viewed level vs elsewhere. If the viewed level can't
      // be resolved, treat everything as on-level (rings + lines, no badges).
      const onLevel = [];
      const offLevel = [];
      for (const e of entries) {
        const lid = regionLevelId(e.region);
        if (!currentLevel || lid === currentLevel) onLevel.push(e);
        else offLevel.push(e);
      }

      // Ring + mode icon on each on-level end.
      const onCenters = [];
      for (const e of onLevel) {
        const c = regionCenter(e.region);
        if (!c) continue;
        g.lineStyle(2, color, 0.65);
        g.drawCircle(c.x, c.y, ringR);
        if (labels) {
          const glyph = MODE_GLYPH[e.portal?.mode] ?? MODE_GLYPH.stairs;
          const icon = new PIXI.Text(glyph, { fontFamily: "Signika, sans-serif", fontSize: Math.max(12, Math.round(ringR * 1.1)) });
          icon.anchor.set(0.5, 0.5);
          icon.x = c.x;
          icon.y = c.y;
          labels.addChild(icon);
        }
        onCenters.push({ e, c });
      }

      // SAME-FLOOR: translucent line + midpoint label between on-level ends. Anchor
      // the line at the entrance end when one is tagged, else the first end.
      if (onCenters.length >= 2 && labels) {
        const anchorIdx = Math.max(0, onCenters.findIndex(({ e }) => e.portal?.role === "entrance"));
        const a = onCenters[anchorIdx];
        for (let i = 0; i < onCenters.length; i++) {
          if (i === anchorIdx) continue;
          const b = onCenters[i];
          g.lineStyle(3, color, 0.4);
          g.moveTo(a.c.x, a.c.y);
          g.lineTo(b.c.x, b.c.y);
          const mid = { x: (a.c.x + b.c.x) / 2, y: (a.c.y + b.c.y) / 2 };
          const lbl = a.e.portal?.label || b.e.portal?.label || "Stairs";
          labels.addChild(drawCanvasLabel(mid, lbl, { fontSize: 13, bg: color, bgAlpha: 0.5 }));
        }
      }

      // CROSS-FLOOR: ↑/↓ badge on each on-level end with off-level partner(s). One
      // badge per distinct partner level (covers straight up/down + multi-destination),
      // stacked upward. Skipped when the viewed level is unknown (no elevation to compare).
      if (offLevel.length && labels && currentLevel) {
        const partnerLids = [...new Set(offLevel.map((e) => regionLevelId(e.region)).filter(Boolean))];
        for (const { c } of onCenters) {
          let stack = 0;
          for (const plid of partnerLids) {
            const up = (elevById.get(plid) ?? 0) > viewedBottom;
            const text = `${up ? "↑" : "↓"} ${nameById.get(plid) ?? "—"}`;
            labels.addChild(drawCanvasLabel(c, text, {
              fontSize: 13, bg: color, bgAlpha: 0.85, offsetY: -10 - stack * 22
            }));
            stack++;
          }
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
 * canvas ready, on a level change (our own `daLevelChanged` signal), and on
 * create/update/delete of a Region *on the current scene* (debounced).
 */
export function registerPortalOverlayHooks() {
  Hooks.on("canvasReady", () => drawPortalOverlay());
  Hooks.on("canvasTearDown", () => teardownPortalOverlay());
  Hooks.on("daLevelChanged", () => scheduleDraw());
  for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(hook, (doc) => { if (doc?.parent?.id === canvas?.scene?.id) scheduleDraw(); });
  }
}
