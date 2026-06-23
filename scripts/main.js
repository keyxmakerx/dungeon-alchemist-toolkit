import { DAImporterDialog } from "./importer-dialog.js";
import { DARegionAdderDialog } from "./region-adder-dialog.js";
import { startAddStairs, addStairsInteractive, startLinkRegions } from "./portal/portal-wizard.js";
import { DAStairsManager } from "./portal/portal-manager.js";
import { registerPortalOverlayHooks } from "./portal/portal-overlay.js";
import { registerPlayerPortalHooks } from "./portal/portal-player-overlay.js";
import { MODULE_ID, SETTING_IMPORTER_DEFAULTS } from "./constants.js";
import { requireGM } from "./util.js";

Hooks.once("init", () => {
  // Per-client memory of the importer dialog's last-used selections (door
  // texture/sound, scene colors, copy toggle). Hidden from the Settings UI.
  game.settings.register(MODULE_ID, SETTING_IMPORTER_DEFAULTS, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.modules.get(MODULE_ID).api = {
    Importer: () => { if (!requireGM()) return null; return new DAImporterDialog().render(true); },
    // New native-teleport stairs/portal flow. No args -> prompt for type/label first;
    // explicit opts (e.g. {mode:"trap"}) skip the prompt.
    AddStairs: (opts) => {
      if (!requireGM()) return null;
      return opts ? startAddStairs(canvas?.scene, opts) : addStairsInteractive(canvas?.scene);
    },
    // Link two already-selected Regions into a teleport pair.
    LinkStairs: (opts) => { if (!requireGM()) return null; return startLinkRegions(canvas?.scene, opts); },
    // Browse / find / edit / delete this scene's stairs/portals. GM-only — the list
    // would otherwise reveal hidden trap locations to players.
    StairsManager: () => { if (!requireGM()) return null; return new DAStairsManager().render(true); },
    // Legacy: the original single-region changeLevel tool (kept available, no button).
    AddRegion: () => { if (!requireGM()) return null; return new DARegionAdderDialog().render(true); }
  };

  // GM-only translucent link overlay for same-level portal pairs + portal markers.
  registerPortalOverlayHooks();
  // Player-facing sight-gated "Stairs" labels (hover + click to use).
  registerPlayerPortalHooks();
});

Hooks.once("ready", () => {
  window.DA = game.modules.get(MODULE_ID).api;
});

/**
 * Injects the DA Level Importer and Add Stairs/Region buttons into the Scenes
 * directory header. Fires on every render of SceneDirectory.
 *
 * @param {SceneDirectory} _app
 * @param {HTMLElement} html
 */
Hooks.on("renderSceneDirectory", (_app, html) => {
  if (html.querySelector(".da-importer-sidebar-btn")) return;

  const header = html.querySelector(".directory-header");
  if (!header) return;

  const api = game.modules.get(MODULE_ID).api;

  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "da-importer-sidebar-btn";
  importBtn.innerHTML = '<i class="fas fa-file-import"></i> DA Level Importer';
  importBtn.addEventListener("click", () => api.Importer());

  const stairsBtn = document.createElement("button");
  stairsBtn.type = "button";
  stairsBtn.className = "da-region-sidebar-btn";
  stairsBtn.innerHTML = '<i class="fas fa-stairs"></i> DA Add Stairs / Portal';
  stairsBtn.dataset.tooltip = "Place an entrance, switch level, place an exit — linked as a native teleport (stairs, elevator, or same-map teleport)";
  stairsBtn.addEventListener("click", () => api.AddStairs());

  const managerBtn = document.createElement("button");
  managerBtn.type = "button";
  managerBtn.className = "da-region-sidebar-btn";
  managerBtn.innerHTML = '<i class="fas fa-diagram-project"></i> DA Stairs Manager';
  managerBtn.dataset.tooltip = "List, find, edit, and delete the stairs/portals on this scene";
  managerBtn.addEventListener("click", () => api.StairsManager());

  // Insert after the native action buttons (Create Scene / Create Folder) so the
  // buttons sit between those and the search bar, regardless of v14's markup.
  const actionButtons = header.querySelector(".action-buttons") ?? header.querySelector(".header-actions");
  const anchor = actionButtons ? actionButtons.nextSibling : null;
  header.insertBefore(importBtn, anchor);
  header.insertBefore(stairsBtn, anchor);
  header.insertBefore(managerBtn, anchor);
});
