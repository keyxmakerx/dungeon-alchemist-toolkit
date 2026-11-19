/**
 * Making stairs.
 *
 * `startStairwell` is the usual way: drag the stair once, tick the floors it
 * serves, and it is placed at the same spot on each and joined. Dungeon
 * Alchemist builds every floor on one footprint, so a staircase nearly always
 * lines up.
 *
 * `startAddStairs` is the guided way, for a stair whose ends are in different
 * places, a teleport on one floor, or a trap: a banner walks the GM through
 * placing each end on a floor picked in the banner, with the ends already
 * placed left as ghosts. The banner, ghosts and picker are extras; without
 * them the flow still completes with toasts.
 *
 * `startLinkRegions` joins two Regions that are already selected. Every flow
 * is GM-gated and built on the native `teleportToken` behavior (portal-core.js).
 */

import { createLinkedStairs, linkExistingRegions, getPortalFlag, getScenePortals, addPortalsToLink } from "./portal-core.js";
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

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Ask what kind of stair this is, what it is called and whether it leads back.
 * Resolves to `{mode,label,twoWay}`, or null if cancelled.
 *
 * @param {string} [label]  Name to start with.
 */
async function promptStairsOptions(label = t("DAT.Stairs.DefaultName")) {
  const kinds = ["stairs", "teleport", "trap"]
    .map((m, i) => `<option value="${m}"${i === 0 ? " selected" : ""}>${esc(t(`DAT.Stairs.KindLong.${m}`))}</option>`).join("");
  const content = `
  <div class="da-stairs-opts">
    <div class="form-group">
      <label>${esc(t("DAT.Stairs.FieldKind"))}</label>
      <select name="mode">${kinds}</select>
    </div>
    <div class="form-group">
      <label>${esc(t("DAT.Stairs.FieldName"))}</label>
      <input type="text" name="label" value="${esc(label)}" />
    </div>
    <label class="da-stairs-opts-check">
      <input type="checkbox" name="twoWay" checked /> ${esc(t("DAT.Stairs.FieldTwoWay"))}
    </label>
    <p class="hint">${esc(t("DAT.Stairs.NewHint"))}</p>
  </div>`;
  try {
    return await foundry.applications.api.DialogV2.prompt({
      window: { title: t("DAT.Stairs.NewTitle") },
      content,
      ok: {
        label: t("DAT.Stairs.BtnPlace"),
        callback: (_event, button) => {
          const form = button?.form;
          return {
            mode: form?.elements?.mode?.value || "stairs",
            label: form?.elements?.label?.value?.trim() || t("DAT.Stairs.DefaultName"),
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
 * Ask for the kind and name, then place each end by hand. This is where the
 * stairwell box sends a stair whose ends are in different places.
 *
 * @param {Scene} [scene=canvas.scene]
 * @param {object} [seed]
 * @param {{rect:object, levelId:string}} [seed.entrance]  An end already drawn.
 * @param {string} [seed.label]                             Name already typed.
 * @returns {Promise<void>}
 */
export async function addStairsInteractive(scene = canvas?.scene, { entrance = null, label } = {}) {
  if (!requireGM()) return;
  if (!scene) { ui.notifications.warn(t("DAT.Stairs.NoScene")); return; }
  if (!getSceneLevels(scene).length) {
    ui.notifications.warn(t("DAT.Stairs.NoLevels"));
    return;
  }
  const opts = await promptStairsOptions(label);
  if (!opts) { ui.notifications.info(t("DAT.Stairs.Cancelled")); return; }
  await startAddStairs(scene, { ...opts, entrance });
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
 * @param {string} [opts.existingLinkId]  Add floors to this stair instead of making one.
 * @param {{rect:object, levelId:string}} [opts.entrance]  The first end, if already drawn.
 * @returns {Promise<void>}
 */
export async function startAddStairs(scene = canvas?.scene, { mode = "stairs", label = t("DAT.Stairs.DefaultName"), twoWay = true, existingLinkId = null, entrance = null } = {}) {
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

  // Adding to an existing link: inherit its mode/label and pre-load its footprints
  // as faint alignment guides so a new floor lines up with the stack. One new floor
  // is enough to add (minFloors = 1), vs. 2 for a brand-new stair.
  let existingRegions = [];
  let existingRects = [];
  if (existingLinkId) {
    existingRegions = getScenePortals(scene).filter((e) => e.portal?.linkId === existingLinkId).map((e) => e.region);
    if (!existingRegions.length) { ui.notifications.warn(t("DAT.Stairs.GoneLink")); return; }
    const f = getPortalFlag(existingRegions[0]) ?? {};
    mode = f.mode || mode;
    label = f.label || label;
    existingRects = existingRegions
      .map((r) => { const s = r.shapes?.[0]; return (s && Number.isFinite(s.x) && Number.isFinite(s.width)) ? { x: s.x, y: s.y, width: s.width, height: s.height } : null; })
      .filter(Boolean);
  }
  const minFloors = existingLinkId ? 1 : 2;

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
  const captured = entrance?.rect && entrance.levelId ? [{ rect: entrance.rect, levelId: entrance.levelId }] : [];
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

      const canFinish = captured.length >= minFloors;
      const title = existingLinkId
        ? t("DAT.Stairs.StepAddFloor", { label, count: captured.length })
        : (isFirst
          ? t("DAT.Stairs.StepEntrance", { label })
          : t("DAT.Stairs.StepMore", { label, step: captured.length + 1, count: captured.length }));
      const hint = t("DAT.Stairs.StepHint");
      banner.setStep(title, hint);
      banner.showLevelPicker(levels, levelId, t(existingLinkId ? "DAT.Stairs.PickAdd" : (isFirst ? "DAT.Stairs.PickEntrance" : "DAT.Stairs.PickFloor")));
      banner.showBack(!isFirst);
      banner.showDone(canFinish);
      banner.onPickLevel = (id) => { levelId = id; switchViewedLevel(id).catch(() => {}); };

      // Ghost every floor placed so far — plus, when adding to an existing link, its
      // current footprints — as faint alignment guides while placing the next.
      try { removeGhost?.(); } catch (_) { /* ignore */ }
      const ghostRects = [...existingRects, ...captured.map((c) => c.rect)].filter(Boolean);
      const ghosts = ghostRects.map((r) => drawGhostRect(r)).filter(Boolean);
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
      if (doneClicked && captured.length >= minFloors) break;   // finish with the floors placed
      if (goBack) { captured.pop(); continue; }                  // re-place the previous floor
      if (!rect) { ui.notifications.info(t("DAT.Stairs.Cancelled")); cleanup(); return; }

      captured.push({ rect, levelId });
    }
  } catch (err) {
    ui.notifications.error(t("DAT.Stairs.PlacementFailed", { error: err.message }));
    console.error(err);
    cleanup();
    return;
  }

  if (captured.length < minFloors) { ui.notifications.info(t("DAT.Stairs.Cancelled")); cleanup(); return; }

  try {
    const segments = captured.map((c) => ({ x: c.rect.x, y: c.rect.y, width: c.rect.width, height: c.rect.height, levelId: c.levelId }));
    if (existingLinkId) {
      // Add the new floor(s) to the existing link and re-mesh (existing + new).
      const added = await addPortalsToLink(scene, existingLinkId, segments, { twoWay });
      ui.notifications.info(t("DAT.Stairs.FloorsAdded", { count: added?.length ?? 0 }));
    } else {
      const regions = await createLinkedStairs({ scene, mode, label, twoWay, segments });
      const count = regions?.length ?? 0;
      const allSameLevel = captured.every((c) => c.levelId === captured[0].levelId);
      ui.notifications.info(t(allSameLevel ? "DAT.Stairs.CreatedTeleport" : "DAT.Stairs.Created", { count }));
    }
  } catch (err) {
    ui.notifications.error(t("DAT.Stairs.CreateFailed", { error: err.message }));
    console.error(err);
  } finally {
    cleanup();
  }
}

/** Where a point on the map is on the screen, or null if that can't be told. */
function screenPoint(x, y) {
  try {
    const p = canvas.clientCoordinatesFromCanvas({ x, y });
    if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return p;
  } catch (_) { /* fall through */ }
  return null;
}

/**
 * The stairwell box: a name and a tick per floor. The floor the stair was
 * drawn on is always in; its neighbours start ticked.
 *
 * @param {object[]} levels   Floors, bottom-first.
 * @param {string} levelId    Floor the stair was drawn on.
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @returns {Promise<{action:"place"|"other", label:string, floors:string[]}|null>}
 */
async function promptStairwell(levels, levelId, rect) {
  const here = Math.max(0, levels.findIndex((l) => l._id === levelId));
  const rows = levels.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => {
    const on = Math.abs(i - here) <= 1;
    const fixed = i === here;
    const name = esc(l.name || t("DAT.Dash.UnnamedFloor"));
    const note = fixed ? ` <span class="da-muted">${esc(t("DAT.Stairs.WellHere"))}</span>` : "";
    return `<label><input type="checkbox" name="floor" value="${esc(l._id)}"${on ? " checked" : ""}${fixed ? " disabled" : ""} /> ${name}${note}</label>`;
  }).join("");
  const content = `
  <div class="da-stairwell">
    <div class="form-group">
      <label for="da-well-name">${esc(t("DAT.Stairs.FieldName"))}</label>
      <input type="text" id="da-well-name" name="label" value="${esc(t("DAT.Stairs.DefaultName"))}" />
    </div>
    <fieldset>
      <legend>${esc(t("DAT.Stairs.WellFloors"))}</legend>
      ${rows}
    </fieldset>
    <p class="hint">${esc(t("DAT.Stairs.WellHint"))}</p>
  </div>`;

  const read = (form) => ({
    label: form?.elements?.label?.value?.trim() || t("DAT.Stairs.DefaultName"),
    floors: Array.from(form?.querySelectorAll?.('input[name="floor"]:checked') ?? []).map((el) => el.value)
  });

  // Beside the stair when that can be worked out; Foundry's own spot otherwise.
  const width = 440;
  const position = { width };
  const right = screenPoint(rect.x + rect.width, rect.y);
  const left = screenPoint(rect.x, rect.y);
  if (right && left) {
    const fitsRight = right.x + 16 + width <= window.innerWidth - 8;
    position.left = Math.max(8, fitsRight ? right.x + 16 : left.x - width - 16);
    position.top = Math.max(8, Math.min(right.y - 40, window.innerHeight - 420));
  }

  try {
    return await foundry.applications.api.DialogV2.wait({
      window: { title: t("DAT.Stairs.WellTitle") },
      classes: ["da-stairwell-dialog"],
      position,
      content,
      buttons: [
        { action: "place", label: t("DAT.Stairs.WellPlace", { count: 0 }), default: true, callback: (_e, btn) => ({ action: "place", ...read(btn?.form) }) },
        { action: "other", label: t("DAT.Stairs.WellOther"), callback: (_e, btn) => ({ action: "other", ...read(btn?.form) }) },
        { action: "cancel", label: t("DAT.Stairs.BtnCancel"), callback: () => null }
      ],
      // The Place button says how many floors, and needs at least two.
      render: (_event, dialog) => {
        const root = dialog?.element ?? dialog;
        if (!(root instanceof HTMLElement)) return;
        const place = root.querySelector('button[data-action="place"]');
        const sync = () => {
          const count = root.querySelectorAll('input[name="floor"]:checked').length;
          if (!place) return;
          (place.querySelector("span") ?? place).textContent = t("DAT.Stairs.WellPlace", { count });
          place.disabled = count < 2;
        };
        root.addEventListener("change", sync);
        sync();
      },
      rejectClose: false
    });
  } catch (_) {
    return null;
  }
}

/**
 * A stairwell in one go: drag the stair once on the floor being viewed, tick
 * the floors it serves, and it is placed at the same spot on each ticked floor
 * and joined. A floor it passes without stopping is left unticked. A stair
 * whose ends are in different places goes to the guided flow from the same box.
 *
 * @param {Scene} [scene=canvas.scene]
 * @returns {Promise<void>}
 */
export async function startStairwell(scene = canvas?.scene) {
  if (!requireGM()) return;
  if (!scene) { ui.notifications.warn(t("DAT.Stairs.NoScene")); return; }
  const levels = getSceneLevels(scene);
  if (!levels.length) { ui.notifications.warn(t("DAT.Stairs.NoLevels")); return; }
  // One floor has nothing to stack a stairwell on; a teleport is still possible.
  if (levels.length < 2) return addStairsInteractive(scene);
  if (_placementActive) { ui.notifications.warn(t("DAT.Stairs.InProgress")); return; }

  _placementActive = true;
  const levelId = getCurrentLevelId(scene) ?? levels[0]._id;
  const floor = levels.find((l) => l._id === levelId)?.name || t("DAT.Dash.UnnamedFloor");

  const banner = new PlacementBanner();
  try { banner.mount(); } catch (_) { /* a toast says the same below */ }
  const title = t("DAT.Stairs.WellDrag", { floor });
  const hint = t("DAT.Stairs.WellDragHint");
  banner.setStep(title, hint);
  if (!banner.el) ui.notifications.info(`${title} ${hint}`);

  const ctrl = new AbortController();
  banner.onCancel = () => ctrl.abort();
  const onTearDown = () => ctrl.abort();
  Hooks.on("canvasTearDown", onTearDown);

  let rect = null;
  try { rect = await pickCanvasRectangle({ signal: ctrl.signal }); } catch (_) { rect = null; }
  Hooks.off("canvasTearDown", onTearDown);
  banner.destroy();
  if (!rect) { _placementActive = false; ui.notifications.info(t("DAT.Stairs.Cancelled")); return; }

  // The drawn spot stays marked while the floors are ticked.
  const removeGhost = drawGhostRect(rect);
  let choice = null;
  try { choice = await promptStairwell(levels, levelId, rect); }
  finally {
    try { removeGhost(); } catch (_) { /* already gone */ }
    _placementActive = false;
  }
  if (!choice) { ui.notifications.info(t("DAT.Stairs.Cancelled")); return; }
  if (choice.action === "other") return addStairsInteractive(scene, { entrance: { rect, levelId }, label: choice.label });

  // The floor it was drawn on first, then the others from the bottom up.
  const ticked = new Set([levelId, ...choice.floors]);
  const order = [levelId, ...levels.map((l) => l._id).filter((id) => id !== levelId && ticked.has(id))];
  if (order.length < 2) { ui.notifications.warn(t("DAT.Stairs.WellNeedTwo")); return; }
  try {
    const segments = order.map((id) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, levelId: id }));
    const regions = await createLinkedStairs({ scene, mode: "stairs", label: choice.label, twoWay: true, segments });
    ui.notifications.info(t("DAT.Stairs.WellPlaced", { label: choice.label, count: regions?.length ?? 0 }));
  } catch (err) {
    ui.notifications.error(t("DAT.Stairs.CreateFailed", { error: err.message }));
    console.error(err);
  }
}

/**
 * Add another floor to an EXISTING stair/portal link: the same guided placement
 * as a new stair, but seeded from the link (inherits its type/label, ghosts its
 * current footprints for alignment) and finishing after a single new floor.
 *
 * @param {Scene} scene
 * @param {string} linkId
 * @returns {Promise<void>}
 */
export async function addFloorToLink(scene = canvas?.scene, linkId) {
  if (!linkId) { ui.notifications.warn(t("DAT.Stairs.GoneLink")); return; }
  return startAddStairs(scene, { existingLinkId: linkId });
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
export async function startLinkRegions(scene = canvas?.scene, { mode = "stairs", label = t("DAT.Stairs.DefaultName"), twoWay = true } = {}) {
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
