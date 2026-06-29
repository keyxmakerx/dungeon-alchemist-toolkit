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
import { getPortalLinkGroups, getScenePortals, deletePortalLink, bindPortals, regionCenter, regionLevelId } from "./portal/portal-core.js";
import { updateLevel, setStartLevel, moveLevel, openNativeLevels, replaceLevelImage, addLevel, removeLevel } from "./scene-levels-edit.js";
import { buildThumb } from "./floor-rows.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Friendly glyph per portal mode (matches MODE_PRESETS keys). */
const STAIR_ICONS = { stairs: "🪜", teleport: "🌀", trap: "🕳️" };

export class DALevelManager extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Currently-selected floor `_id` (null → default to the viewed/bottom floor). */
  _selectedId = null;
  /** Active tab: "floors" | "import" | "stairs". */
  _tab = "floors";

  static DEFAULT_OPTIONS = {
    id: "da-level-manager",
    tag: "div",
    classes: ["da-level-manager-app"],
    window: { title: "DAT.Dash.Title", icon: "fa-solid fa-dungeon", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      switchTab: DALevelManager.#onSwitchTab,
      viewFloor: DALevelManager.#onViewFloor,
      saveFloor: DALevelManager.#onSaveFloor,
      setStart: DALevelManager.#onSetStart,
      moveUp: DALevelManager.#onMoveUp,
      moveDown: DALevelManager.#onMoveDown,
      replaceImage: DALevelManager.#onReplaceImage,
      addFloor: DALevelManager.#onAddFloor,
      removeFloor: DALevelManager.#onRemoveFloor,
      openNative: DALevelManager.#onOpenNative,
      importFolder: DALevelManager.#onImport,
      addStairs: DALevelManager.#onAddStairs,
      gotoStair: DALevelManager.#onGotoStair,
      editStair: DALevelManager.#onEditStair,
      removeStair: DALevelManager.#onRemoveStair
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

    // Every link across the scene, for the Stairs tab (link-aware, cross-floor).
    const links = [];
    for (const [linkId, entries] of getPortalLinkGroups(scene)) {
      const first = entries[0]?.portal ?? {};
      const mode = first.mode || "stairs";
      const ends = entries.map((e) => ({ regionId: e.region.id, levelName: levelName(regionLevelId(e.region)) }));
      links.push({
        linkId,
        label: first.label || "Stairs",
        mode,
        icon: STAIR_ICONS[mode] ?? STAIR_ICONS.stairs,
        ends: ends.map((x) => x.levelName).join(" ⟷ "),
        gotoEnds: ends.map((x) => ({ regionId: x.regionId, tip: t("DAT.Dash.GotoEnd", { floor: x.levelName }) }))
      });
    }
    links.sort((a, b) => (a.label || "").localeCompare(b.label || "") || a.linkId.localeCompare(b.linkId));

    const sel = levelsAsc.find((l) => l._id === selectedId);
    const selIdx = levelsAsc.findIndex((l) => l._id === selectedId);   // bottom-first index
    const tab = this._tab || "floors";
    return {
      hasScene: true,
      sceneName: scene.name,
      floorCount: levelsAsc.length,
      tab,
      isFloors: tab === "floors",
      isImport: tab === "import",
      isStairs: tab === "stairs",
      floors,
      links,
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

  /** Swap the selected floor's map image via a media picker (keeps stairs/tokens/lights). */
  static #onReplaceImage() {
    const scene = canvas?.scene;
    const id = this._selectedId;
    if (!scene || !id) return;
    const FilePicker = foundry.applications.apps?.FilePicker?.implementation;
    if (!FilePicker) { ui.notifications?.warn?.(t("DAT.Dash.NoPicker")); return; }
    const current = getSceneLevels(scene).find((l) => l._id === id)?.background?.src ?? "";
    const picker = new FilePicker({
      type: "imagevideo",
      current,
      callback: async (path) => {
        if (path) { await replaceLevelImage(scene, id, path); this.render(); }
      }
    });
    picker.browse(current).catch(() => { /* cancelled — ignore */ });
  }

  /** Add a new floor from a picked media file; select it once created. */
  static #onAddFloor() {
    const scene = canvas?.scene;
    if (!scene) return;
    const FilePicker = foundry.applications.apps?.FilePicker?.implementation;
    if (!FilePicker) { ui.notifications?.warn?.(t("DAT.Dash.NoPicker")); return; }
    const picker = new FilePicker({
      type: "imagevideo",
      current: "",
      callback: async (path) => {
        const name = path ? decodeURIComponent(path.split("/").pop().replace(/\.[^.]+$/, "")) : undefined;
        const newId = await addLevel(scene, { src: path, name });
        if (newId) this._selectedId = newId;
        this.render();
      }
    });
    picker.browse("").catch(() => { /* cancelled — ignore */ });
  }

  /** Remove the selected floor after a confirm that spells out the non-cascade caveat. */
  static async #onRemoveFloor() {
    const scene = canvas?.scene;
    const id = this._selectedId;
    if (!scene || !id) return;
    const name = getSceneLevels(scene).find((l) => l._id === id)?.name || "this floor";
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const DialogV2 = foundry.applications.api?.DialogV2;
    let ok = true;
    if (typeof DialogV2?.confirm === "function") {
      ok = await DialogV2.confirm({
        window: { title: t("DAT.Dash.RemoveTitle") },
        content: `<p>${t("DAT.Dash.RemoveConfirm", { name: esc(name) })}</p>`,
        modal: true,
        rejectClose: false
      });
    }
    if (!ok) return;
    await removeLevel(scene, id);
    this._selectedId = null;   // force re-resolve to a surviving floor on next render
    this.render();
  }

  static #onSwitchTab(_event, target) {
    const tab = target?.dataset?.tab;
    if (!tab || tab === this._tab) return;
    this._tab = tab;
    this.render();
  }

  /** Select & pan to a portal end (and best-effort switch to its level). */
  static async #onGotoStair(_event, target) {
    const scene = canvas?.scene;
    const region = scene?.regions?.get(target?.dataset?.regionId);
    if (!region) { ui.notifications?.warn?.(t("DAT.Stairs.GoneRegion")); return; }
    try { await viewLevel(regionLevelId(region)); } catch (_) { /* non-fatal */ }
    const c = regionCenter(region);
    if (c && typeof canvas?.animatePan === "function") canvas.animatePan({ x: c.x, y: c.y, duration: 250 });
    try { canvas?.regions?.activate?.(); } catch (_) { /* non-fatal */ }
    try { region.object?.control?.({ releaseOthers: true }); } catch (_) { /* non-fatal */ }
  }

  /**
   * Link-aware editor: rename the whole link, change its type/two-way, or fall back
   * to the native region sheet for shape/elevation — writing through the shared
   * bindPortals path so both ends stay consistent. (Lifted from the standalone
   * Stairs Manager, now folded into this tab.)
   */
  static async #onEditStair(_event, target) {
    const linkId = target?.dataset?.linkId;
    const scene = canvas?.scene;
    const entries = getScenePortals(scene).filter((e) => e.portal?.linkId === linkId);
    if (!entries.length) { ui.notifications?.warn?.(t("DAT.Stairs.GoneLink")); return; }
    const entrance = entries.find((e) => e.portal?.role === "entrance") ?? entries[0];
    const others = entries.filter((e) => e !== entrance);
    const regions = [entrance.region, ...others.map((e) => e.region)];

    const cur = entrance.portal ?? {};
    const curMode = cur.mode || "stairs";
    const curLabel = cur.label || "Stairs";
    const curTwoWay = others.length
      ? others.every((e) => (e.region.behaviors?.contents ?? Array.from(e.region.behaviors ?? [])).some((b) => b.type === "teleportToken"))
      : (curMode !== "trap");

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const modeOpts = ["stairs", "teleport", "trap"]
      .map((m) => `<option value="${m}"${m === curMode ? " selected" : ""}>${m}</option>`).join("");
    const content = `
      <div class="da-stairs-opts">
        <div class="form-group"><label>Label</label>
          <input type="text" name="label" value="${esc(curLabel)}" /></div>
        <div class="form-group"><label>Type</label>
          <select name="mode">${modeOpts}</select></div>
        <label class="da-stairs-opts-check">
          <input type="checkbox" name="twoWay"${curTwoWay ? " checked" : ""} /> Two-way (destination links back)</label>
      </div>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: t("DAT.Stairs.EditTitle") },
      content,
      buttons: [
        {
          action: "save", label: t("DAT.Stairs.BtnSave"), icon: "fas fa-check", default: true,
          callback: (_e, btn) => {
            const f = btn?.form;
            return {
              action: "save",
              label: f?.elements?.label?.value?.trim() || "Stairs",
              mode: f?.elements?.mode?.value || "stairs",
              twoWay: f?.elements?.twoWay?.checked ?? true
            };
          }
        },
        { action: "sheet", label: t("DAT.Stairs.BtnSheet"), icon: "fas fa-pen-to-square", callback: () => ({ action: "sheet" }) },
        { action: "cancel", label: t("DAT.Stairs.BtnCancel"), icon: "fas fa-xmark", callback: () => ({ action: "cancel" }) }
      ],
      rejectClose: false
    }).catch(() => null);

    if (!choice || choice.action === "cancel") return;
    if (choice.action === "sheet") { entrance.region.sheet?.render(true); return; }
    try {
      await bindPortals({ regions, mode: choice.mode, label: choice.label, twoWay: choice.twoWay });
      ui.notifications?.info?.(t("DAT.Stairs.Updated"));
    } catch (err) {
      ui.notifications?.error?.(t("DAT.Stairs.UpdateFailed", { error: err.message }));
      console.error(err);
    }
    this.render();
  }

  /** Delete both ends of a link (with confirm). */
  static async #onRemoveStair(_event, target) {
    const linkId = target?.dataset?.linkId;
    const scene = canvas?.scene;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("DAT.Stairs.DeleteTitle") },
      content: "<p>Delete <strong>both ends</strong> of this stair / portal link?</p>",
      rejectClose: false,
      modal: true
    }).catch(() => false);
    if (!ok) return;
    try {
      await deletePortalLink(scene, linkId);
      ui.notifications?.info?.(t("DAT.Stairs.Deleted"));
    } catch (err) {
      ui.notifications?.error?.(t("DAT.Stairs.DeleteFailed", { error: err.message }));
      console.error(err);
    }
    this.render();
  }

  // Import still opens the dedicated importer window (folded into this tab next);
  // Add Stairs runs the on-canvas guided placement.
  static #onImport() { game.modules.get(MODULE_ID).api.Importer(); }
  static #onAddStairs() { game.modules.get(MODULE_ID).api.AddStairs(); }
}
