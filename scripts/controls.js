/**
 * Toolkit entry points — a GM-only Module Settings menu and a single safe toolbar
 * button, both opening the Level Manager dashboard.
 *
 * IMPORTANT: we add ONE tool to an existing native control group, never a custom
 * GROUP. A custom scene-controls group caused a regression that broke native
 * floor selection (fixed in 0.3.1), and v14 custom groups have open core bugs.
 * The toolbar tool is behind a client setting (default on) so it can be turned
 * off without uninstalling; the Settings menu + the `DA` API always work.
 */

import { MODULE_ID } from "./constants.js";
import { DALevelManager } from "./dashboard.js";

/** Register the settings menu, the toolbar-button setting, and the toolbar tool. */
export function registerToolkitEntries() {
  // Client toggle for the toolbar button — a recovery path if it ever misbehaves.
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

  // Discoverable entry: a SINGLE tool added to an existing native control group
  // (never a custom group). Fully guarded — if anything is off it no-ops and the
  // Settings menu / API still open the dashboard.
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
