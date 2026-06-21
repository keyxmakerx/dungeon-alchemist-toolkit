import { importFolder, collectFloorPairs, isVideoPath } from "./da-importer.js";
import { FLOOR_HEIGHT, MODULE_ID, SETTING_IMPORTER_DEFAULTS, MEDIA_SIZE_WARN_BYTES } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Build a thumbnail element for a floor's background media path.
 *
 * Video backgrounds (webm/mp4/m4v) use a muted, looping, inline <video>; still
 * images use a plain <img>. Pass `animate:true` to autoplay the video (used for
 * the enlarged hover preview); the default leaves it paused on its first frame
 * (`preload:"metadata"`) so a column of many floors doesn't run N decoders at
 * once. A load/decode error tags the element `da-thumb-error` and warns.
 *
 * @param {string} src                    Media path/URL.
 * @param {string} className              Class to apply (empty = none).
 * @param {object} [opts]
 * @param {boolean} [opts.animate=false]  Autoplay video (vs. paused first frame).
 * @returns {HTMLImageElement|HTMLVideoElement}
 */
function _buildThumbEl(src, className, { animate = false } = {}) {
  const isVideo = isVideoPath(src);
  const el = document.createElement(isVideo ? "video" : "img");
  if (className) el.className = className;
  el.addEventListener("error", () => {
    el.classList.add("da-thumb-error");
    console.warn(`[DA Importer] could not load thumbnail media: ${src}`);
  });
  if (isVideo) {
    el.muted = true;
    el.loop = true;
    el.playsInline = true;
    el.autoplay = animate;
    el.preload = animate ? "auto" : "metadata";
  } else {
    el.alt = "";
  }
  el.src = src;
  return el;
}

export class DAImporterDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {{stem:string, index:number, json:string, media:string}[]} */
  _floorPairs = [];
  /** Body-level dropdown elements that must be removed when the list is rebuilt or the dialog closes. */
  _visDropdowns = [];
  /** @type {Map<string, HTMLInputElement>} Keyed by "levelIndex,otherIndex" for fast lookup at import time. */
  _visCheckboxes = new Map();
  /** Levels-tab video thumbnails currently mounted; paused/released on rebuild and close. */
  _thumbVideos = [];
  /** The single active document-level "click outside to close" handler for the Visible Levels dropdowns. */
  _visOutsideHandler = null;
  /** Stable id (uid) of the level shown on scene load; null until a folder is browsed. */
  _initialLevelUid = null;
  /** @type {Map<string, {name:string,bottom:string,top:string,isRoof:boolean,visible:Set<string>}>} Per-floor editable state keyed by uid, so edits survive row rebuilds and reordering. */
  _levelState = new Map();
  /** Source row index during an in-progress drag-to-reorder; null when not dragging. */
  _dragFromIndex = null;
  /** Guards one-time restore of persisted dialog selections (applied on first render). */
  _restoredDefaults = false;
  /** @type {Map<string, number>} Probed media sizes (bytes) keyed by floor uid; re-applied to rows on render. */
  _mediaSizes = new Map();
  /** Monotonic token so a stale size-probe batch can't patch rows after a newer browse. */
  _sizeProbeGen = 0;
  /** AbortController for the in-flight size-probe batch (aborted on re-browse / close). */
  _sizeAbort = null;
  /** Levels-tab "Show advanced columns" state (Roof / Start / Visible); persisted across re-renders. */
  _advancedView = false;
  static DEFAULT_OPTIONS = {
    id: "da-importer",
    tag: "form",
    form: {
      closeOnSubmit: false
    },
    window: {
      title: "Dungeon Alchemist Level Importer",
      resizable: false
    },
    position: {
      width: 620,
      height: "auto"
    },
    actions: {
      browse: DAImporterDialog.#onBrowse,
      import: DAImporterDialog.#onImport,
      previewSound: DAImporterDialog.#onPreviewSound
    }
  };

  static PARTS = {
    form: {
      template: "modules/da-level-importer/templates/importer.hbs"
    }
  };

  static async #onBrowse(_event, _target) {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    const picker = new FilePicker({
      type: "folder",
      current: "",
      callback: async (path) => {
        const folderInput = this.element.querySelector("input[name='folder']");
        const sourceInput = this.element.querySelector("input[name='source']");
        if (folderInput) folderInput.value = path;
        const source = picker.activeSource ?? "data";
        if (sourceInput) sourceInput.value = source;

        // Browse the folder so the Levels tab can show per-level rows.
        try {
          const listing = await FilePicker.browse(source, path);
          this._floorPairs = collectFloorPairs(listing.files);
        } catch (_err) {
          this._floorPairs = [];
        }
        // Fresh folder: give each floor a stable uid (so its edits and order can
        // follow it), and reset per-floor state, the initial level, and sizes.
        for (const p of this._floorPairs) p.uid = foundry.utils.randomID();
        this._levelState = new Map();
        this._initialLevelUid = this._floorPairs[0]?.uid ?? null;
        this._mediaSizes = new Map();
        this._populateLevelsTab();
        this._probeMediaSizes(source);
      }
    });
    await picker.browse("");
  }

  /**
   * Plays the "open" sound for the currently selected door sound key as a preview.
   * Resolves the sound file path via CONFIG.Wall.doorSounds, which maps string keys
   * to their associated audio file paths in Foundry v14.
   *
   * Triggered by the ApplicationV2 action system on renderDAImporterDialog.
   *
   * @param {PointerEvent} _event
   * @param {HTMLElement} _target
   */
  static async #onPreviewSound(_event, _target) {
    const soundKey = this.element.querySelector("select[name='doorSound']")?.value;
    if (!soundKey) return;
    const soundConfig = CONFIG.Wall.doorSounds?.[soundKey];
    if (!soundConfig) return;
    const src = soundConfig.open ?? soundConfig.close;
    if (src) foundry.audio.AudioHelper.play({ src, volume: 1 });
  }

  /**
   * Restore the dialog's persisted selections (door texture/sound, scene colors,
   * copy toggle) remembered per client across opens, so the user doesn't
   * reconfigure them every import. Applied once on first render; the guard keeps
   * later re-renders from clobbering in-progress edits.
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

  /** Persist the dialog's current scene/door selections for the next open. */
  _saveCurrentDefaults({ backgroundColor, gridAlpha, copyImages, doorTexture, doorSound }) {
    try {
      game.settings.set(MODULE_ID, SETTING_IMPORTER_DEFAULTS, {
        backgroundColor, gridAlpha, copyImages, doorTexture, doorSound
      });
    } catch (_) { /* setting unavailable — non-fatal */ }
  }

  /**
   * Wire the grid-alpha range input to its adjacent display span, set up tab
   * switching, and bind the door texture preview image.
   * Triggered by the ApplicationV2 _onRender lifecycle stage after each render.
   *
   * @param {ApplicationRenderContext} _context
   * @param {ApplicationRenderOptions} _options
   * @override
   */
  _onRender(_context, _options) {
    // Restore persisted selections before wiring inputs, so the range display
    // and door preview below reflect the restored values.
    this._restoreSavedDefaults();

    // Range slider display sync
    const range = this.element.querySelector("input[name='gridAlpha']");
    const display = this.element.querySelector(".range-value");
    if (range && display) {
      display.textContent = parseFloat(range.value).toFixed(2);
      range.addEventListener("input", () => {
        display.textContent = parseFloat(range.value).toFixed(2);
      });
    }

    // Tab switching
    const tabBtns = this.element.querySelectorAll(".da-tab-btn");
    const tabPanels = this.element.querySelectorAll(".da-tab-panel");
    for (const btn of tabBtns) {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        for (const b of tabBtns) {
          b.classList.toggle("da-tab-btn--active", b.dataset.tab === target);
          b.setAttribute("aria-selected", String(b.dataset.tab === target));
        }
        for (const panel of tabPanels) {
          panel.classList.toggle("da-tab-panel--hidden", panel.dataset.tab !== target);
        }
      });
    }

    // Door texture image preview — updates whenever the select changes
    const doorSelect = this.element.querySelector("select[name='doorTexture']");
    const doorPreview = this.element.querySelector(".da-door-preview");
    if (doorSelect && doorPreview) {
      const syncPreview = () => {
        doorPreview.src = doorSelect.value;
        doorPreview.hidden = !doorSelect.value;
      };
      syncPreview();
      doorSelect.addEventListener("change", syncPreview);

      // Hover tooltip — shows an enlarged version of the preview image
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

    // Uniform floor-height field — when changed, recalculates all per-level inputs.
    const uniformInput = this.element.querySelector("input[name='uniformFloorHeight']");
    if (uniformInput) {
      uniformInput.addEventListener("change", () => {
        const h = parseInt(uniformInput.value, 10);
        if (!Number.isFinite(h) || h < 1 || !this._floorPairs.length) return;
        // Preserve names/roof/visible; restack all elevations to the new height.
        this._captureRowState();
        this._recomputeElevations();
        this._populateLevelsTab();
      });
    }

    // Basic / Advanced columns toggle for the Levels tab. The advanced cells stay
    // in the DOM when hidden (CSS display:none), so import still reads them.
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

    // Info (ⓘ) button — toggles a readable help panel explaining the advanced columns.
    const advHelpBtn = this.element.querySelector(".da-info-icon");
    const advHelp = this.element.querySelector(".da-adv-help");
    if (advHelpBtn && advHelp) {
      advHelpBtn.addEventListener("click", () => { advHelp.hidden = !advHelp.hidden; });
    }

    // Restore levels tab rows after any re-render.
    this._populateLevelsTab();
  }

  /**
   * Remove all dropdown elements previously appended to document.body, drop the
   * active outside-click handler, and clear checkbox refs. Called before
   * rebuilding the list and on dialog close.
   */
  _teardownVisDropdowns() {
    this._removeVisOutsideHandler();
    for (const d of this._visDropdowns) d.remove();
    this._visDropdowns = [];
    this._visCheckboxes.clear();
  }

  /** Remove the active "click outside to close" handler for the Visible Levels dropdowns, if any. */
  _removeVisOutsideHandler() {
    if (this._visOutsideHandler) {
      document.removeEventListener("click", this._visOutsideHandler);
      this._visOutsideHandler = null;
    }
  }

  /**
   * Pause and release every Levels-tab video thumbnail. Called before the list
   * is rebuilt (innerHTML = "") and on close so detached <video> elements stop
   * decoding instead of lingering until GC.
   */
  _teardownThumbVideos() {
    for (const v of this._thumbVideos) {
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch (_) { /* ignore */ }
    }
    this._thumbVideos = [];
  }

  /**
   * Probe each floor's media size via a HEAD request (Content-Length) and flag
   * oversized floors in the Levels tab. Security/robustness measures:
   * - Only LOCAL Foundry sources ("data"/"public") are probed; remote/absolute
   *   URLs (e.g. S3) are skipped to avoid issuing cross-origin requests / leaking
   *   the GM's address to arbitrary hosts.
   * - `credentials:"omit"`, an AbortController timeout, and a per-browse
   *   generation token so a slow or stale batch can neither hang the UI nor patch
   *   rows from a newer folder selection.
   * - Any failure (CORS, 405, missing Content-Length, network) is swallowed and
   *   treated as "size unknown" — never warns, never blocks import.
   *
   * @param {string} source  FilePicker source the folder was browsed from.
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
    await Promise.all(this._floorPairs.map(async (pair, i) => {
      try {
        const res = await fetch(pair.media, { method: "HEAD", credentials: "omit", cache: "no-store", signal: controller.signal });
        const len = res.ok ? res.headers.get("content-length") : null;
        const bytes = len ? parseInt(len, 10) : NaN;
        if (!Number.isFinite(bytes)) return;
        if (gen !== this._sizeProbeGen) return; // superseded by a newer browse
        this._mediaSizes.set(pair.uid, bytes);
        this._applySizeBadge(pair, bytes);
        if (bytes >= MEDIA_SIZE_WARN_BYTES) oversize.push(i);
      } catch (_) { /* unknown size — no warning */ }
    }));
    clearTimeout(timer);

    if (gen === this._sizeProbeGen && oversize.length) {
      const list = oversize.sort((a, b) => a - b).join(", ");
      ui.notifications.warn(`DA Importer: ${oversize.length} floor(s) exceed ~50 MB (floor ${list}). Large videos slow scene loads; consider importing referenced-in-place (Copy Media off).`);
    }
  }

  /**
   * Mark a floor's thumbnail with its size; oversized media (≥ the recommended
   * limit) gets a warning outline. Inserts only via attributes/`textContent`-safe
   * channels (no innerHTML). Accepts an optional `thumbEl` for the build-time
   * call (the row isn't in the DOM yet); otherwise looks the thumb up by index.
   *
   * @param {{uid:string,stem:string}} pair
   * @param {number} bytes
   * @param {HTMLElement} [thumbEl]
   */
  _applySizeBadge(pair, bytes, thumbEl) {
    const thumb = thumbEl ?? this.element?.querySelector(`.da-level-row[data-uid="${pair.uid}"] .da-level-thumb`);
    if (!thumb) return;
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    if (bytes >= MEDIA_SIZE_WARN_BYTES) {
      thumb.classList.add("da-thumb-oversize");
      thumb.dataset.tooltip = `${pair.stem} — ${mb} MB (exceeds Foundry's ~50 MB recommendation)`;
    } else {
      thumb.classList.remove("da-thumb-oversize");
      thumb.dataset.tooltip = `${pair.stem} — ${mb} MB`;
    }
  }

  /**
   * Snapshot the current Levels-tab edits (name, bottom, top, roof, and the set
   * of visible levels — by uid) into this._levelState, keyed by each floor's
   * stable uid, so values follow their floor rather than the row position. Run
   * before any rebuild that must preserve edits (reorder, floor-height change).
   */
  _captureRowState() {
    if (!this.element) return;
    for (let i = 0; i < this._floorPairs.length; i++) {
      const uid = this._floorPairs[i].uid;
      const visible = new Set();
      for (let j = 0; j < this._floorPairs.length; j++) {
        if (j === i) continue;
        if (this._visCheckboxes.get(`${i},${j}`)?.checked) visible.add(this._floorPairs[j].uid);
      }
      this._levelState.set(uid, {
        name:   this.element.querySelector(`input[name="levelName[${i}]"]`)?.value ?? "",
        bottom: this.element.querySelector(`input[name="levelBottom[${i}]"]`)?.value ?? "",
        top:    this.element.querySelector(`input[name="levelTop[${i}]"]`)?.value ?? "",
        isRoof: this.element.querySelector(`input[name="levelIsRoof[${i}]"]`)?.checked ?? false,
        visible
      });
    }
  }

  /**
   * Restack every floor's bottom/top in this._levelState to the default range for
   * its current position, using the uniform Floor Height field. Names/roof/visible
   * are left untouched. Used after a reorder or a floor-height change.
   */
  _recomputeElevations() {
    const h = parseInt(this.element?.querySelector("input[name='uniformFloorHeight']")?.value ?? "", 10);
    const height = Number.isFinite(h) && h >= 1 ? h : FLOOR_HEIGHT;
    this._floorPairs.forEach((pair, i) => {
      const st = this._levelState.get(pair.uid) ?? { name: pair.stem, isRoof: false, visible: new Set() };
      st.bottom = String(i === 0 ? 0 : i * height + 1);
      st.top = String((i + 1) * height);
      this._levelState.set(pair.uid, st);
    });
  }

  /**
   * Move a floor from index `from` to index `to` (drag-to-reorder): capture edits
   * (so they follow each floor), reorder, restack elevations to the new order,
   * then rebuild. Names, roof, start, and visible selections are preserved; only
   * Bottom/Top recompute.
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

  /**
   * Rebuild the Levels tab rows from this._floorPairs.
   * Called after folder selection and after each render.
   * Shows a placeholder when no folder has been selected yet.
   *
   * A second pass wires up each row's Visible Levels dropdown after all rows
   * exist, so each dropdown can list every other level by name.
   * Dropdowns are appended to document.body to avoid Foundry's window CSS transform
   * containing position:fixed elements at the wrong viewport coordinates.
   */
  _populateLevelsTab() {
    this._teardownVisDropdowns();
    this._teardownThumbVideos();

    const placeholder = this.element?.querySelector(".da-levels-placeholder");
    const list = this.element?.querySelector(".da-levels-list");
    if (!list) return;

    if (!this._floorPairs.length) {
      if (placeholder) placeholder.hidden = false;
      list.innerHTML = "";
      return;
    }

    if (placeholder) placeholder.hidden = true;
    list.innerHTML = "";

    // Header row
    const header = document.createElement("div");
    header.className = "da-levels-header";
    const headerCols = [
      { label: "#",       title: "Floor order (0 = bottom-most). Drag the number to reorder." },
      { label: "",        title: "Map preview — hover for the original filename and size" },
      { label: "Name",    title: "Level name — pre-filled from the original filename, editable" },
      { label: "Bottom",  title: "Lower elevation of this floor, in grid units" },
      { label: "Top",     title: "Upper elevation of this floor, in grid units" },
      { label: "Roof",    title: "Show this level only when the floor directly below is active (ceilings/roofs)", adv: true },
      { label: "Start",   title: "Which floor is shown when the scene first loads", adv: true },
      { label: "Visible", title: "Which other floors stay visible while this one is active", adv: true }
    ];
    for (const col of headerCols) {
      const span = document.createElement("span");
      span.textContent = col.label;
      span.dataset.tooltip = col.title;
      if (col.adv) span.classList.add("da-adv-col");
      header.appendChild(span);
    }
    list.appendChild(header);

    // First pass — build every row; capture nameInputs for the dropdown labels below.
    const rowData = [];
    for (let i = 0; i < this._floorPairs.length; i++) {
      const pair = this._floorPairs[i];
      const st = this._levelState.get(pair.uid);
      const defaultBottom = i === 0 ? 0 : i * FLOOR_HEIGHT + 1;
      const defaultTop = (i + 1) * FLOOR_HEIGHT;

      const row = document.createElement("div");
      row.className = "da-level-row";
      row.dataset.levelIndex = String(i);
      row.dataset.uid = pair.uid;
      // Drag-to-reorder: the # cell is the handle; the whole row is a drop target.
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
      indexBadge.textContent = String(i);
      indexBadge.draggable = true;
      indexBadge.dataset.tooltip = "Drag to reorder this floor";
      indexBadge.addEventListener("dragstart", (e) => {
        this._dragFromIndex = i;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
        row.classList.add("da-row-dragging");
      });
      indexBadge.addEventListener("dragend", () => row.classList.remove("da-row-dragging"));

      const thumb = _buildThumbEl(pair.media, "da-level-thumb", { animate: false });
      if (thumb.tagName === "VIDEO") this._thumbVideos.push(thumb);
      thumb.dataset.tooltip = pair.stem;   // original filename (size is appended once probed)
      // Re-apply a previously probed size badge (rows are rebuilt on every render).
      if (this._mediaSizes.has(pair.uid)) this._applySizeBadge(pair, this._mediaSizes.get(pair.uid), thumb);

      // Hover tooltip — shows an enlarged, animated version of the level media
      let levelTooltip = null;
      thumb.addEventListener("mouseenter", () => {
        levelTooltip = document.createElement("div");
        levelTooltip.className = "da-level-tooltip";
        const tooltipMedia = _buildThumbEl(pair.media, "", { animate: true });
        levelTooltip.appendChild(tooltipMedia);
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
      nameInput.value = st ? st.name : pair.stem;   // preserved edit, else the original filename
      nameInput.placeholder = `Floor ${i}`;

      const bottomInput = document.createElement("input");
      bottomInput.type = "number";
      bottomInput.name = `levelBottom[${i}]`;
      bottomInput.value = st ? st.bottom : String(defaultBottom);
      bottomInput.min = "0";
      bottomInput.step = "1";

      const topInput = document.createElement("input");
      topInput.type = "number";
      topInput.name = `levelTop[${i}]`;
      topInput.value = st ? st.top : String(defaultTop);
      topInput.min = "0";
      topInput.step = "1";

      // Roof toggle
      const roofLabel = document.createElement("label");
      roofLabel.className = "da-toggle da-adv-col";
      roofLabel.dataset.tooltip = "Tick only if this floor is a roof/ceiling over the floor below; it then shows only when that lower floor is active. Most maps need this off.";

      const roofCheckbox = document.createElement("input");
      roofCheckbox.type = "checkbox";
      roofCheckbox.name = `levelIsRoof[${i}]`;
      roofCheckbox.checked = st?.isRoof ?? false;

      const roofTrack = document.createElement("span");
      roofTrack.className = "da-toggle-track";
      const roofThumb = document.createElement("span");
      roofThumb.className = "da-toggle-thumb";
      roofTrack.appendChild(roofThumb);
      roofLabel.append(roofCheckbox, roofTrack);

      // Initial level toggle — radio-style: only one row may be active at a time.
      const initBtn = document.createElement("button");
      initBtn.type = "button";
      initBtn.className = "da-initial-btn da-adv-col";
      initBtn.dataset.uid = pair.uid;
      initBtn.dataset.tooltip = "Set as initial level (shown on scene load)";
      const isInitial = pair.uid === this._initialLevelUid;
      initBtn.textContent = isInitial ? "★" : "☆";
      if (isInitial) initBtn.classList.add("da-initial-btn--active");

      row.append(indexBadge, thumb, nameInput, bottomInput, topInput, roofLabel, initBtn);
      list.appendChild(row);
      rowData.push({ row, nameInput, index: i });
    }

    // Wire initial-level toggles — clicking one star deactivates all others.
    const allInitBtns = [...list.querySelectorAll(".da-initial-btn")];
    for (const btn of allInitBtns) {
      btn.addEventListener("click", () => {
        const uid = btn.dataset.uid;
        this._initialLevelUid = uid;
        for (const b of allInitBtns) {
          const active = b.dataset.uid === uid;
          b.textContent = active ? "★" : "☆";
          b.classList.toggle("da-initial-btn--active", active);
        }
      });
    }

    // Second pass — attach a Visible Levels dropdown to each row.
    // Dropdowns are appended directly to document.body so that position:fixed
    // coordinates are always viewport-relative, bypassing Foundry's window transform.
    for (let i = 0; i < rowData.length; i++) {
      const { row } = rowData[i];
      const stI = this._levelState.get(this._floorPairs[i].uid);

      const wrap = document.createElement("div");
      wrap.className = "da-vis-wrap da-adv-col";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "da-vis-btn";

      const dropdown = document.createElement("div");
      dropdown.className = "da-vis-dropdown";
      dropdown.hidden = true;
      document.body.appendChild(dropdown);
      this._visDropdowns.push(dropdown);

      for (let j = 0; j < rowData.length; j++) {
        if (j === i) continue;
        const optLabel = document.createElement("label");
        optLabel.className = "da-vis-option";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = `levelVisibility[${i}][${j}]`;
        cb.dataset.levelIndex = String(j);
        cb.checked = !!stI?.visible?.has(this._floorPairs[j].uid);
        this._visCheckboxes.set(`${i},${j}`, cb);
        optLabel.append(cb, ` ${rowData[j].nameInput.value || `Floor ${j}`}`);
        dropdown.appendChild(optLabel);
      }

      // Render the button label as the comma-separated list of selected level
      // indices (the field number, not its name) so multi-selection stays legible.
      // Label shows the single selected level number, or a "Many" marker when
      // multiple are selected (the full list stays available via the hover tooltip).
      const updateBtn = () => {
        const indices = [...dropdown.querySelectorAll("input:checked")]
          .map(cb => cb.dataset.levelIndex);
        if (indices.length === 0) {
          btn.textContent = "— ▾";
          btn.dataset.tooltip = "";
        } else if (indices.length === 1) {
          btn.textContent = `${indices[0]} ▾`;
          btn.dataset.tooltip = `Also shows floor ${indices[0]}`;
        } else {
          btn.textContent = "Many ▾";
          btn.dataset.tooltip = `Also shows floors ${indices.join(", ")}`;
        }
      };
      updateBtn();
      dropdown.addEventListener("change", updateBtn);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasHidden = dropdown.hidden;
        // Close all dropdowns (and drop any prior outside-click handler), then
        // open this one if it was closed.
        this._visDropdowns.forEach(d => { d.hidden = true; });
        this._removeVisOutsideHandler();
        if (wasHidden) {
          const rect = btn.getBoundingClientRect();
          dropdown.style.top = `${rect.bottom + 2}px`;
          dropdown.style.left = `${rect.left}px`;
          dropdown.hidden = false;
          // Deferred outside-click handler so this very click doesn't close it
          // immediately; tracked on the instance so it is never left dangling.
          setTimeout(() => {
            this._visOutsideHandler = (ev) => {
              if (!dropdown.contains(ev.target) && ev.target !== btn) {
                dropdown.hidden = true;
                this._removeVisOutsideHandler();
              }
            };
            document.addEventListener("click", this._visOutsideHandler);
          }, 0);
        }
      });

      wrap.appendChild(btn);
      row.appendChild(wrap);
    }
  }

  /**
   * Remove any lingering door texture tooltip when the dialog closes.
   * Guards against the edge case where the mouse is over the preview at close time.
   *
   * @param {ApplicationCloseOptions} options
   * @override
   */
  async _onClose(options) {
    this._teardownVisDropdowns();
    this._teardownThumbVideos();
    this._sizeAbort?.abort();
    document.querySelector(".da-door-tooltip")?.remove();
    const levelTooltip = document.querySelector(".da-level-tooltip");
    levelTooltip?.querySelector("video")?.pause();
    levelTooltip?.remove();
    return super._onClose(options);
  }

  static async #onImport(_event, _target) {
    const folder = this.element.querySelector("input[name='folder']")?.value?.trim();
    const source = this.element.querySelector("input[name='source']")?.value?.trim() || "data";
    if (!folder) {
      ui.notifications.warn("Please select a folder first.");
      return;
    }

    // Validate elevation ranges first: each level's bottom must be below its top.
    // Only fully-numeric rows are checked — a blank field falls back to a computed
    // default downstream (always valid), so it must not be flagged here.
    const badLevels = [];
    for (let i = 0; i < this._floorPairs.length; i++) {
      const b = parseInt(this.element.querySelector(`input[name="levelBottom[${i}]"]`)?.value ?? "", 10);
      const t = parseInt(this.element.querySelector(`input[name="levelTop[${i}]"]`)?.value ?? "", 10);
      if (Number.isFinite(b) && Number.isFinite(t) && b >= t) badLevels.push(i);
    }
    if (badLevels.length) {
      ui.notifications.error(`DA Importer: level(s) ${badLevels.join(", ")} have bottom ≥ top. Fix the elevation values before importing.`);
      return;
    }

    const backgroundColor = this.element.querySelector("input[name='backgroundColor']")?.value || "#000000";
    const gridAlpha = parseFloat(this.element.querySelector("input[name='gridAlpha']")?.value ?? "0");
    const copyImages = this.element.querySelector("input[name='copyImages']")?.checked ?? false;
    const doorTexture = this.element.querySelector("select[name='doorTexture']")?.value || "";
    const doorSound   = this.element.querySelector("select[name='doorSound']")?.value   || "";

    // Remember these selections for the next time the dialog is opened.
    this._saveCurrentDefaults({ backgroundColor, gridAlpha, copyImages, doorTexture, doorSound });

    const levelOverrides = this._floorPairs.map((_, i) => ({
      name:   this.element.querySelector(`input[name="levelName[${i}]"]`)?.value?.trim() || `Floor ${i}`,
      bottom: parseInt(this.element.querySelector(`input[name="levelBottom[${i}]"]`)?.value ?? "", 10),
      top:    parseInt(this.element.querySelector(`input[name="levelTop[${i}]"]`)?.value ?? "", 10),
      isRoof: this.element.querySelector(`input[name="levelIsRoof[${i}]"]`)?.checked ?? false,
      visibleLevels: this._floorPairs
        .map((_, j) => {
          if (j === i) return null;
          return this._visCheckboxes.get(`${i},${j}`)?.checked ? j : null;
        })
        .filter(j => j !== null)
    }));

    const initialLevelIndex = Math.max(0, this._floorPairs.findIndex(p => p.uid === this._initialLevelUid));
    const scene = await importFolder({ source, path: folder, backgroundColor, gridAlpha, copyImages, doorTexture, doorSound, levelOverrides, initialLevelIndex });
    if (scene) this.close();
  }
}
