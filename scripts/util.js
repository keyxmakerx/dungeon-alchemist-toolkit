/**
 * Small shared utilities.
 */

/**
 * Gate a GM-only action. Returns `true` if the current user is a GM; otherwise
 * shows a warning toast and returns `false`. Every public write entry point
 * (import, scene/region creation, portal linking) calls this first so a non-GM
 * gets a clear, early message instead of a confusing mid-pipeline permission
 * error (STRATEGY §3.6: GM-gate every scene write).
 *
 * @param {string} [msg]  Optional custom warning message.
 * @returns {boolean}
 */
export function requireGM(msg) {
  if (game.user?.isGM) return true;
  ui.notifications?.warn(msg ?? "Dungeon Alchemist Toolkit: only a GM can do that.");
  return false;
}
