/**
 * Import by dropping the folder Dungeon Alchemist exported onto the Foundry
 * window. The files are copied into the world and the import window opens on
 * them, so nothing has to be put into Foundry's files by hand first.
 *
 * It only claims a drop that holds a folder, or loose files that pair up into
 * floors. Any other drop (a picture for a tile, a file for Foundry's own file
 * picker) is left exactly as it was. GM only, and it can be switched off in
 * Module Settings.
 */

import { MODULE_ID } from "./constants.js";
import { ensureUniqueSubfolder } from "./da-importer.js";
import { MEDIA_EXTS, mapName, collectFloorPairs } from "./floor-grouping.js";
import { looksLikeExportDrag, exportFileNames, safeFolderName } from "./drop-files.js";
import { t } from "./util.js";

let zone = null;
let hideTimer = null;
let busy = false;

function enabled() {
  if (!game.user?.isGM) return false;
  try { return game.settings.get(MODULE_ID, "dropImport") !== false; } catch (_) { return true; }
}

/** Foundry's own file picker takes dropped files itself. */
function overFilePicker(event) {
  return !!event.target?.closest?.(".filepicker, #file-picker, .file-picker");
}

function showZone() {
  if (!zone) {
    zone = document.createElement("div");
    zone.className = "da-dropzone";
    const label = document.createElement("div");
    label.className = "da-dropzone-label";
    label.textContent = t("DAT.Drop.Here");
    zone.appendChild(label);
  }
  if (!zone.isConnected) document.body.appendChild(zone);
  clearTimeout(hideTimer);
  // A drag that leaves the window sends no reliable "left" event, so the zone
  // goes away when the stream of dragover events stops.
  hideTimer = setTimeout(hideZone, 700);
}

function hideZone() {
  clearTimeout(hideTimer);
  hideTimer = null;
  try { zone?.remove(); } catch (_) { /* already gone */ }
}

/** Every entry in a dropped folder (one level: an export is a flat folder). */
function readFolder(dirEntry) {
  return new Promise((resolve, reject) => {
    const reader = dirEntry.createReader();
    const out = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) { resolve(out); return; }
      out.push(...batch);
      next();
    }, reject);
    next();
  });
}

const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

const isExportFile = (name) => {
  const ext = String(name).split(".").pop().toLowerCase();
  return ext === "json" || MEDIA_EXTS.includes(ext);
};

/**
 * Find the floors in what was dropped: the first folder that holds any, else
 * the loose files.
 *
 * @param {FileSystemDirectoryEntry[]} dirs
 * @param {File[]} loose
 * @returns {Promise<{name:string, files:File[]}|null>}
 */
async function findExport(dirs, loose) {
  for (const dir of dirs) {
    const entries = (await readFolder(dir)).filter((e) => e.isFile && isExportFile(e.name));
    const keep = new Set(exportFileNames(entries.map((e) => e.name)));
    if (!keep.size) continue;
    const files = await Promise.all(entries.filter((e) => keep.has(e.name)).map(fileOf));
    return { name: dir.name, files };
  }
  const keep = new Set(exportFileNames(loose.map((f) => f.name)));
  if (!keep.size) return null;
  const files = loose.filter((f) => keep.has(f.name));
  return { name: mapName(collectFloorPairs(files.map((f) => f.name))), files };
}

/** Copy the export into the world and open the import window on it. */
async function importDropped(dirs, loose) {
  const found = await findExport(dirs, loose);
  if (!found) { ui.notifications?.warn?.(t("DAT.Drop.NoFloors")); return; }

  const FilePicker = foundry.applications.apps?.FilePicker?.implementation;
  if (typeof FilePicker?.upload !== "function") { ui.notifications?.warn?.(t("DAT.Drop.NoUpload")); return; }

  const total = found.files.length;
  const megabytes = Math.max(1, Math.round(found.files.reduce((sum, f) => sum + (f.size || 0), 0) / (1024 * 1024)));
  let dest;
  try {
    dest = await ensureUniqueSubfolder(safeFolderName(found.name));
  } catch (err) {
    ui.notifications?.error?.(t("DAT.Importer.FolderFailed", { error: err.message }));
    return;
  }

  // A progress bar where this Foundry has one; a plain note where it does not.
  let note = null;
  try { note = ui.notifications?.info?.(t("DAT.Drop.Copying", { count: total, mb: megabytes }), { progress: true }); } catch (_) { note = null; }
  const step = (done) => { try { note?.update?.({ pct: done / total }); } catch (_) { /* the copy carries on */ } };

  let copied = 0;
  const failed = [];
  for (const file of found.files) {
    try {
      const result = await FilePicker.upload("data", dest, file, {}, { notify: false });
      if (result?.path) copied++;
      else failed.push(file.name);
    } catch (err) {
      console.warn(`[DA Toolkit] could not copy "${file.name}":`, err);
      failed.push(file.name);
    }
    step(copied + failed.length);
  }
  step(total);

  if (failed.length) ui.notifications?.warn?.(t("DAT.Drop.SomeFailed", { count: failed.length, names: failed.join(", ") }));
  if (!copied) return;
  game.modules.get(MODULE_ID)?.api?.Importer?.({ source: "data", path: dest, copied });
}

function onDragOver(event) {
  if (!enabled() || busy || overFilePicker(event)) return;
  const items = Array.from(event.dataTransfer?.items ?? []).map((i) => ({ kind: i.kind, type: i.type }));
  if (!looksLikeExportDrag(items)) return;
  // Without this the browser refuses the drop outside Foundry's own drop targets.
  event.preventDefault();
  showZone();
}

function onDrop(event) {
  hideZone();
  if (!enabled() || busy || overFilePicker(event)) return;
  const dt = event.dataTransfer;
  if (!dt?.items?.length) return;
  // What was dropped can only be read while this event is being handled.
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === "file")
    .map((i) => { try { return i.webkitGetAsEntry?.() ?? null; } catch (_) { return null; } })
    .filter(Boolean);
  const dirs = entries.filter((e) => e.isDirectory);
  const loose = Array.from(dt.files ?? []).filter((f) => isExportFile(f.name));
  if (!dirs.length && !exportFileNames(loose.map((f) => f.name)).length) return;   // not an export: not ours

  event.preventDefault();
  event.stopPropagation();
  busy = true;
  importDropped(dirs, loose)
    .catch((err) => {
      console.error(err);
      ui.notifications?.error?.(t("DAT.Drop.Failed", { error: err.message }));
    })
    .finally(() => { busy = false; });
}

/** Start listening for folder drops. Called once at init. */
export function registerDropImport() {
  Hooks.once("ready", () => {
    try {
      if (!game.user?.isGM) return;
      document.addEventListener("dragover", onDragOver, true);
      document.addEventListener("drop", onDrop, true);
      document.addEventListener("dragend", hideZone, true);
    } catch (err) {
      console.warn("[DA Toolkit] folder drop not available (non-fatal):", err);
    }
  });
}
