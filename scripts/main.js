import { DAImporterDialog } from "./importer-dialog.js";
import { DARegionAdderDialog } from "./region-adder-dialog.js";
import { startAddStairs, addStairsInteractive, startLinkRegions } from "./portal/portal-wizard.js";
import { DAStairsManager } from "./portal/portal-manager.js";
import { DAToolkitHub } from "./hub.js";
import { registerToolkitEntries } from "./controls.js";
import { registerPortalOverlayHooks } from "./portal/portal-overlay.js";
import { registerPlayerPortalHooks } from "./portal/portal-player-overlay.js";
import { MODULE_ID, SETTING_IMPORTER_DEFAULTS } from "./constants.js";
import { requireGM } from "./util.js";

/**
 * Open (or focus) a single-instance ApplicationV2 by id instead of stacking a new
 * window on every call. Falls back to a fresh instance if the running build
 * doesn't expose the application instances registry.
 *
 * @param {typeof foundry.applications.api.ApplicationV2} Cls
 * @param {string} id  The class's DEFAULT_OPTIONS.id.
 */
function openSingleton(Cls, id) {
  const existing = foundry.applications?.instances?.get(id);
  if (existing) { existing.bringToFront?.(); return existing; }
  return new Cls().render(true);
}

Hooks.once("init", () => {
  // Per-client memory of the importer dialog's last-used selections (door
  // texture/sound, scene colors, copy toggle). Hidden from the Settings UI.
  game.settings.register(MODULE_ID, SETTING_IMPORTER_DEFAULTS, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  const api = {
    // Open the unified hub — the reliable, always-works entry point.
    open: () => DAToolkitHub.open(),
    Importer: () => { if (!requireGM()) return null; return openSingleton(DAImporterDialog, "da-importer"); },
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
    StairsManager: () => { if (!requireGM()) return null; return openSingleton(DAStairsManager, "da-stairs-manager"); },
    // Legacy: the original single-region changeLevel tool (kept available, no button).
    AddRegion: () => { if (!requireGM()) return null; return openSingleton(DARegionAdderDialog, "da-region-adder"); }
  };
  game.modules.get(MODULE_ID).api = api;

  // Convenience global alias; the canonical surface is game.modules.get(id).api.
  // Assigned in `init` (not `ready`) so a macro referencing DA never sees undefined.
  window.DA = api;

  // Entry points: the guarded scene-controls group + the settings-menu fallback.
  registerToolkitEntries();

  // GM-only translucent link overlay for same-level portal pairs + portal markers.
  registerPortalOverlayHooks();
  // Player-facing sight-gated "Stairs" labels (hover + click to use).
  registerPlayerPortalHooks();
});
