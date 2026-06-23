/**
 * Stair / Portal creation flows.
 *
 * `addStairsInteractive` asks for type/label/direction, then runs a **guided,
 * persistent placement**: a pinned banner walks the GM through placing the
 * entrance and the exit, with an in-flow floor picker (so the bound level is the
 * one the GM explicitly chose, not an inferred one) and a ghost of the entrance
 * while the exit is placed. The banner/ghost/picker are guarded enhancements — if
 * any is unavailable the core two-pick→link flow still completes (with toasts).
 *
 * `startLinkRegions` links two already-selected Regions directly. All flows are
 * GM-gated and built on the native `teleportToken` behavior (see portal-core.js).
 */

import { createLinkedStairs, linkExistingRegions, getPortalFlag } from "./portal-core.js";
import { getSceneLevels, getCurrentLevelId, viewLevel } from "../levels.js";
import { pickCanvasRectangle, drawGhostRect } from "../canvas-pick.js";
import { requireGM } from "../util.js";
import { PlacementBanner } from "./portal-banner.js";

/** Guards against starting a second guided placement while one is in progress. */
let _placementActive = false;

/**
 * Small DialogV2 to choose the portal type / label / directionality before
 * placing. Resolves to `{mode,label,twoWay}`, or null if cancelled.
 */
async function promptStairsOptions() {
  const content = `
  <div class="da-stairs-opts">
    <div class="form-group">
      <label>Type</label>
      <select name="mode">
        <option value="stairs" selected>Stairs — cross-level, confirm prompt</option>
        <option value="teleport">Teleport — same map, confirm prompt</option>
        <option value="trap">Trap — silent, hidden, one-way</option>
      </select>
    </div>
    <div class="form-group">
      <label>Label (shown to players)</label>
      <input type="text" name="label" value="Stairs" />
    </div>
    <label class="da-stairs-opts-check">
      <input type="checkbox" name="twoWay" checked /> Two-way (destination links back)
    </label>
  </div>`;
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: "New Stairs / Portal" },
      content,
      ok: {
        label: "Place →",
        icon: "fas fa-stairs",
        callback: (_event, button) => {
          const form = button?.form;
          return {
            mode: form?.elements?.mode?.value || "stairs",
            label: form?.elements?.label?.value?.trim() || "Stairs",
            twoWay: form?.elements?.twoWay?.checked ?? true
          };
        }
      },
      rejectClose: false
    });
  } catch (_) {
    return null;
  }
}

/**
 * Interactive create: ask for type/label/direction, then run the guided
 * placement. This is what the toolbar/hub and `DA.AddStairs()` (no args) call.
 *
 * @param {Scene} [scene=canvas.scene]
 * @returns {Promise<void>}
 */
export async function addStairsInteractive(scene = canvas?.scene) {
  if (!requireGM()) return;
  if (!scene) { ui.notifications.warn("DA Stairs: no active scene."); return; }
  if (!getSceneLevels(scene).length) {
    ui.notifications.warn("DA Stairs: this scene has no Levels — import or add levels first.");
    return;
  }
  const opts = await promptStairsOptions();
  if (!opts) { ui.notifications.info("DA Stairs: cancelled."); return; }
  await startAddStairs(scene, opts);
}

/**
 * Guided place-then-link: a persistent banner walks the GM through placing the
 * entrance, then the exit, each on a floor chosen from the banner's picker. The
 * two placements become a linked teleport pair (same floor on both = a same-map
 * teleport). The bound levels are the GM's explicit picker choices.
 *
 * @param {Scene} [scene=canvas.scene]
 * @param {object} [opts]
 * @param {"stairs"|"teleport"|"trap"} [opts.mode="stairs"]
 * @param {string} [opts.label="Stairs"]
 * @param {boolean} [opts.twoWay=true]
 * @returns {Promise<void>}
 */
export async function startAddStairs(scene = canvas?.scene, { mode = "stairs", label = "Stairs", twoWay = true } = {}) {
  if (!requireGM()) return;
  if (!scene) { ui.notifications.warn("DA Stairs: no active scene."); return; }
  const levels = getSceneLevels(scene);
  if (!levels.length) {
    ui.notifications.warn("DA Stairs: this scene has no Levels — import or add levels first.");
    return;
  }
  if (_placementActive) {
    ui.notifications.warn("DA Stairs: a placement is already in progress.");
    return;
  }
  _placementActive = true;

  const banner = new PlacementBanner();
  try { banner.mount(); } catch (_) { /* toast fallback used below */ }

  let removeGhost = null;
  let flowCancelled = false;
  let goBack = false;
  let currentCtrl = null;

  banner.onCancel = () => { flowCancelled = true; currentCtrl?.abort(); };
  banner.onBack = () => { goBack = true; currentCtrl?.abort(); };

  // A scene change/teardown mid-placement aborts the flow (and the active pick).
  const onTearDown = () => { flowCancelled = true; currentCtrl?.abort(); };
  Hooks.once("canvasTearDown", onTearDown);

  const cleanup = () => {
    Hooks.off("canvasTearDown", onTearDown);
    try { removeGhost?.(); } catch (_) { /* ignore */ }
    removeGhost = null;
    banner.destroy();
    _placementActive = false;
  };

  const otherLevel = (id) => levels.find((l) => l._id !== id)?._id ?? id;
  const captured = [
    { rect: null, levelId: getCurrentLevelId(scene) },                       // entrance
    { rect: null, levelId: null }                                            // exit
  ];

  try {
    let step = 0;
    while (step < 2) {
      const idx = step;
      const isEntrance = idx === 0;
      if (captured[idx].levelId == null) {
        captured[idx].levelId = isEntrance ? getCurrentLevelId(scene) : otherLevel(captured[0].levelId);
      }
      try { await viewLevel(captured[idx].levelId); } catch (_) { /* non-fatal */ }

      const title = isEntrance
        ? `New ${mode} "${label}" — Step 1 of 2: place the ENTRANCE`
        : `New ${mode} "${label}" — Step 2 of 2: place the EXIT`;
      const hint = "Pick the floor, then click (or drag) on the canvas to place. Esc or Cancel to stop.";
      banner.setStep(title, hint);
      banner.showLevelPicker(levels, captured[idx].levelId, isEntrance ? "Entrance floor" : "Exit floor");
      banner.showBack(!isEntrance);
      banner.onPickLevel = (id) => { captured[idx].levelId = id; viewLevel(id).catch(() => {}); };

      // Ghost the entrance while placing the exit; clear it on the entrance step.
      try { removeGhost?.(); } catch (_) { /* ignore */ }
      removeGhost = (!isEntrance && captured[0].rect) ? drawGhostRect(captured[0].rect) : null;

      if (!banner.el) ui.notifications.info(`DA Stairs: ${title}. ${hint}`);

      currentCtrl = new AbortController();
      goBack = false;
      let rect = null;
      try {
        rect = await pickCanvasRectangle({ signal: currentCtrl.signal });
      } catch (_) {
        rect = null;
      }

      if (flowCancelled) { ui.notifications.info("DA Stairs: cancelled."); cleanup(); return; }
      if (goBack) { step = Math.max(0, step - 1); continue; }
      if (!rect) { ui.notifications.info("DA Stairs: cancelled."); cleanup(); return; }

      captured[idx].rect = rect;
      step += 1;
    }
  } catch (err) {
    ui.notifications.error(`DA Stairs: placement failed (${err.message})`);
    console.error(err);
    cleanup();
    return;
  }

  try {
    const regions = await createLinkedStairs({
      scene, mode, label, twoWay,
      segments: [
        { x: captured[0].rect.x, y: captured[0].rect.y, width: captured[0].rect.width, height: captured[0].rect.height, levelId: captured[0].levelId },
        { x: captured[1].rect.x, y: captured[1].rect.y, width: captured[1].rect.width, height: captured[1].rect.height, levelId: captured[1].levelId }
      ]
    });
    const sameLevel = captured[0].levelId && captured[0].levelId === captured[1].levelId;
    ui.notifications.info(`DA Stairs: created ${regions?.length ?? 0} linked region(s)${sameLevel ? " (same level — teleport)" : ""}.`);
  } catch (err) {
    ui.notifications.error(`DA Stairs: failed to create (${err.message})`);
    console.error(err);
  } finally {
    cleanup();
  }
}

/**
 * Direct-connect: link the two currently-selected Regions into a teleport pair.
 *
 * @param {Scene} [scene=canvas.scene]
 * @param {object} [opts]
 * @param {"stairs"|"teleport"|"trap"} [opts.mode="stairs"]
 * @param {string} [opts.label="Stairs"]
 * @param {boolean} [opts.twoWay=true]
 * @returns {Promise<void>}
 */
export async function startLinkRegions(scene = canvas?.scene, { mode = "stairs", label = "Stairs", twoWay = true } = {}) {
  if (!requireGM()) return;
  if (!scene) { ui.notifications.warn("DA Stairs: no active scene."); return; }

  const controlled = canvas?.regions?.controlled ?? [];
  if (controlled.length === 2) {
    const [a, b] = controlled.map((r) => r.document ?? r);
    await _link(a, b, { mode, label, twoWay });
    return;
  }
  ui.notifications.warn(
    "DA Stairs (link): select exactly two Regions on the Regions layer first " +
    "(click one, Shift-click the other), then run this again."
  );
}

async function _link(regionA, regionB, opts) {
  // Don't silently re-link regions that are already portals; warn instead.
  if (getPortalFlag(regionA) || getPortalFlag(regionB)) {
    ui.notifications.warn("DA Stairs: one of those regions is already a portal — unlink it first (use the Stairs Manager).");
    return;
  }
  try {
    await linkExistingRegions({ regionA, regionB, ...opts });
    ui.notifications.info("DA Stairs: linked the two selected regions.");
  } catch (err) {
    ui.notifications.error(`DA Stairs: link failed (${err.message})`);
    console.error(err);
  }
}
