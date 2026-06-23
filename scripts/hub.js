/**
 * Dungeon Alchemist Toolkit hub — a small, reliable launcher window that gathers
 * the toolkit's actions (Import / Add Stairs / Stairs Manager) in one place.
 *
 * This is the "always works" entry point: plain ApplicationV2 (no canvas/control
 * dependencies), reachable from the module API, `DA.open()`, and a Module Settings
 * menu. The native scene-controls group (see controls.js) is a guarded
 * enhancement layered on top; if it misbehaves on a given v14 build, this hub
 * still gives the GM a clickable way in.
 */

import { MODULE_ID } from "./constants.js";
import { requireGM } from "./util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DAToolkitHub extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "da-toolkit-hub",
    tag: "div",
    classes: ["da-toolkit-hub-app"],
    window: { title: "DAT.Hub.Title", icon: "fa-solid fa-dungeon", resizable: false },
    position: { width: 380, height: "auto" },
    actions: {
      importer: DAToolkitHub.#onImporter,
      addStairs: DAToolkitHub.#onAddStairs,
      stairsManager: DAToolkitHub.#onStairsManager
    }
  };

  static PARTS = {
    body: { template: "modules/dungeon-alchemist-toolkit/templates/hub.hbs" }
  };

  /**
   * Open (or focus) the hub. GM-gated; de-dupes to a single instance so repeated
   * clicks bring the existing window forward instead of stacking copies.
   * @returns {DAToolkitHub|null}
   */
  static open() {
    if (!requireGM()) return null;
    const existing = foundry.applications?.instances?.get("da-toolkit-hub");
    if (existing) { existing.bringToFront?.(); return existing; }
    return new DAToolkitHub().render(true);
  }

  /** The module's public API (the canonical surface the hub delegates to). */
  #api() { return game.modules.get(MODULE_ID).api; }

  static #onImporter() { this.close(); this.#api().Importer(); }
  static #onAddStairs() { this.close(); this.#api().AddStairs(); }
  static #onStairsManager() { this.close(); this.#api().StairsManager(); }
}
