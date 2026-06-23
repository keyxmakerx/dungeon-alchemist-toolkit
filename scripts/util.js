/**
 * Small shared utilities.
 */

/**
 * Localize a key, or format it with `data`. A thin wrapper over `game.i18n` so
 * call sites stay short; falls back to the key itself if i18n isn't ready.
 *
 * @param {string} key
 * @param {object} [data]  Substitution data for `game.i18n.format`.
 * @returns {string}
 */
export function t(key, data) {
  try {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch (_) {
    return key;
  }
}

/**
 * Gate a GM-only action. Returns `true` if the current user is a GM; otherwise
 * shows a warning toast and returns `false`. Every public write entry point
 * (import, scene/region creation, portal linking) calls this first so a non-GM
 * gets a clear, early message instead of a confusing mid-pipeline permission
 * error (STRATEGY §3.6: GM-gate every scene write).
 *
 * @param {string} [msg]  Optional custom (already-localized) warning message.
 * @returns {boolean}
 */
export function requireGM(msg) {
  if (game.user?.isGM) return true;
  ui.notifications?.warn(msg ?? t("DAT.Common.GMOnly"));
  return false;
}
