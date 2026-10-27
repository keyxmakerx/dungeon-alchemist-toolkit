/**
 * Toolkit entry points — a GM-only Module Settings menu and a single safe toolbar
 * button, both opening the Level Manager dashboard.
 *
 * Add ONE tool to an existing native control group, never a custom group:
 * custom scene-controls groups break native floor selection. The tool sits
 * behind a client setting (default on); the Settings menu and `DA` API always
 * work.
 */

import { MODULE_ID } from "./constants.js";
import { DALevelManager } from "./dashboard.js";

/** Register the settings menu, the toolbar-button setting, and the toolbar tool. */
export function registerToolkitEntries() {
  // Client toggle so the toolbar button can be turned off.
  try {
    game.settings.register(MODULE_ID, "toolbarButton", {
      name: "DAT.Settings.ToolbarButton.Name",
      hint: "DAT.Settings.ToolbarButton.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => { try { ui.controls?.render?.(); } catch (_) { /* ignore */ } }
    });
  } catch (err) {
    console.warn("[DA Toolkit] settings registration failed (non-fatal):", err);
  }

  // Reliable entry: a GM-only Module Settings menu button that opens the dashboard.
  try {
    game.settings.registerMenu(MODULE_ID, "openHub", {
      name: "DAT.Hub.Title",
      label: "DAT.Hub.MenuLabel",
      hint: "DAT.Hub.MenuHint",
      icon: "fa-solid fa-dungeon",
      type: DALevelManager,
      restricted: true
    });
  } catch (err) {
    console.warn("[DA Toolkit] settings-menu registration failed (non-fatal):", err);
  }

  // Single tool on an existing native group; any failure no-ops.
  Hooks.on("getSceneControlButtons", (controls) => {
    try {
      if (!game.user?.isGM) return;
      if (!game.settings.get(MODULE_ID, "toolbarButton")) return;
      const group = controls?.tokens ?? controls?.regions ?? Object.values(controls ?? {})[0];
      if (!group || typeof group !== "object") return;
      group.tools ??= {};
      group.tools["da-level-manager"] = {
        name: "da-level-manager",
        title: "DAT.Dash.Title",
        icon: "fa-solid fa-dungeon",
        button: true,
        visible: game.user.isGM,
        order: Object.keys(group.tools).length,
        onChange: (event, active) => { if (active) DALevelManager.open(); }
      };
    } catch (err) {
      console.warn("[DA Toolkit] toolbar tool registration failed (non-fatal):", err);
    }
  });
}
