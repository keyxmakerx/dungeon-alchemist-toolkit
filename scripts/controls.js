/**
 * Toolkit entry point: a GM-only Module Settings menu that opens the hub.
 *
 * NOTE: a native scene-controls group ("Dungeon Alchemist" in the left toolbar)
 * was tried here but REMOVED — custom control groups have open core bugs in early
 * 14.x and it appears to interfere with native floor/level selection on the
 * canvas. The unified entry point is being redesigned (see docs/REWORK-PLAN.md);
 * until then the hub is reached via Module Settings or the `DA`/module API.
 */

import { MODULE_ID } from "./constants.js";
import { DAToolkitHub } from "./hub.js";

/**
 * Register the settings-menu entry that opens the hub. Call once during `init`.
 */
export function registerToolkitEntries() {
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
}
