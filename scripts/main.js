import { DAImporterDialog } from "./importer-dialog.js";
import { DARegionAdderDialog } from "./region-adder-dialog.js";
import { startAddStairs, addStairsInteractive, startLinkRegions, addFloorToLink } from "./portal/portal-wizard.js";
import { DAStairsManager } from "./portal/portal-manager.js";
import { DALevelManager } from "./dashboard.js";
import { registerToolkitEntries } from "./controls.js";
import { registerPortalOverlayHooks } from "./portal/portal-overlay.js";
import { registerPlayerPortalHooks } from "./portal/portal-player-overlay.js";
import { getPortalFlag, regionUuid, unlinkDeletedPortal } from "./portal/portal-core.js";
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
    // Open the Level Manager dashboard — the toolkit's home.
    open: () => DALevelManager.open(),
    Importer: () => { if (!requireGM()) return null; return openSingleton(DAImporterDialog, "da-importer"); },
    // New native-teleport stairs/portal flow. No args -> prompt for type/label first;
    // explicit opts (e.g. {mode:"trap"}) skip the prompt.
    AddStairs: (opts) => {
      if (!requireGM()) return null;
      return opts ? startAddStairs(canvas?.scene, opts) : addStairsInteractive(canvas?.scene);
    },
    // Link two already-selected Regions into a teleport pair.
    LinkStairs: (opts) => { if (!requireGM()) return null; return startLinkRegions(canvas?.scene, opts); },
    // Add another floor to an existing stair/portal link (guided placement).
    AddFloorToLink: (linkId) => { if (!requireGM()) return null; return addFloorToLink(canvas?.scene, linkId); },
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
  // Player-facing sight-gated "Stairs" labels (a hover hint; clicking does nothing).
  registerPlayerPortalHooks();

  // Keep an open dashboard in sync when the active scene/canvas changes.
  Hooks.on("canvasReady", () => {
    try { foundry.applications?.instances?.get("da-level-manager")?.render(false); } catch (_) { /* ignore */ }
  });

  // One GM tidies the other ends when a stair end is deleted, whichever tool
  // deleted it. The active GM only, so two GMs never write the same fix twice.
  Hooks.on("deleteRegion", (region) => {
    if (!game.users?.activeGM?.isSelf) return;
    let linkId, uuid;
    try { linkId = getPortalFlag(region)?.linkId; uuid = regionUuid(region); } catch (_) { return; }
    if (!linkId) return;
    unlinkDeletedPortal(region.parent, uuid, linkId)
      .catch((err) => console.warn("[DA Toolkit] could not unlink a deleted stair end (non-fatal):", err));
  });

  // The toolkit windows list floors and stairs, so they follow changes made
  // anywhere else (the canvas, Foundry's own sheets, another GM).
  let refreshTimer = null;
  const refreshOpenWindows = (sceneId) => {
    if (!game.user?.isGM || sceneId !== canvas?.scene?.id) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      for (const id of ["da-level-manager", "da-stairs-manager"]) {
        try {
          const app = foundry.applications?.instances?.get(id);
          if (!app?.rendered) continue;
          // A redraw would throw away what is being typed; the next change catches up.
          const active = document.activeElement;
          if (active && app.element?.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) continue;
          app.render(false);
        } catch (_) { /* a stale list is not worth an error */ }
      }
    }, 150);
  };
  for (const h of ["createRegion", "updateRegion", "deleteRegion", "createLevel", "updateLevel", "deleteLevel"]) {
    Hooks.on(h, (doc) => refreshOpenWindows(doc?.parent?.id));
  }
  for (const h of ["createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) {
    Hooks.on(h, (doc) => refreshOpenWindows(doc?.parent?.parent?.id));
  }
  Hooks.on("updateScene", (scene) => refreshOpenWindows(scene?.id));
});
