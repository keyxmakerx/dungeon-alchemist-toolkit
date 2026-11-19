/**
 * The import window: find the folder Dungeon Alchemist exported, check the
 * floors it holds, and make one Scene from them.
 *
 * Once a folder with floors is found the browser folds to one line and the
 * floors are listed top floor first, the way the building stands. One click
 * says which floor is at street level; names and heights are counted from
 * there (see floor-naming.js).
 */

import { importFolder, collectFloorPairs } from "./da-importer.js";
import { buildThumb as _buildThumbEl } from "./floor-rows.js";
import { isRoofName, mapName } from "./floor-grouping.js";
import { floorKind, floorRange } from "./floor-naming.js";
import { FLOOR_HEIGHT, MODULE_ID, SETTING_IMPORTER_DEFAULTS, MEDIA_SIZE_WARN_BYTES } from "./constants.js";
import { requireGM, t } from "./util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** "1 floor" or "5 floors". */
function floorsWord(count) {
  return t(count === 1 ? "DAT.Common.FloorOne" : "DAT.Common.FloorMany", { count });
}

export class DAImporterDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {{uid:string, stem:string, index:number, json:string, media:string}[]} Floors found, bottom-first. */
  _floorPairs = [];
  /** Video thumbnails currently in the list; paused and released on rebuild and close. */
  _thumbVideos = [];
  /** uid of the floor shown when the scene opens; null until a folder is browsed. */
  _initialLevelUid = null;
  /** True once the start floor was picked by hand, so it stops following the street-level floor. */
  _startPicked = false;
  /** uid of the floor at street level. */
  _groundUid = null;
  /** @type {Map<string, {name:string, nameEdited:boolean, bottom:string, top:string, isRoof:boolean}>} What was typed per floor, keyed by uid so it follows the floor through a reorder. */
  _levelState = new Map();
  /** Row being dragged to a new place; null when nothing is. */
  _dragFromIndex = null;
  /** Guards the one-time restore of remembered selections. */
  _restoredDefaults = false;
  /** @type {Map<string, number>} Media sizes in bytes by floor uid. */
  _mediaSizes = new Map();
  /** Counts size checks, so a slow one can't mark rows from an older folder. */
  _sizeProbeGen = 0;
  /** Stops the size check in flight when the folder changes or the window closes. */
  _sizeAbort = null;
  /** Whether the extra columns are showing. */
  _advancedView = false;
  /** The file source being browsed ("data", "public", "s3"). */
  _source = "data";
  /** The folder being shown, relative to the source ("" is its top). */
  _cwd = "";
  /** Subfolders of that folder. */
  _dirs = [];
  /** Guards the first browse. */
  _browsedOnce = false;
  /** S3 bucket the folder lives in; "" for the local sources. */
  _bucket = "";
  /** Counts browses, so a slow listing can't replace a newer one. */
  _browseGen = 0;
  /** True while an import runs, so a second click can't make a second scene. */
  _importing = false;
  /** Whether the folder browser is unfolded. It folds once floors are found. */
  _browserOpen = true;
  /** Files copied in by a folder drop; 0 when the folder was browsed to. */
  _copied = 0;

  static DEFAULT_OPTIONS = {
    id: "da-importer",
    tag: "form",
    form: {
      closeOnSubmit: false
    },
    window: {
      title: "DAT.Importer.Title",
      resizable: false
    },
    position: {
      width: 620,
      height: "auto"
    },
    actions: {
      browse: DAImporterDialog.#onBrowse,
      browseUp: DAImporterDialog.#onBrowseUp,
      changeFolder: DAImporterDialog.#onChangeFolder,
      import: DAImporterDialog.#onImport,
      previewSound: DAImporterDialog.#onPreviewSound
    }
  };

  static PARTS = {
    form: {
      template: "modules/dungeon-alchemist-toolkit/templates/importer.hbs"
    }
  };

  /** @override */
  get title() {
    const n = this._floorPairs.length;
    if (!n) return t("DAT.Importer.Title");
    return t("DAT.Importer.TitleFound", { name: mapName(this._floorPairs, this._cwd) || t("DAT.Importer.Title"), floors: floorsWord(n) });
  }

  /**
   * Point the window at a folder. Used by the folder drop, which has just
   * copied the export into the world.
   *
   * @param {{source?:string, path?:string, copied?:number}} opts
   */
  startAt({ source = "data", path = "", copied = 0 } = {}) {
    this._source = source;
    this._bucket = "";
    this._cwd = path;
    this._copied = copied;
    if (this.rendered) {
      this._syncSourceSelect();
      this._browseTo(path);
    }
  }

  /** Open Foundry's own file picker and go to the folder chosen there. */
  static async #onBrowse(_event, _target) {
    const FilePicker = foundry.applications.apps?.FilePicker?.implementation;
    if (!FilePicker) return;
    const picker = new FilePicker({
      type: "folder",
      current: this._cwd || "",
      callback: async (path) => {
        this._source = picker.activeSource ?? this._source;
        this._bucket = this._source === "s3" ? (picker.source?.bucket ?? "") : "";
        this._copied = 0;
        this._syncSourceSelect();
        await this._browseTo(path);
      }
    });
    await picker.browse(this._cwd || "");
  }

  /** Go up one folder (nothing happens at the top). */
  static async #onBrowseUp(_event, _target) {
    const parent = this._cwd.includes("/") ? this._cwd.split("/").slice(0, -1).join("/") : "";
    this._copied = 0;
    await this._browseTo(parent);
  }

  /** Unfold the folder browser again. */
  static #onChangeFolder() {
    this._browserOpen = true;
    this._renderBrowser();
  }

  /**
   * List a folder's subfolders and files, find the Dungeon Alchemist floors
   * among the files, and show both. Going somewhere is just calling this with
   * a new path.
   *
   * @param {string} path  Folder path relative to the current source ("" is its top).
   */
  async _browseTo(path) {
    const FilePicker = foundry.applications.apps?.FilePicker?.implementation;
    if (typeof FilePicker?.browse !== "function") {
      ui.notifications?.warn?.(t("DAT.Importer.NoBrowse"));
      return;
    }
    const gen = ++this._browseGen;
    let listing;
    try {
      listing = await FilePicker.browse(this._source, path ?? "", this._bucket ? { bucket: this._bucket } : {});
    } catch (err) {
      if (gen === this._browseGen) ui.notifications?.warn?.(t("DAT.Importer.BrowseFailed", { path: path ?? "", error: err.message }));
      return;
    }
    if (gen !== this._browseGen) return;   // a newer browse has taken over
    this._cwd = listing.target ?? path ?? "";
    this._dirs = (listing.dirs ?? []).slice().sort((a, b) => a.localeCompare(b));

    this._floorPairs = collectFloorPairs(listing.files ?? []);
    // A new folder: each floor gets a uid that edits and order follow, and
    // everything typed for the old folder is dropped.
    for (const p of this._floorPairs) p.uid = foundry.utils.randomID();
    this._levelState = new Map();
    // Street level starts on the lowest floor, so a map with no cellar needs no click.
    this._groundUid = this._floorPairs[0]?.uid ?? null;
    this._initialLevelUid = this._groundUid;
    this._startPicked = false;
    this._mediaSizes = new Map();
    this._browserOpen = this._floorPairs.length === 0;

    // A file named "roof" is set to show only from the floor under it. That is a
    // guess, changeable under Advanced, so it is said out loud.
    const roofs = this._floorPairs.filter((p, i) => i > 0 && isRoofName(p.stem));
    if (roofs.length) {
      ui.notifications.info(t("DAT.Importer.RoofDetected", { count: roofs.length, names: roofs.map((p) => p.stem).join(", ") }));
    }

    this._renderBrowser();
    this._populateLevelsTab();
    this._probeMediaSizes(this._source);
  }

  /**
   * Draw the folder browser from what is known: unfolded with the folder list,
   * or folded to one line once floors are found; the status line; the Import
   * button; the window title.
   */
  _renderBrowser() {
    if (!this.element) return;
    const n = this._floorPairs.length;
    const where = this._cwd ? `/${this._cwd}` : t("DAT.Importer.Root");

    const line = this.element.querySelector(".da-browse-line");
    const full = this.element.querySelector(".da-browse-full");
    if (line) line.hidden = this._browserOpen;
    if (full) full.hidden = !this._browserOpen;
    const whereEl = this.element.querySelector(".da-browse-where");
    if (whereEl) whereEl.textContent = where;
    const pathEl = this.element.querySelector(".da-browse-path");
    if (pathEl) pathEl.textContent = where;

    const upBtn = this.element.querySelector(".da-browse-up");
    if (upBtn) upBtn.disabled = !this._cwd;

    const dirList = this.element.querySelector(".da-browse-dirs");
    if (dirList) {
      dirList.replaceChildren();
      if (!this._dirs.length) {
        const empty = document.createElement("p");
        empty.className = "hint da-browse-empty";
        empty.textContent = t("DAT.Importer.NoSubfolders");
        dirList.appendChild(empty);
      } else {
        for (const dir of this._dirs) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "da-browse-dir";
          row.textContent = dir.split("/").filter(Boolean).pop() || dir;
          row.addEventListener("click", () => { this._copied = 0; this._browseTo(dir); });
          dirList.appendChild(row);
        }
      }
    }

    const status = this.element.querySelector(".da-browse-status");
    if (status) {
      status.textContent = n ? t("DAT.Importer.Found", { floors: floorsWord(n) }) : t("DAT.Importer.NoneHere");
      status.classList.toggle("da-browse-status--found", n > 0);
    }
    const copied = this.element.querySelector(".da-import-copied");
    if (copied) {
      copied.hidden = !(this._copied && n);
      copied.textContent = this._copied ? t("DAT.Importer.Copied", { count: this._copied }) : "";
    }
    // Dropped files are already in the world, so there is nothing to copy.
    const copyGroup = this.element.querySelector(".da-copy-group");
    if (copyGroup) copyGroup.hidden = !!this._copied;

    const floorsBlock = this.element.querySelector(".da-import-floors");
    if (floorsBlock) floorsBlock.hidden = n === 0;

    const importBtn = this.element.querySelector('[data-action="import"]');
    if (importBtn) importBtn.disabled = n === 0 || this._importing;
    const importLabel = this.element.querySelector(".da-import-btn-label");
    if (importLabel) importLabel.textContent = n ? t("DAT.Importer.ImportN", { floors: floorsWord(n) }) : t("DAT.Importer.ImportBtn");

    try { if (this.window?.title) this.window.title.textContent = this.title; } catch (_) { /* keep the old title */ }
  }

  /**
   * Point the source dropdown at the source being browsed. A source the
   * dropdown doesn't list (S3, reached through the file picker) gets its own
   * entry so the dropdown never shows the wrong one.
   */
  _syncSourceSelect() {
    const srcSel = this.element?.querySelector("select[name='sourceSelect']");
    if (!srcSel) return;
    if (![...srcSel.options].some((o) => o.value === this._source)) {
      const opt = document.createElement("option");
      opt.value = this._source;
      opt.textContent = this._source === "s3" ? "S3" : this._source;
      srcSel.appendChild(opt);
    }
    srcSel.value = this._source;
  }

  /** Play the chosen door sound once. */
  static async #onPreviewSound(_event, _target) {
    const soundKey = this.element.querySelector("select[name='doorSound']")?.value;
    if (!soundKey) return;
    const soundConfig = CONFIG.Wall.doorSounds?.[soundKey];
    if (!soundConfig) return;
    const src = soundConfig.open ?? soundConfig.close;
    if (src) foundry.audio.AudioHelper.play({ src, volume: 1 });
  }

  /**
   * Put back the selections remembered from the last import (door look and
   * sound, scene colours, copy switch). Once, on the first draw, so a later
   * redraw can't undo what is being changed.
   */
  _restoreSavedDefaults() {
    if (this._restoredDefaults) return;
    this._restoredDefaults = true;
    let saved;
    try { saved = game.settings.get(MODULE_ID, SETTING_IMPORTER_DEFAULTS); }
    catch (_) { return; }
    if (!saved || typeof saved !== "object") return;

    const setValue = (selector, value) => {
      if (value === undefined || value === null) return;
      const el = this.element.querySelector(selector);
      if (el) el.value = String(value);
    };
    setValue("input[name='backgroundColor']", saved.backgroundColor);
    setValue("input[name='gridAlpha']", saved.gridAlpha);
    setValue("select[name='doorTexture']", saved.doorTexture);
    setValue("select[name='doorSound']", saved.doorSound);
    const copyEl = this.element.querySelector("input[name='copyImages']");
    if (copyEl && typeof saved.copyImages === "boolean") copyEl.checked = saved.copyImages;
  }

  /** Remember the current scene and door selections for the next import. */
  _saveCurrentDefaults({ backgroundColor, gridAlpha, copyImages, doorTexture, doorSound }) {
    try {
      game.settings.set(MODULE_ID, SETTING_IMPORTER_DEFAULTS, {
        backgroundColor, gridAlpha, copyImages, doorTexture, doorSound
      });
    } catch (_) { /* nothing is lost but the memory */ }
  }

  /** @override */
  _onRender(_context, _options) {
    this._restoreSavedDefaults();

    const range = this.element.querySelector("input[name='gridAlpha']");
    const display = this.element.querySelector(".range-value");
    if (range && display) {
      display.textContent = parseFloat(range.value).toFixed(2);
      range.addEventListener("input", () => {
        display.textContent = parseFloat(range.value).toFixed(2);
      });
    }

    const doorSelect = this.element.querySelector("select[name='doorTexture']");
    const doorPreview = this.element.querySelector(".da-door-preview");
    if (doorSelect && doorPreview) {
      const syncPreview = () => {
        doorPreview.src = doorSelect.value;
        doorPreview.hidden = !doorSelect.value;
      };
      syncPreview();
      doorSelect.addEventListener("change", syncPreview);

      let tooltip = null;
      doorPreview.addEventListener("mouseenter", () => {
        if (doorPreview.hidden || !doorPreview.src) return;
        tooltip = document.createElement("div");
        tooltip.className = "da-door-tooltip";
        const img = document.createElement("img");
        img.src = doorPreview.src;
        tooltip.appendChild(img);
        document.body.appendChild(tooltip);
        const rect = doorPreview.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top  = `${rect.top - 8}px`;
      });
      doorPreview.addEventListener("mouseleave", () => {
        tooltip?.remove();
        tooltip = null;
      });
    }

    // A new floor height restacks every floor; names stay.
    const uniformInput = this.element.querySelector("input[name='uniformFloorHeight']");
    if (uniformInput) {
      uniformInput.addEventListener("change", () => {
        const h = parseInt(uniformInput.value, 10);
        if (!Number.isFinite(h) || h < 1 || !this._floorPairs.length) return;
        this._captureRowState();
        this._recomputeElevations();
        this._populateLevelsTab();
      });
    }

    const advToggle = this.element.querySelector("input[name='showAdvanced']");
    const levelsList = this.element.querySelector(".da-levels-list");
    if (advToggle && levelsList) {
      advToggle.checked = this._advancedView;
      levelsList.classList.toggle("da-levels--advanced", this._advancedView);
      advToggle.addEventListener("change", () => {
        this._advancedView = advToggle.checked;
        levelsList.classList.toggle("da-levels--advanced", this._advancedView);
      });
    }

    const advHelpBtn = this.element.querySelector(".da-adv-help-btn");
    const advHelp = this.element.querySelector(".da-adv-help");
    if (advHelpBtn && advHelp) {
      advHelpBtn.addEventListener("click", () => {
        advHelp.hidden = !advHelp.hidden;
        advHelpBtn.setAttribute("aria-expanded", String(!advHelp.hidden));
      });
    }

    const srcSel = this.element.querySelector("select[name='sourceSelect']");
    if (srcSel) {
      this._syncSourceSelect();
      srcSel.addEventListener("change", () => {
        this._source = srcSel.value;
        if (this._source !== "s3") this._bucket = "";
        this._copied = 0;
        this._browseTo("");
      });
    }

    // The first draw opens the starting folder; later draws repaint from what is known.
    if (!this._browsedOnce) {
      this._browsedOnce = true;
      this._browseTo(this._cwd || "");
    } else {
      this._renderBrowser();
      this._populateLevelsTab();
    }
  }

  /**
   * Pause and release every video thumbnail. Called before the list is rebuilt
   * and on close, so a removed <video> stops decoding.
   */
  _teardownThumbVideos() {
    for (const v of this._thumbVideos) {
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch (_) { /* ignore */ }
    }
    this._thumbVideos = [];
    document.querySelectorAll(".da-level-tooltip").forEach((tip) => {
      tip.querySelector("video")?.pause();
      tip.remove();
    });
  }

  /**
   * Ask for each floor's media size (a HEAD request) and mark the floors that
   * are bigger than Foundry recommends.
   * - Only Foundry's own local sources are asked; a remote address is never
   *   contacted, so the GM's address is not handed to another host.
   * - No cookies, a time limit, and a per-browse count, so a slow or stale
   *   check can neither hang the window nor mark rows from another folder.
   * - Any failure means "size unknown": no warning, and never a blocked import.
   *
   * @param {string} source  File source the folder was browsed from.
   */
  async _probeMediaSizes(source) {
    if (source !== "data" && source !== "public") return;
    if (!this._floorPairs.length) return;

    const gen = ++this._sizeProbeGen;
    this._sizeAbort?.abort();
    const controller = new AbortController();
    this._sizeAbort = controller;
    const timer = setTimeout(() => controller.abort(), 10000);

    const oversize = [];
    await Promise.all(this._floorPairs.map(async (pair) => {
      try {
        const res = await fetch(pair.media, { method: "HEAD", credentials: "omit", cache: "no-store", signal: controller.signal });
        const len = res.ok ? res.headers.get("content-length") : null;
        const bytes = len ? parseInt(len, 10) : NaN;
        if (!Number.isFinite(bytes)) return;
        if (gen !== this._sizeProbeGen) return;
        this._mediaSizes.set(pair.uid, bytes);
        this._applySizeBadge(pair, bytes);
        if (bytes >= MEDIA_SIZE_WARN_BYTES) oversize.push(pair.stem);
      } catch (_) { /* size unknown */ }
    }));
    clearTimeout(timer);

    if (gen === this._sizeProbeGen && oversize.length) {
      ui.notifications.warn(t("DAT.Importer.Oversize", { count: oversize.length, names: oversize.join(", ") }));
    }
  }

  /**
   * Put a floor's file name and size in its thumbnail's tooltip; an oversized
   * one also gets a warning outline.
   *
   * @param {{uid:string,stem:string}} pair
   * @param {number} bytes
   * @param {HTMLElement} [thumbEl]  The thumbnail, when its row is not in the page yet.
   */
  _applySizeBadge(pair, bytes, thumbEl) {
    const thumb = thumbEl ?? this.element?.querySelector(`.da-level-row[data-uid="${pair.uid}"] .da-level-thumb`);
    if (!thumb) return;
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const big = bytes >= MEDIA_SIZE_WARN_BYTES;
    thumb.classList.toggle("da-thumb-oversize", big);
    thumb.dataset.tooltip = t(big ? "DAT.Importer.SizeBig" : "DAT.Importer.Size", { name: pair.stem, mb });
  }

  /** Index of the street-level floor (the lowest when none is set). */
  _groundIndex() {
    const i = this._floorPairs.findIndex((p) => p.uid === this._groundUid);
    return i < 0 ? 0 : i;
  }

  /**
   * Each floor's name counted from the street: Basement 2, Basement 1, Ground
   * floor, Upper floor 1. A file with "roof" in its name, above the street, is
   * called Roof.
   * @returns {Map<string, string>} uid → name
   */
  _defaultNames() {
    const ground = this._groundIndex();
    const names = new Map();
    let roofs = 0;
    this._floorPairs.forEach((pair, i) => {
      const { kind, n } = floorKind(i, ground, isRoofName(pair.stem));
      let name;
      if (kind === "roof") name = ++roofs === 1 ? t("DAT.Floor.Roof") : t("DAT.Floor.RoofN", { n: roofs });
      else if (kind === "ground") name = t("DAT.Floor.Ground");
      else if (kind === "basement") name = t("DAT.Floor.Basement", { n });
      else name = t("DAT.Floor.Upper", { n });
      names.set(pair.uid, name);
    });
    return names;
  }

  /** The height of one floor, from the Height field. */
  _floorHeight() {
    const h = parseInt(this.element?.querySelector("input[name='uniformFloorHeight']")?.value ?? "", 10);
    return Number.isFinite(h) && h >= 1 ? h : FLOOR_HEIGHT;
  }

  /**
   * Copy what is typed in the rows into _levelState, keyed by floor uid, so it
   * follows the floor through a rebuild or a reorder.
   */
  _captureRowState() {
    if (!this.element) return;
    for (let i = 0; i < this._floorPairs.length; i++) {
      const uid = this._floorPairs[i].uid;
      const nameEl = this.element.querySelector(`input[name="levelName[${i}]"]`);
      if (!nameEl) continue;
      this._levelState.set(uid, {
        name: nameEl.value ?? "",
        nameEdited: nameEl.dataset.edited === "1",
        bottom: this.element.querySelector(`input[name="levelBottom[${i}]"]`)?.value ?? "",
        top: this.element.querySelector(`input[name="levelTop[${i}]"]`)?.value ?? "",
        isRoof: this.element.querySelector(`input[name="levelIsRoof[${i}]"]`)?.checked ?? false
      });
    }
  }

  /**
   * Give every floor the default heights for where it now sits, counted from
   * the street-level floor. Used after a reorder, a new street level, or a new
   * floor height. Names are left alone.
   */
  _recomputeElevations() {
    const height = this._floorHeight();
    const ground = this._groundIndex();
    this._floorPairs.forEach((pair, i) => {
      const st = this._levelState.get(pair.uid) ?? { name: "", nameEdited: false, isRoof: false };
      const { bottom, top } = floorRange(i, ground, height);
      st.bottom = String(bottom);
      st.top = String(top);
      if (i === 0) st.isRoof = false;   // the lowest floor has nothing under it to be a roof over
      this._levelState.set(pair.uid, st);
    });
  }

  /**
   * Move a floor to a new place in the stack. What was typed follows each
   * floor; heights are restacked for the new order.
   *
   * @param {number} from
   * @param {number} to
   */
  _reorderFloors(from, to) {
    const n = this._floorPairs.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    this._captureRowState();
    const [moved] = this._floorPairs.splice(from, 1);
    this._floorPairs.splice(to, 0, moved);
    this._recomputeElevations();
    this._populateLevelsTab();
  }

  /** Rebuild the floor rows, top floor first. Called after every browse and draw. */
  _populateLevelsTab() {
    this._teardownThumbVideos();

    const list = this.element?.querySelector(".da-levels-list");
    if (!list) return;

    // Files that could not be paired (a picture with no .json, or the reverse)
    // are named, so a wrong or partial folder is obvious.
    const orphanEl = this.element?.querySelector(".da-import-orphans");
    if (orphanEl) {
      const orphans = Array.isArray(this._floorPairs.orphans) ? this._floorPairs.orphans : [];
      orphanEl.hidden = orphans.length === 0;
      orphanEl.textContent = orphans.length
        ? t("DAT.Importer.OrphanList", { count: orphans.length, names: orphans.join("; ") })
        : "";
    }

    // Typing in a row is copied into _levelState as it happens (wired once per
    // list), so it survives a full redraw.
    if (!list.dataset.daCaptureWired) {
      const capture = () => this._captureRowState();
      list.addEventListener("input", capture);
      list.addEventListener("change", capture);
      list.dataset.daCaptureWired = "1";
    }

    list.replaceChildren();
    if (!this._floorPairs.length) return;

    const header = document.createElement("div");
    header.className = "da-levels-header";
    const headerCols = [
      { label: "#", tip: "DAT.Importer.ColOrder" },
      { label: "", tip: "DAT.Importer.ColPreview" },
      { label: t("DAT.Importer.ColName") },
      { label: t("DAT.Importer.ColHeight"), cls: "da-basic-col" },
      { label: t("DAT.Importer.ColBottom"), cls: "da-adv-col" },
      { label: t("DAT.Importer.ColTop"), cls: "da-adv-col" },
      { label: t("DAT.Importer.ColStreet") },
      { label: t("DAT.Importer.ColRoof"), cls: "da-adv-col" },
      { label: t("DAT.Importer.ColStart"), cls: "da-adv-col" }
    ];
    for (const col of headerCols) {
      const span = document.createElement("span");
      span.textContent = col.label;
      if (col.tip) span.dataset.tooltip = t(col.tip);
      if (col.cls) span.classList.add(col.cls);
      header.appendChild(span);
    }
    list.appendChild(header);

    const names = this._defaultNames();
    const ground = this._groundIndex();
    const height = this._floorHeight();
    const pick = (cls) => { const el = document.createElement("span"); el.className = `da-level-pick${cls ? ` ${cls}` : ""}`; return el; };

    for (let i = this._floorPairs.length - 1; i >= 0; i--) {
      const pair = this._floorPairs[i];
      const st = this._levelState.get(pair.uid);
      const def = floorRange(i, ground, height);
      const defaultName = names.get(pair.uid);
      const name = st?.nameEdited ? st.name : defaultName;
      const bottom = st?.bottom !== undefined && st.bottom !== "" ? st.bottom : String(def.bottom);
      const top = st?.top !== undefined && st.top !== "" ? st.top : String(def.top);

      const row = document.createElement("div");
      row.className = "da-level-row";
      if (i === ground) row.classList.add("is-ground");
      row.dataset.levelIndex = String(i);
      row.dataset.uid = pair.uid;
      // The number is the handle; the whole row takes the drop.
      row.addEventListener("dragover", (e) => {
        if (this._dragFromIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        row.classList.add("da-row-dragover");
      });
      row.addEventListener("dragleave", () => row.classList.remove("da-row-dragover"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("da-row-dragover");
        const from = this._dragFromIndex;
        this._dragFromIndex = null;
        if (from !== null && from !== i) this._reorderFloors(from, i);
      });

      const indexBadge = document.createElement("span");
      indexBadge.className = "da-level-index";
      indexBadge.textContent = String(i + 1);
      indexBadge.draggable = true;
      indexBadge.dataset.tooltip = t("DAT.Importer.DragHint");
      indexBadge.addEventListener("dragstart", (e) => {
        this._dragFromIndex = i;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
        row.classList.add("da-row-dragging");
      });
      indexBadge.addEventListener("dragend", () => row.classList.remove("da-row-dragging"));
      // The same move without a mouse: the arrow keys, with the handle kept in
      // hand so a floor can go several places in a row.
      indexBadge.tabIndex = 0;
      indexBadge.setAttribute("role", "button");
      indexBadge.setAttribute("aria-label", t("DAT.Importer.MoveAria", { name }));
      indexBadge.addEventListener("keydown", (e) => {
        const to = e.key === "ArrowUp" ? i + 1 : e.key === "ArrowDown" ? i - 1 : null;
        if (to === null || to < 0 || to >= this._floorPairs.length) return;
        e.preventDefault();
        this._reorderFloors(i, to);
        this.element?.querySelector(`.da-level-row[data-uid="${CSS.escape(pair.uid)}"] .da-level-index`)?.focus();
      });

      const thumb = _buildThumbEl(pair.media, "da-level-thumb", { animate: false });
      if (thumb.tagName === "VIDEO") this._thumbVideos.push(thumb);
      thumb.dataset.tooltip = pair.stem;   // the file name; its size is added once known
      if (this._mediaSizes.has(pair.uid)) this._applySizeBadge(pair, this._mediaSizes.get(pair.uid), thumb);

      // Pointing at a thumbnail shows it larger, and playing if it is a video.
      let levelTooltip = null;
      thumb.addEventListener("mouseenter", () => {
        levelTooltip = document.createElement("div");
        levelTooltip.className = "da-level-tooltip";
        levelTooltip.appendChild(_buildThumbEl(pair.media, "", { animate: true }));
        document.body.appendChild(levelTooltip);
        const rect = thumb.getBoundingClientRect();
        levelTooltip.style.left = `${rect.left + rect.width / 2}px`;
        levelTooltip.style.top  = `${rect.top - 8}px`;
      });
      thumb.addEventListener("mouseleave", () => {
        levelTooltip?.querySelector("video")?.pause();
        levelTooltip?.remove();
        levelTooltip = null;
      });

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.name = `levelName[${i}]`;
      nameInput.value = name;
      nameInput.placeholder = defaultName;
      nameInput.setAttribute("aria-label", t("DAT.Importer.ColName"));
      if (st?.nameEdited) nameInput.dataset.edited = "1";
      // A name typed by hand is kept when the street level moves; an emptied
      // one goes back to following it.
      nameInput.addEventListener("input", () => {
        if (nameInput.value.trim()) nameInput.dataset.edited = "1";
        else delete nameInput.dataset.edited;
      });

      const rangeText = document.createElement("span");
      rangeText.className = "da-level-range da-basic-col";
      rangeText.textContent = i === ground
        ? t("DAT.Importer.RangeStreet", { bottom, top })
        : t("DAT.Importer.Range", { bottom, top });

      const bottomInput = document.createElement("input");
      bottomInput.type = "number";
      bottomInput.name = `levelBottom[${i}]`;
      bottomInput.value = bottom;
      bottomInput.step = "1";
      bottomInput.className = "da-adv-col";
      bottomInput.setAttribute("aria-label", t("DAT.Importer.ColBottom"));

      const topInput = document.createElement("input");
      topInput.type = "number";
      topInput.name = `levelTop[${i}]`;
      topInput.value = top;
      topInput.step = "1";
      topInput.className = "da-adv-col";
      topInput.setAttribute("aria-label", t("DAT.Importer.ColTop"));

      const streetCell = pick("");
      const street = document.createElement("input");
      street.type = "radio";
      street.name = "streetLevel";
      street.value = pair.uid;
      street.checked = i === ground;
      street.setAttribute("aria-label", t("DAT.Importer.StreetAria", { name }));
      street.addEventListener("change", () => {
        if (!street.checked) return;
        this._captureRowState();
        this._groundUid = pair.uid;
        if (!this._startPicked) this._initialLevelUid = pair.uid;
        this._recomputeElevations();
        this._populateLevelsTab();
      });
      streetCell.appendChild(street);

      const roofCell = pick("da-adv-col");
      const roofCheckbox = document.createElement("input");
      roofCheckbox.type = "checkbox";
      roofCheckbox.name = `levelIsRoof[${i}]`;
      roofCheckbox.disabled = i === 0;
      // A choice already made is kept; otherwise a file named "roof" is ticked.
      roofCheckbox.checked = i > 0 && (st ? !!st.isRoof : isRoofName(pair.stem));
      roofCheckbox.setAttribute("aria-label", t("DAT.Importer.ColRoof"));
      roofCell.appendChild(roofCheckbox);

      const startCell = pick("da-adv-col");
      const start = document.createElement("input");
      start.type = "radio";
      start.name = "startFloor";
      start.value = pair.uid;
      start.checked = pair.uid === this._initialLevelUid;
      start.setAttribute("aria-label", t("DAT.Importer.ColStart"));
      start.addEventListener("change", () => {
        if (!start.checked) return;
        this._initialLevelUid = pair.uid;
        this._startPicked = true;
      });
      startCell.appendChild(start);

      row.append(indexBadge, thumb, nameInput, rangeText, bottomInput, topInput, streetCell, roofCell, startCell);
      list.appendChild(row);
    }

    // Every floor now has an entry in _levelState.
    this._captureRowState();
  }

  /** @override */
  async _onClose(options) {
    this._teardownThumbVideos();
    this._sizeAbort?.abort();
    document.querySelector(".da-door-tooltip")?.remove();
    const levelTooltip = document.querySelector(".da-level-tooltip");
    levelTooltip?.querySelector("video")?.pause();
    levelTooltip?.remove();
    return super._onClose(options);
  }

  static async #onImport(_event, _target) {
    if (!requireGM(t("DAT.Importer.GMOnly"))) return;
    if (this._importing) return;
    // The folder may be the top of the source (an empty path), so "floors were
    // found" is the test for being ready, not "there is a folder path".
    const folder = this._cwd ?? "";
    const source = this._source || "data";
    if (!this._floorPairs.length) {
      ui.notifications.warn(t("DAT.Importer.NoFolder"));
      return;
    }

    this._captureRowState();

    // Each floor's bottom must be below its top. A blank field falls back to a
    // default further on, so only fully numeric rows are checked.
    const names = this._defaultNames();
    const read = (i) => {
      const uid = this._floorPairs[i].uid;
      const st = this._levelState.get(uid) ?? {};
      return {
        name: (st.name ?? "").trim() || names.get(uid),
        bottom: parseFloat(st.bottom ?? ""),
        top: parseFloat(st.top ?? ""),
        isRoof: !!st.isRoof
      };
    };
    const levelOverrides = this._floorPairs.map((_, i) => read(i));
    const badLevels = levelOverrides
      .filter((o) => Number.isFinite(o.bottom) && Number.isFinite(o.top) && o.bottom >= o.top)
      .map((o) => o.name);
    if (badLevels.length) {
      ui.notifications.error(t("DAT.Importer.BadElevation", { levels: badLevels.join(", ") }));
      return;
    }

    const backgroundColor = this.element.querySelector("input[name='backgroundColor']")?.value || "#000000";
    const gridAlpha = parseFloat(this.element.querySelector("input[name='gridAlpha']")?.value ?? "0");
    const copyChecked = this.element.querySelector("input[name='copyImages']")?.checked ?? false;
    const doorTexture = this.element.querySelector("select[name='doorTexture']")?.value || "";
    const doorSound   = this.element.querySelector("select[name='doorSound']")?.value   || "";

    this._saveCurrentDefaults({ backgroundColor, gridAlpha, copyImages: copyChecked, doorTexture, doorSound });
    // A dropped folder was copied into the world on the way in.
    const copyImages = this._copied ? false : copyChecked;

    const initialLevelIndex = Math.max(0, this._floorPairs.findIndex((p) => p.uid === this._initialLevelUid));
    // The floors are passed in the order shown here. Left to browse the folder
    // again, importFolder would sort it its own way and put every name, height
    // and the start floor on the wrong floor after a reorder.
    const pairs = this._floorPairs;
    let scene;
    this._importing = true;
    this._renderBrowser();
    try {
      scene = await importFolder({ source, path: folder, bucket: this._bucket, pairs, backgroundColor, gridAlpha, copyImages, doorTexture, doorSound, levelOverrides, initialLevelIndex });
    } catch (err) {
      ui.notifications.error(t("DAT.Importer.ImportFailed", { error: err.message }));
      console.error(err);
      return;
    } finally {
      this._importing = false;
      this._renderBrowser();
    }
    if (!scene) return;
    this.close();
    // Show the new map and what is left to do on it. Neither is worth failing
    // the import over: the scene exists either way.
    try { await scene.view(); } catch (err) { console.warn("[DA Toolkit] could not open the new scene (non-fatal):", err); }
    try { game.modules.get(MODULE_ID)?.api?.open?.(); } catch (err) { console.warn("[DA Toolkit] could not open the Level Manager (non-fatal):", err); }
  }
}
