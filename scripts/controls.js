/**
 * Toolkit entry points: a native scene-controls group (the discoverable
 * enhancement) and a Module Settings menu (the reliable fallback). Both are
 * GM-only and fully guarded — if the scene-controls surface misbehaves on a given
 * v14 build, the settings menu and the module API still open the hub.
 *
 * Why both: custom scene-control groups have had open core bugs in early 14.x, and
 * there is no live runtime to verify against here, so a guaranteed-working
 * fallback is non-negotiable (STRATEGY: robustness over surface area).
 */

import { MODULE_ID } from "./constants.js";
import { DAToolkitHub } from "./hub.js";

/**
 * Register the settings-menu fallback and the guarded scene-controls group.
 * Call once during `init`.
 */
export function registerToolkitEntries() {
  // Reliable fallback: a GM-only Module Settings menu button that opens the hub.
  try {
    game.settings.registerMenu(MODULE_ID, "openHub", {
      name: "DAT.Hub.Title",
      label: "DAT.Hub.MenuLabel",
      hint: "DAT.Hub.MenuHint",
      icon: "fa-solid fa-dungeon",
      type: DAToolkitHub,
      restricted: true
    });
  } catch (err) {
    console.warn("[DA Toolkit] settings-menu registration failed (non-fatal):", err);
  }

  // Discoverable enhancement: a guarded "Dungeon Alchemist" group in the left
  // canvas toolbar. v14 hook arg is an object keyed by control name; each tool is
  // a momentary `button` with an `onChange(event, active)` that fires once on
  // activation (a tool with neither onChange nor onClick throws in core).
  Hooks.on("getSceneControlButtons", (controls) => {
    try {
      if (!game.user?.isGM) return;
      const api = game.modules.get(MODULE_ID).api;
      if (!api) return;
      controls["dungeon-alchemist"] = {
        name: "dungeon-alchemist",
        title: "DAT.Controls.Group",
        icon: "fa-solid fa-dungeon",
        order: Object.keys(controls).length,
        visible: game.user.isGM,
        // No persistent layer of our own; point activeTool at the first tool and
        // give the group a no-op onChange to satisfy core's tool resolution.
        activeTool: "da-import",
        onChange: () => {},
        tools: {
          "da-import": {
            name: "da-import", title: "DAT.Controls.Import",
            icon: "fa-solid fa-file-import", order: 0,
            button: true, visible: game.user.isGM,
            onChange: (event, active) => { if (active) api.Importer(); }
          },
          "da-add-stairs": {
            name: "da-add-stairs", title: "DAT.Controls.AddStairs",
            icon: "fa-solid fa-stairs", order: 1,
            button: true, visible: game.user.isGM,
            onChange: (event, active) => { if (active) api.AddStairs(); }
          },
          "da-stairs-manager": {
            name: "da-stairs-manager", title: "DAT.Controls.Manager",
            icon: "fa-solid fa-diagram-project", order: 2,
            button: true, visible: game.user.isGM,
            onChange: (event, active) => { if (active) api.StairsManager(); }
          }
        }
      };
    } catch (err) {
      console.warn("[DA Toolkit] scene-controls registration failed (non-fatal):", err);
    }
  });
}
