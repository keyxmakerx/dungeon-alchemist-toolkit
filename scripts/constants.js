/** The module's unique identifier — matches the `id` field in module.json. */
export const MODULE_ID = "dungeon-alchemist-toolkit";

/**
 * Default elevation span per floor, in Foundry level units.
 * Shared between the importer and the dialog so both compute identical defaults.
 */
export const FLOOR_HEIGHT = 10;

/**
 * Client-scoped setting key remembering the importer dialog's last-used
 * selections (door texture/sound, scene colors, copy toggle) across opens.
 */
export const SETTING_IMPORTER_DEFAULTS = "importerDefaults";

/**
 * Floor media at or above this size (bytes) is flagged in the Levels tab.
 * Foundry recommends keeping animated maps under ~50 MB.
 */
export const MEDIA_SIZE_WARN_BYTES = 50 * 1024 * 1024;

/**
 * Flag key (under MODULE_ID) stamped on a Region that participates in a
 * stair/portal link: `{ linkId, label, mode, role }`. Lets the Level Manager
 * and the GM link overlay find and group linked portals without re-deriving
 * them from the native teleportToken destinations.
 */
export const PORTAL_FLAG = "portal";

/**
 * Client-scoped setting: this person has been told that the Stairs Manager
 * window is now the Level Manager's Stairs tab.
 */
export const SETTING_RETIRED_NOTE = "retiredNoteSeen";

/**
 * Scene flag set by the importer: the map still has floors nobody can reach,
 * so the Level Manager shows what is left to do on it.
 */
export const TODO_FLAG = "todo";
