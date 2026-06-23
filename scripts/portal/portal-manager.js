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
  regionCenter,
  regionLevelId
} from "./portal-core.js";
import { addStairsInteractive } from "./portal-wizard.js";
import { getSceneLevels } from "../levels.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * "View this level" via the documented v14 nav surface: SceneNavigation#viewLevel,
 * else Scene#view({ level }). Wrapped by callers in try/catch; if neither exists
 * on the running build it silently no-ops (pan + control still work).
 */
async function viewLevel(levelId) {
  if (!levelId) return;
  if (typeof ui?.nav?.viewLevel === "function") return ui.nav.viewLevel(levelId);
  if (typeof canvas?.scene?.view === "function") return canvas.scene.view({ level: levelId });
}

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
    try { region.object?.control?.({ releaseOthers: true }); } catch (_) { /* non-fatal */ }
  }

  /** Open the entrance region's native config sheet. */
  static async #onEdit(_event, target) {
    const linkId = target.dataset.linkId;
    const scene = canvas?.scene;
    const portals = getScenePortals(scene).filter((e) => e.portal?.linkId === linkId);
    const entry = portals.find((e) => e.portal?.role === "entrance") ?? portals[0];
    if (!entry) return;
    entry.region.sheet?.render(true);
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
