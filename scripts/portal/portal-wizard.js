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
import { requireGM, t } from "../util.js";
import { PlacementBanner } from "./portal-banner.js";

/** Guards against starting a second guided placement while one is in progress. */
let _placementActive = false;

/**
 * Snapshot the current camera (world-space view center + zoom), matching the
 * shape `canvas.pan({x,y,scale})` accepts, so an in-wizard level switch that
 * re-views the scene can be re-centered afterward (keeping the entrance ghost and
 * the exit placement aligned). Guarded — returns null if the canvas isn't ready.
 * @returns {{x:number,y:number,scale:number}|null}
 */
function _captureCamera() {
  try { return { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x }; }
  catch (_) { return null; }
}

/** Pan/zoom back to a snapshot from _captureCamera (no-op if null or unavailable). */
function _restoreCamera(cam) {
  if (!cam) return;
  try { canvas.pan(cam); } catch (_) { /* ignore */ }
}

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
      <input type="checkbox" name="twoWay" checked /> Two-way (destinations link back)
    </label>
    <p class="hint">Place the first floor, then keep adding floors and click <strong>Done</strong> — a spiral staircase can connect every floor, and stepping on it asks which floor to go to.</p>
  </div>`;
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: t("DAT.Stairs.NewTitle") },
      content,
      ok: {
        label: t("DAT.Stairs.BtnPlace"),
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
  if (!scene) { ui.notifications.warn(t("DAT.Stairs.NoScene")); return; }
  if (!getSceneLevels(scene).length) {
    ui.notifications.warn(t("DAT.Stairs.NoLevels"));
    return;
  }
  const opts = await promptStairsOptions();
  if (!opts) { ui.notifications.info(t("DAT.Stairs.Cancelled")); return; }
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
  if (!scene) { ui.notifications.warn(t("DAT.Stairs.NoScene")); return; }
  const levels = getSceneLevels(scene);
  if (!levels.length) {
    ui.notifications.warn(t("DAT.Stairs.NoLevels"));
    return;
  }
  if (_placementActive) {
    ui.notifications.warn(t("DAT.Stairs.InProgress"));
    return;
  }
  _placementActive = true;

  const banner = new PlacementBanner();
  try { banner.mount(); } catch (_) { /* toast fallback used below */ }

  let removeGhost = null;
  let flowCancelled = false;
  let goBack = false;
  let currentCtrl = null;
  // Suppress the teardown-cancel while WE switch the viewed level between steps
  // (that switch re-views the scene, which fires canvasTearDown). switchGen makes a
  // stale settle from an earlier switch a no-op; settleTimer is the lift fallback.
  let suppressCancel = false;
  let switchGen = 0;
  let settleTimer = null;

  banner.onCancel = () => { flowCancelled = true; currentCtrl?.abort(); };
  banner.onBack = () => { goBack = true; currentCtrl?.abort(); };

  // A genuine scene change/teardown mid-placement aborts the flow (and the active
  // pick) — but NOT a teardown caused by our own in-wizard level switch. Persistent
  // (Hooks.on) so it survives the repeated switches a multi-floor stair needs.
  const onTearDown = () => {
    if (suppressCancel) return;
    flowCancelled = true;
    currentCtrl?.abort();
  };
  Hooks.on("canvasTearDown", onTearDown);

  const cleanup = () => {
    Hooks.off("canvasTearDown", onTearDown);
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    try { removeGhost?.(); } catch (_) { /* ignore */ }
    removeGhost = null;
    banner.destroy();
    _placementActive = false;
  };

  // Switch the viewed level WITHOUT letting the resulting canvas re-view cancel the
  // flow (onTearDown is suppressed) or leave the entrance ghost off-center (the
  // camera is restored once the rebuilt canvas is ready). A generation token means
  // only the latest switch's settle acts, and the camera is never yanked back after
  // the flow has ended (_placementActive guard).
  const switchViewedLevel = async (levelId) => {
    const gen = ++switchGen;
    const cam = _captureCamera();
    suppressCancel = true;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    const settle = () => {
      if (gen !== switchGen) return;                 // superseded by a newer switch
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      suppressCancel = false;
      if (_placementActive) _restoreCamera(cam);     // don't re-pan after cleanup()
    };
    try { Hooks.once("canvasReady", settle); } catch (_) { /* ignore */ }
    try { await viewLevel(levelId); } catch (_) { /* non-fatal */ }
    settleTimer = setTimeout(settle, 1500);          // fallback if no teardown/ready cycle fires
  };

  // Place a footprint on each floor the stair connects. Start with 2 (entrance +
  // one destination); the GM keeps adding floors and clicks Done to finish, so a
  // spiral staircase can span the whole building. Each entry is {rect, levelId}.
  const captured = [];
  let doneClicked = false;
  banner.onDone = () => { doneClicked = true; currentCtrl?.abort(); };

  // Default the next floor to the first level not yet used (so floors don't stack
  // on top of each other by default); fall back to the current/first level.
  const nextUnusedLevel = () => {
    const used = new Set(captured.map((c) => c.levelId));
    return levels.find((l) => !used.has(l._id))?._id ?? getCurrentLevelId(scene) ?? levels[0]?._id ?? null;
  };

  try {
    while (true) {
      const isFirst = captured.length === 0;
      let levelId = isFirst ? (getCurrentLevelId(scene) ?? levels[0]?._id ?? null) : nextUnusedLevel();
      await switchViewedLevel(levelId);

      const canFinish = captured.length >= 2;
      const title = isFirst
        ? t("DAT.Stairs.StepEntrance", { mode, label })
        : t("DAT.Stairs.StepMore", { label, count: captured.length });
      const hint = t("DAT.Stairs.StepHint");
      banner.setStep(title, hint);
      banner.showLevelPicker(levels, levelId, isFirst ? "Entrance floor" : "Floor");
      banner.showBack(!isFirst);
      banner.showDone(canFinish);
      banner.onPickLevel = (id) => { levelId = id; switchViewedLevel(id).catch(() => {}); };

      // Ghost every floor placed so far while placing the next.
      try { removeGhost?.(); } catch (_) { /* ignore */ }
      const ghosts = captured.map((c) => (c.rect ? drawGhostRect(c.rect) : null)).filter(Boolean);
      removeGhost = () => ghosts.forEach((g) => { try { g(); } catch (_) { /* ignore */ } });

      if (!banner.el) ui.notifications.info(`${title} — ${hint}`);

      currentCtrl = new AbortController();
      goBack = false;
      doneClicked = false;
      let rect = null;
      try {
        rect = await pickCanvasRectangle({ signal: currentCtrl.signal });
      } catch (_) {
        rect = null;
      }

      if (flowCancelled) { ui.notifications.info(t("DAT.Stairs.Cancelled")); cleanup(); return; }
      if (doneClicked && captured.length >= 2) break;     // finish with the floors placed
      if (goBack) { captured.pop(); continue; }            // re-place the previous floor
      if (!rect) { ui.notifications.info(t("DAT.Stairs.Cancelled")); cleanup(); return; }

      captured.push({ rect, levelId });
    }
  } catch (err) {
    ui.notifications.error(t("DAT.Stairs.PlacementFailed", { error: err.message }));
    console.error(err);
    cleanup();
    return;
  }

  if (captured.length < 2) { ui.notifications.info(t("DAT.Stairs.Cancelled")); cleanup(); return; }

  try {
    const regions = await createLinkedStairs({
      scene, mode, label, twoWay,
      segments: captured.map((c) => ({ x: c.rect.x, y: c.rect.y, width: c.rect.width, height: c.rect.height, levelId: c.levelId }))
    });
    const count = regions?.length ?? 0;
    const allSameLevel = captured.every((c) => c.levelId === captured[0].levelId);
    ui.notifications.info(t(allSameLevel ? "DAT.Stairs.CreatedTeleport" : "DAT.Stairs.Created", { count }));
  } catch (err) {
    ui.notifications.error(t("DAT.Stairs.CreateFailed", { error: err.message }));
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
  if (!scene) { ui.notifications.warn(t("DAT.Stairs.NoScene")); return; }

  const controlled = canvas?.regions?.controlled ?? [];
  if (controlled.length === 2) {
    const [a, b] = controlled.map((r) => r.document ?? r);
    await _link(a, b, { mode, label, twoWay });
    return;
  }
  ui.notifications.warn(t("DAT.Stairs.LinkSelectTwo"));
}

async function _link(regionA, regionB, opts) {
  // Don't silently re-link regions that are already portals; warn instead.
  if (getPortalFlag(regionA) || getPortalFlag(regionB)) {
    ui.notifications.warn(t("DAT.Stairs.AlreadyPortal"));
    return;
  }
  try {
    await linkExistingRegions({ regionA, regionB, ...opts });
    ui.notifications.info(t("DAT.Stairs.Linked"));
  } catch (err) {
    ui.notifications.error(t("DAT.Stairs.LinkFailed", { error: err.message }));
    console.error(err);
  }
}
