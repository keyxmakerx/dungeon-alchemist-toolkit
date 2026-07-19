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

import { getPortalLinkGroups, regionCenter, regionLevelId, getPortalFlag } from "./portal-core.js";
import { getCurrentLevelId, getSceneLevels } from "../levels.js";
import { linkColor } from "./portal-color.js";
import { drawCanvasLabel } from "./canvas-label.js";

/** @type {PIXI.Graphics|null} */
let _overlay = null;
/** @type {PIXI.Container|null} Sibling layer for text (icons, labels, badges). */
let _labels = null;
let _drawDebounce = null;
/** Pending requestAnimationFrame/timeout id for the fast (drag) redraw path. */
let _raf = null;
/** One-time diagnostic so live testing can confirm the drag hook actually fires. */
let _refreshSeen = false;
/** Hover/select info-card (a DOM element) + the region id it's pinned to (selected). */
let _card = null;
let _pinnedId = null;
/** Per-on-level-end card content, keyed by region id; rebuilt every draw. */
const _cardInfo = new Map();

/** Friendly glyph per portal mode. */
const MODE_GLYPH = { stairs: "🪜", teleport: "🌀", trap: "🕳️" };
/** Cross-floor direction arrows — swap to "^"/"v" here if a build renders these as tofu. */
const ARROW_UP = "↑";
const ARROW_DOWN = "↓";

/** Lazily (re)create the overlay Graphics on the controls layer. */
function ensureOverlay() {
  if (!canvas?.controls) return null;
  if (_overlay && !_overlay.destroyed && _overlay.parent) return _overlay;
  // Self-heal: a prior instance detached by a canvas rebuild (without canvasTearDown)
  // is destroyed here rather than leaked.
  try { _overlay?.destroy({ children: true }); } catch (_) { /* ignore */ }
  _overlay = null;
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
  try { _labels?.destroy({ children: true }); } catch (_) { /* ignore */ }
  _labels = null;
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
  if (_raf != null) {
    try { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(_raf); } catch (_) { /* ignore */ }
    try { clearTimeout(_raf); } catch (_) { /* ignore */ }
    _raf = null;
  }
  try {
    _overlay?.parent?.removeChild(_overlay);
    _overlay?.destroy();
  } catch (_) { /* ignore */ }
  try {
    _labels?.parent?.removeChild(_labels);
    _labels?.destroy({ children: true });
  } catch (_) { /* ignore */ }
  try { _card?.remove(); } catch (_) { /* ignore */ }
  _overlay = null;
  _labels = null;
  _card = null;
  _pinnedId = null;
  _cardInfo.clear();
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
    _cardInfo.clear();

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
          // Per-icon guard: an emoji/font issue degrades this end to ring-only rather
          // than throwing out of the whole group's draw.
          try {
            const glyph = MODE_GLYPH[e.portal?.mode] ?? MODE_GLYPH.stairs;
            const icon = new PIXI.Text(glyph, { fontFamily: "Signika, sans-serif", fontSize: Math.max(12, Math.round(ringR * 1.1)) });
            icon.anchor.set(0.5, 0.5);
            icon.x = c.x;
            icon.y = c.y;
            labels.addChild(icon);
          } catch (_) { /* ring stays; icon skipped */ }
        }
        onCenters.push({ e, c });
      }

      // Hover/select card content for each on-level end (its name, mode, and where
      // its partner ends go).
      for (const { e, c } of onCenters) {
        const id = e.region.id ?? e.region._id;
        if (!id) continue;
        const destParts = [];
        if (currentLevel) {
          const seenLids = new Set();   // dedup by level id, not by display string
          for (const p of entries) {
            if (p === e) continue;
            const plid = regionLevelId(p.region);
            if (!plid || seenLids.has(plid)) continue;
            seenLids.add(plid);
            if (plid === currentLevel) destParts.push("same floor");
            else if (elevById.has(plid)) destParts.push(`${elevById.get(plid) > viewedBottom ? ARROW_UP : ARROW_DOWN} ${nameById.get(plid)}`);
            // an orphaned/deleted partner level is skipped rather than shown as "↓ —"
          }
        }
        _cardInfo.set(id, {
          label: e.portal?.label || "Stairs",
          mode: e.portal?.mode || "stairs",
          dest: destParts.join(", "),
          center: c
        });
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
        // Distinct, resolvable partner levels (orphaned ones are dropped).
        const partnerLids = [...new Set(offLevel.map((e) => regionLevelId(e.region)).filter((lid) => lid && elevById.has(lid)))];
        // On a multi-end link with several on-level ends AND a tagged entrance, badge
        // only the entrance — so we don't imply every on-level end leads off-floor.
        const multiOnLevel = onCenters.length > 1;
        const hasEntrance = onCenters.some(({ e }) => e.portal?.role === "entrance");
        for (const { e, c } of onCenters) {
          if (multiOnLevel && hasEntrance && e.portal?.role !== "entrance") continue;
          let stack = 0;
          for (const plid of partnerLids) {
            const up = elevById.get(plid) > viewedBottom;
            const text = `${up ? ARROW_UP : ARROW_DOWN} ${nameById.get(plid)}`;
            labels.addChild(drawCanvasLabel(c, text, {
              fontSize: 13, bg: color, bgAlpha: 0.85, offsetY: -10 - stack * 22
            }));
            stack++;
          }
        }
      }
    }

    // Keep a pinned (selected) card current after the redraw; drop it if its region
    // is gone or moved off this level (e.g. mid-drag or after a delete).
    if (_pinnedId) {
      const info = _cardInfo.get(_pinnedId);
      if (info) showCard(info);
      else { hideCard(); _pinnedId = null; }
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
 * Fast redraw — at most one per animation frame. Used while a portal is being
 * dragged so its line/badge tracks live; falls back to a ~16ms timeout if
 * requestAnimationFrame isn't available.
 */
function scheduleDrawFast() {
  if (_raf != null) return;
  if (typeof requestAnimationFrame === "function") {
    _raf = requestAnimationFrame(() => { _raf = null; drawPortalOverlay(); });
  } else {
    _raf = setTimeout(() => { _raf = null; drawPortalOverlay(); }, 16);
  }
}

/** Convert a world point to page (client) coords for positioning the DOM card. */
function worldToClient(world) {
  try {
    const t = canvas?.stage?.worldTransform;
    if (t && typeof t.apply === "function") {
      const p = t.apply({ x: world.x, y: world.y });
      const rect = canvas?.app?.view?.getBoundingClientRect?.();
      return { x: p.x + (rect?.left ?? 0), y: p.y + (rect?.top ?? 0) };
    }
  } catch (_) { /* fall through */ }
  return null;
}

/** Lazily create the DOM info-card element. */
function ensureCard() {
  if (_card && _card.isConnected) return _card;
  _card = document.createElement("div");
  _card.className = "da-portal-card";
  _card.style.display = "none";
  document.body.appendChild(_card);
  return _card;
}

/** Show the hover/select card for a stored portal end. No-op if it can't be placed. */
function showCard(info) {
  if (!info) return;
  const pos = worldToClient(info.center);
  if (!pos) return;   // can't resolve screen coords -> skip (degrade to no card)
  const card = ensureCard();
  card.replaceChildren();
  const title = document.createElement("div");
  title.className = "da-portal-card-title";
  title.textContent = info.label;
  const sub = document.createElement("div");
  sub.className = "da-portal-card-sub";
  sub.textContent = info.dest ? `${info.mode} · ${info.dest}` : info.mode;
  card.append(title, sub);
  card.style.left = `${pos.x}px`;
  card.style.top = `${pos.y - 10}px`;
  card.style.display = "block";
}

/** Hide the info-card. */
function hideCard() {
  if (_card) _card.style.display = "none";
}

/**
 * Register the hooks that keep the overlay fresh. Called once at init. Redraws on
 * canvas ready, on a level change (our own `daLevelChanged` signal), and on
 * create/update/delete of a Region *on the current scene* (debounced).
 */
export function registerPortalOverlayHooks() {
  Hooks.on("canvasReady", () => drawPortalOverlay());
  Hooks.on("canvasTearDown", () => teardownPortalOverlay());
  // The schedulers below intentionally don't gate on isGM — they only ever call
  // drawPortalOverlay, which gates on GM at its single entry point.
  Hooks.on("daLevelChanged", () => { if (game.user?.isGM) scheduleDraw(); });
  for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(hook, (doc) => { if (doc?.parent?.id === canvas?.scene?.id) scheduleDraw(); });
  }

  // Drag-follow: a region placeable re-renders during a drag, firing refreshRegion.
  // Fast-redraw (RAF-coalesced) only for portal regions on this scene, so the line/
  // badge tracks live. If this hook never fires on the running build, the drop is
  // still covered by updateRegion above — the line just snaps into place on release.
  Hooks.on("refreshRegion", (region) => {
    try {
      const doc = region?.document ?? region;
      if (doc?.parent?.id !== canvas?.scene?.id) return;
      if (!getPortalFlag(doc)) return;
      if (!_refreshSeen) {
        _refreshSeen = true;
        console.debug("[DA Toolkit] refreshRegion is live — portal overlay will follow drags in real time.");
      }
      scheduleDrawFast();
    } catch (_) { /* ignore */ }
  });

  // Hover / select a portal region -> show an info-card (name · type · destination).
  // If these hooks aren't present on the build, no card shows (lines/badges still do).
  Hooks.on("hoverRegion", (region, hovered) => {
    try {
      if (!game.user?.isGM) return;
      const doc = region?.document ?? region;
      if (doc?.parent?.id !== canvas?.scene?.id) return;
      const id = doc.id ?? doc._id;
      if (hovered) {
        const info = _cardInfo.get(id);
        if (info) showCard(info);
      } else if (!_pinnedId) {
        hideCard();
      }
    } catch (_) { /* ignore */ }
  });
  Hooks.on("controlRegion", (region, controlled) => {
    try {
      if (!game.user?.isGM) return;
      const doc = region?.document ?? region;
      if (doc?.parent?.id !== canvas?.scene?.id) return;
      const id = doc.id ?? doc._id;
      if (controlled) {
        const info = _cardInfo.get(id);
        if (info) { _pinnedId = id; showCard(info); }
      } else if (_pinnedId === id) {
        _pinnedId = null;
        hideCard();
      }
    } catch (_) { /* ignore */ }
  });
}
