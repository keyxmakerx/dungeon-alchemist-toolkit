/**
 * Stair / Portal creation flows (the "place-then-link" wizard + direct-connect).
 *
 * v1 keeps the UX dialog-free and fast: the GM clicks/drags to place the
 * entrance on the current level, switches to the destination level, then
 * clicks/drags to place the exit — and we wire a native `teleportToken` link
 * between them (see portal-core.js). Mode/label options default to "stairs";
 * a richer options dialog + a Stairs Manager come next.
 */

import { createLinkedStairs, linkExistingRegions, getPortalFlag } from "./portal-core.js";
import { getSceneLevels, getCurrentLevelId, pickCanvasRectangle } from "../region-adder.js";

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
 * Interactive create: ask for type/label/direction, then run the place-then-link
 * flow. This is what the sidebar button and `DA.AddStairs()` (no args) call.
 *
 * @param {Scene} [scene=canvas.scene]
 * @returns {Promise<void>}
 */
export async function addStairsInteractive(scene = canvas?.scene) {
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
 * Place-then-link: two canvas placements (entrance, then exit on whatever level
 * is active at that moment) become a linked teleport pair. Same level on both =
 * a same-map teleport; different levels = stairs.
 *
 * @param {Scene} [scene=canvas.scene]
 * @param {object} [opts]
 * @param {"stairs"|"teleport"|"trap"} [opts.mode="stairs"]
 * @param {string} [opts.label="Stairs"]
 * @param {boolean} [opts.twoWay=true]
 * @returns {Promise<void>}
 */
export async function startAddStairs(scene = canvas?.scene, { mode = "stairs", label = "Stairs", twoWay = true } = {}) {
  if (!scene) { ui.notifications.warn("DA Stairs: no active scene."); return; }
  if (!getSceneLevels(scene).length) {
    ui.notifications.warn("DA Stairs: this scene has no Levels — import or add levels first.");
    return;
  }

  ui.notifications.info("DA Stairs: click (or drag) to place the ENTRANCE on the current level. Esc to cancel.");
  let entranceRect;
  try {
    entranceRect = await pickCanvasRectangle();
  } catch (_) {
    ui.notifications.info("DA Stairs: cancelled.");
    return;
  }
  const entranceLevel = getCurrentLevelId(scene);

  ui.notifications.info("DA Stairs: now switch to the destination level, then click (or drag) to place the EXIT. Esc to cancel.");
  let destRect;
  try {
    destRect = await pickCanvasRectangle();
  } catch (_) {
    ui.notifications.info("DA Stairs: cancelled (entrance not created).");
    return;
  }
  const destLevel = getCurrentLevelId(scene);

  try {
    const regions = await createLinkedStairs({
      scene,
      mode,
      label,
      twoWay,
      segments: [
        { x: entranceRect.x, y: entranceRect.y, width: entranceRect.width, height: entranceRect.height, levelId: entranceLevel },
        { x: destRect.x, y: destRect.y, width: destRect.width, height: destRect.height, levelId: destLevel }
      ]
    });
    const sameLevel = entranceLevel && entranceLevel === destLevel;
    ui.notifications.info(`DA Stairs: created ${regions.length} linked region(s)${sameLevel ? " (same level — teleport)" : ""}.`);
  } catch (err) {
    ui.notifications.error(`DA Stairs: failed to create (${err.message})`);
    console.error(err);
  }
}

/**
 * Direct-connect: bind two regions the GM picks by clicking them on the canvas.
 * Click the first region, then the second; we link them as a teleport pair.
 * (Reuses native control-click selection: we read the currently controlled
 * Region between prompts.)
 *
 * @param {Scene} [scene=canvas.scene]
 * @param {object} [opts]
 * @param {"stairs"|"teleport"|"trap"} [opts.mode="stairs"]
 * @param {string} [opts.label="Stairs"]
 * @param {boolean} [opts.twoWay=true]
 * @returns {Promise<void>}
 */
export async function startLinkRegions(scene = canvas?.scene, { mode = "stairs", label = "Stairs", twoWay = true } = {}) {
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
