/**
 * DA Level Manager — the toolkit's home dashboard (ApplicationV2).
 *
 * Left: the scene's floors (native Scene Levels), top-floor first; click a floor
 * to view it. Right: the selected floor's details + the stairs/portals that
 * connect it. Import and stairs editing fold in over later phases; this phase is
 * the read-only home + the entry point. Built entirely on native data
 * (`scene.levels`, portal-flagged Regions) — no parallel data model.
 *
 * Replaces the old hub (scripts/hub.js, retired later).
 */

import { MODULE_ID } from "./constants.js";
import { requireGM, t } from "./util.js";
import { getSceneLevels, getCurrentLevelId, viewLevel } from "./levels.js";
import { getPortalLinkGroups, regionLevelId } from "./portal/portal-core.js";
import { updateLevel, setStartLevel, moveLevel, openNativeLevels } from "./scene-levels-edit.js";
import { buildThumb } from "./floor-rows.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Friendly glyph per portal mode (matches MODE_PRESETS keys). */
const STAIR_ICONS = { stairs: "🪜", teleport: "🌀", trap: "🕳️" };

export class DALevelManager extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Currently-selected floor `_id` (null → default to the viewed/bottom floor). */
  _selectedId = null;

  static DEFAULT_OPTIONS = {
    id: "da-level-manager",
    tag: "div",
    classes: ["da-level-manager-app"],
    window: { title: "DAT.Dash.Title", icon: "fa-solid fa-dungeon", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      viewFloor: DALevelManager.#onViewFloor,
      saveFloor: DALevelManager.#onSaveFloor,
      setStart: DALevelManager.#onSetStart,
      moveUp: DALevelManager.#onMoveUp,
      moveDown: DALevelManager.#onMoveDown,
      openNative: DALevelManager.#onOpenNative,
      importFolder: DALevelManager.#onImport,
      addStairs: DALevelManager.#onAddStairs
    }
  };

  static PARTS = {
    body: { template: "modules/dungeon-alchemist-toolkit/templates/dashboard.hbs" }
  };

  /** Open (or focus) the dashboard. GM-gated; single-instance. */
  static open() {
    if (!requireGM()) return null;
    const existing = foundry.applications?.instances?.get("da-level-manager");
    if (existing) { existing.bringToFront?.(); return existing; }
    return new DALevelManager().render(true);
  }

  /** @override */
  async _prepareContext(_options) {
    const scene = canvas?.scene;
    if (!scene) return { hasScene: false };

    const levelsAsc = getSceneLevels(scene);            // bottom-first
    if (!levelsAsc.length) return { hasScene: false, sceneName: scene.name };

    const validIds = new Set(levelsAsc.map((l) => l._id));
    let selectedId = this._selectedId && validIds.has(this._selectedId)
      ? this._selectedId
      : getCurrentLevelId(scene);
    if (!validIds.has(selectedId)) selectedId = levelsAsc[0]._id;
    this._selectedId = selectedId;

    const startId = scene.initialLevel;
    const levelName = (id) => levelsAsc.find((l) => l._id === id)?.name ?? "—";

    // Floors list, top-floor first for a building-like reading order.
    const floors = levelsAsc.slice().reverse().map((l) => ({
      id: l._id,
      name: l.name || "Level",
      bottom: l.elevation?.bottom ?? 0,
      top: l.elevation?.top ?? 0,
      src: l.background?.src ?? "",
      start: l._id === startId,
      active: l._id === selectedId
    }));

    // Stairs/portals connecting the selected floor.
    const stairs = [];
    for (const [linkId, entries] of getPortalLinkGroups(scene)) {
      const onThis = entries.some((e) => regionLevelId(e.region) === selectedId);
      if (!onThis) continue;
      const portal = entries[0]?.portal ?? {};
      const mode = portal.mode || "stairs";
      const partners = entries
        .map((e) => regionLevelId(e.region))
        .filter((id) => id && id !== selectedId);
      const sub = partners.length
        ? `→ ${[...new Set(partners)].map(levelName).join(", ")}`
        : t("DAT.Dash.SameFloor");
      stairs.push({ linkId, label: portal.label || "Stairs", mode, icon: STAIR_ICONS[mode] ?? STAIR_ICONS.stairs, sub });
    }
    stairs.sort((a, b) => (a.label || "").localeCompare(b.label || ""));

    const sel = levelsAsc.find((l) => l._id === selectedId);
    const selIdx = levelsAsc.findIndex((l) => l._id === selectedId);   // bottom-first index
    return {
      hasScene: true,
      sceneName: scene.name,
      floorCount: levelsAsc.length,
      floors,
      selected: {
        name: sel?.name || "Level",
        bottom: sel?.elevation?.bottom ?? 0,
        top: sel?.elevation?.top ?? 0,
        start: selectedId === startId,
        canUp: selIdx < levelsAsc.length - 1,    // a floor sits above it
        canDown: selIdx > 0,                      // a floor sits below it
        stairs
      }
    };
  }

  /** Inject floor thumbnails (built in JS so video floors get a real <video>). */
  _onRender(_context, _options) {
    for (const el of this.element.querySelectorAll(".da-floor-thumb[data-src]")) {
      const src = el.dataset.src;
      el.replaceChildren();
      if (src) el.appendChild(buildThumb(src, "da-floor-thumb-media", { animate: false }));
    }
  }

  /** Pause any thumbnail videos so closing doesn't leave decoders running. */
  async _onClose(options) {
    try {
      for (const v of this.element?.querySelectorAll("video") ?? []) {
        v.pause(); v.removeAttribute("src"); v.load();
      }
    } catch (_) { /* ignore */ }
    return super._onClose(options);
  }

  static async #onViewFloor(_event, target) {
    const id = target?.dataset?.levelId;
    if (!id) return;
    this._selectedId = id;
    try { await viewLevel(id); } catch (_) { /* non-fatal */ }
    this.render();
  }

  /**
   * Flush the floor-editor inputs (name + elevation) for the selected floor to the
   * scene. Used by Save and as a pre-flush before the ★/move actions so an
   * in-progress edit is never lost. `updateLevel` skips empty/invalid fields and
   * no-ops when nothing changed, so calling this unconditionally is safe; all level
   * writes are serialized in scene-levels-edit.js, so the pre-flush always lands
   * before the action that follows it.
   * @returns {Promise<void>}
   */
  async _commitEdits() {
    const scene = canvas?.scene;
    const id = this._selectedId;
    if (!scene || !id || !this.element) return;
    const name = this.element.querySelector(".da-edit-name")?.value;
    const bottom = parseFloat(this.element.querySelector(".da-edit-bottom")?.value ?? "");
    const top = parseFloat(this.element.querySelector(".da-edit-top")?.value ?? "");
    // A reversed range is reported but not fatal — the name still commits and the
    // bad elevation is dropped by updateLevel; the next render restores the field.
    if (Number.isFinite(bottom) && Number.isFinite(top) && bottom >= top) {
      ui.notifications?.warn?.(t("DAT.Dash.BadElevation"));
    }
    await updateLevel(scene, id, { name, bottom, top });
  }

  static async #onSaveFloor() {
    await this._commitEdits();
    this.render();
  }

  static async #onSetStart() {
    const scene = canvas?.scene;
    if (!scene || !this._selectedId) return;
    await this._commitEdits();
    await setStartLevel(scene, this._selectedId);
    this.render();
  }

  static async #onMoveUp() {
    const scene = canvas?.scene;
    if (!scene || !this._selectedId) return;
    await this._commitEdits();
    await moveLevel(scene, this._selectedId, +1);
    this.render();
  }

  static async #onMoveDown() {
    const scene = canvas?.scene;
    if (!scene || !this._selectedId) return;
    await this._commitEdits();
    await moveLevel(scene, this._selectedId, -1);
    this.render();
  }

  static #onOpenNative() { openNativeLevels(canvas?.scene); }

  // Bridges to the existing flows until import (P3) and stairs (P5) fold in.
  static #onImport() { game.modules.get(MODULE_ID).api.Importer(); }
  static #onAddStairs() { game.modules.get(MODULE_ID).api.AddStairs(); }
}
