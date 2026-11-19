import { DAImporterDialog } from "./importer-dialog.js";
import { startAddStairs, startStairwell, startLinkRegions, addFloorToLink } from "./portal/portal-wizard.js";
import { DALevelManager } from "./dashboard.js";
import { registerToolkitEntries } from "./controls.js";
import { registerDropImport } from "./drop-import.js";
import { registerPortalOverlayHooks } from "./portal/portal-overlay.js";
import { registerPlayerPortalHooks } from "./portal/portal-player-overlay.js";
import { getPortalFlag, regionUuid, unlinkDeletedPortal } from "./portal/portal-core.js";
import { MODULE_ID, SETTING_IMPORTER_DEFAULTS, SETTING_RETIRED_NOTE } from "./constants.js";
import { requireGM, t } from "./util.js";

/**
 * Open the import window, or bring the open one forward. Given a folder, the
 * window goes straight to it.
 *
 * @param {{source?:string, path?:string, copied?:number}} [opts]
 */
function openImporter(opts) {
  if (!requireGM()) return null;
  const existing = foundry.applications?.instances?.get("da-importer");
  const app = existing ?? new DAImporterDialog();
  if (opts?.path !== undefined) app.startAt(opts);
  if (existing) existing.bringToFront?.();
  else app.render(true);
  return app;
}

/**
 * The Stairs Manager window and the old one-region tool are gone; their list is
 * the Level Manager's Stairs tab. A macro that still calls them lands there and
 * is told so once.
 */
function openRetired() {
  if (!requireGM()) return null;
  try {
    if (!game.settings.get(MODULE_ID, SETTING_RETIRED_NOTE)) {
      ui.notifications?.info?.(t("DAT.Entry.RetiredNote"), { permanent: true });
      game.settings.set(MODULE_ID, SETTING_RETIRED_NOTE, true);
    }
  } catch (_) { /* the window still opens */ }
  return DALevelManager.open({ tab: "stairs" });
}

Hooks.once("init", () => {
  // What the import window was last set to (door look and sound, scene colours,
  // copy switch), remembered per person and kept out of the Settings window.
  game.settings.register(MODULE_ID, SETTING_IMPORTER_DEFAULTS, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
  game.settings.register(MODULE_ID, SETTING_RETIRED_NOTE, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  const api = {
    // The Level Manager: the toolkit's home. `{sceneId}` manages a scene that
    // is not on the canvas; `{tab:"stairs"}` opens on the stairs list.
    open: (opts) => DALevelManager.open(opts),
    Importer: (opts) => openImporter(opts),
    // No arguments: drag once and tick the floors. With options (for example
    // {mode:"trap"}): place each end by hand.
    AddStairs: (opts) => {
      if (!requireGM()) return null;
      return opts ? startAddStairs(canvas?.scene, opts) : startStairwell(canvas?.scene);
    },
    // Join two Regions that are already selected.
    LinkStairs: (opts) => { if (!requireGM()) return null; return startLinkRegions(canvas?.scene, opts); },
    // Add another floor to an existing stair.
    AddFloorToLink: (linkId) => { if (!requireGM()) return null; return addFloorToLink(canvas?.scene, linkId); },
    // Kept so old macros keep working.
    StairsManager: () => openRetired(),
    AddRegion: () => openRetired()
  };
  game.modules.get(MODULE_ID).api = api;

  // A short global name for macros. Set in `init` so a macro never finds it missing.
  window.DA = api;

  registerToolkitEntries();
  registerDropImport();

  // The game master's marks and lines for stairs on the map.
  registerPortalOverlayHooks();
  // The players' labels for stairs their token can see and reach.
  registerPlayerPortalHooks();

  const manager = () => foundry.applications?.instances?.get("da-level-manager");

  // An open Level Manager follows the scene on the canvas.
  Hooks.on("canvasReady", () => {
    try { manager()?.render(false); } catch (_) { /* a stale window is not worth an error */ }
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

  // The Level Manager lists floors and stairs, so it follows changes made
  // anywhere else (the canvas, Foundry's own sheets, another GM).
  let refreshTimer = null;
  const refreshOpenWindows = (sceneId) => {
    if (!game.user?.isGM) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      try {
        const app = manager();
        if (!app?.rendered || app.scene?.id !== sceneId) return;
        // A redraw would throw away what is being typed; the next change catches up.
        const active = document.activeElement;
        if (active && app.element?.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
        app.render(false);
      } catch (_) { /* a stale list is not worth an error */ }
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
