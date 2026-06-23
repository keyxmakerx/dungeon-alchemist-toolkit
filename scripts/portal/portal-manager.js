/**
 * Stairs Manager — a per-scene panel listing every portal link, grouped, with
 * select-&-pan / edit / delete / add actions. Complements (does not duplicate)
 * the native Placeables tab: this view is stairs-only, cross-level, and
 * link-aware (it shows both ends of each link together).
 */

import {
  getPortalLinkGroups,
  getScenePortals,
  deletePortalLink,
  bindPortals,
  regionCenter,
  regionLevelId
} from "./portal-core.js";
import { addStairsInteractive } from "./portal-wizard.js";
import { getSceneLevels, viewLevel } from "../levels.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DAStairsManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "da-stairs-manager",
    tag: "div",
    classes: ["da-stairs-manager-app"],
    window: { title: "DA Stairs Manager", resizable: true },
    position: { width: 480, height: "auto" },
    actions: {
      goto: DAStairsManager.#onGoto,
      edit: DAStairsManager.#onEdit,
      remove: DAStairsManager.#onRemove,
      add: DAStairsManager.#onAdd,
      refresh: DAStairsManager.#onRefresh
    }
  };

  static PARTS = {
    form: { template: "modules/dungeon-alchemist-toolkit/templates/portal-manager.hbs" }
  };

  /** @override */
  async _prepareContext(_options) {
    const scene = canvas?.scene;
    if (!scene) return { hasScene: false };

    const levels = getSceneLevels(scene);
    const levelName = (id) => levels.find((l) => l._id === id)?.name ?? "—";

    const links = [];
    for (const [linkId, entries] of getPortalLinkGroups(scene)) {
      const first = entries[0]?.portal ?? {};
      links.push({
        linkId,
        label: first.label || "Stairs",
        mode: first.mode || "stairs",
        ends: entries.map((e) => ({
          regionId: e.region.id,
          role: e.portal?.role || "end",
          levelName: levelName(regionLevelId(e.region))
        }))
      });
    }
    // Stable order: by label then linkId.
    links.sort((a, b) => (a.label || "").localeCompare(b.label || "") || a.linkId.localeCompare(b.linkId));

    return { hasScene: true, sceneName: scene.name, links, hasLinks: links.length > 0 };
  }

  /** Select & pan to a region (and best-effort switch to its level). */
  static async #onGoto(_event, target) {
    const scene = canvas?.scene;
    const region = scene?.regions?.get(target.dataset.regionId);
    if (!region) { ui.notifications.warn("DA Stairs: that region no longer exists."); return; }
    try { await viewLevel(regionLevelId(region)); } catch (_) { /* non-fatal */ }
    const c = regionCenter(region);
    if (c && typeof canvas?.animatePan === "function") canvas.animatePan({ x: c.x, y: c.y, duration: 250 });
    // Activate the Regions layer first, or control() can no-op when another layer
    // is active.
    try { canvas?.regions?.activate?.(); } catch (_) { /* non-fatal */ }
    try { region.object?.control?.({ releaseOthers: true }); } catch (_) { /* non-fatal */ }
  }

  /**
   * Link-aware editor: rename the whole link, change its type/two-way, or fall
   * back to the native region sheet for shape/elevation. Writes through the shared
   * bindPortals path so both ends stay consistent.
   */
  static async #onEdit(_event, target) {
    const linkId = target.dataset.linkId;
    const scene = canvas?.scene;
    const entries = getScenePortals(scene).filter((e) => e.portal?.linkId === linkId);
    if (!entries.length) { ui.notifications.warn("DA Stairs: that link no longer exists."); return; }
    const entrance = entries.find((e) => e.portal?.role === "entrance") ?? entries[0];
    const others = entries.filter((e) => e !== entrance);
    const regions = [entrance.region, ...others.map((e) => e.region)];

    const cur = entrance.portal ?? {};
    const curMode = cur.mode || "stairs";
    const curLabel = cur.label || "Stairs";
    // Detect current two-way: every destination has a teleport behavior back.
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
      window: { title: "Edit Stairs / Portal" },
      content,
      buttons: [
        {
          action: "save", label: "Save", icon: "fas fa-check", default: true,
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
        { action: "sheet", label: "Open Region Sheet", icon: "fas fa-pen-to-square", callback: () => ({ action: "sheet" }) },
        { action: "cancel", label: "Cancel", icon: "fas fa-xmark", callback: () => ({ action: "cancel" }) }
      ],
      rejectClose: false
    }).catch(() => null);

    if (!choice || choice.action === "cancel") return;
    if (choice.action === "sheet") { entrance.region.sheet?.render(true); return; }
    try {
      await bindPortals({ regions, mode: choice.mode, label: choice.label, twoWay: choice.twoWay });
      ui.notifications.info("DA Stairs: updated.");
    } catch (err) {
      ui.notifications.error(`DA Stairs: update failed (${err.message})`);
      console.error(err);
    }
    this.render();
  }

  /** Delete both ends of a link (with confirm). */
  static async #onRemove(_event, target) {
    const linkId = target.dataset.linkId;
    const scene = canvas?.scene;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete stairs?" },
      content: "<p>Delete <strong>both ends</strong> of this stair / portal link?</p>",
      rejectClose: false,
      modal: true
    }).catch(() => false);
    if (!ok) return;
    try {
      await deletePortalLink(scene, linkId);
      ui.notifications.info("DA Stairs: deleted.");
    } catch (err) {
      ui.notifications.error(`DA Stairs: delete failed (${err.message})`);
      console.error(err);
    }
    this.render();
  }

  static async #onAdd() {
    await this.close();
    addStairsInteractive();
  }

  static #onRefresh() {
    this.render();
  }
}
