import { importFolder, collectFloorPairs } from "./da-importer.js";
import { FLOOR_HEIGHT } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DAImporterDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {{stem:string, index:number, json:string, jpg:string}[]} */
  _floorPairs = [];
  /** Body-level dropdown elements that must be removed when the list is rebuilt or the dialog closes. */
  _visDropdowns = [];
  /** @type {Map<string, HTMLInputElement>} Keyed by "levelIndex,otherIndex" for fast lookup at import time. */
  _visCheckboxes = new Map();
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
        this._populateLevelsTab();
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
   * Wire the grid-alpha range input to its adjacent display span, set up tab
   * switching, and bind the door texture preview image.
   * Triggered by the ApplicationV2 _onRender lifecycle stage after each render.
   *
   * @param {ApplicationRenderContext} _context
   * @param {ApplicationRenderOptions} _options
   * @override
   */
  _onRender(_context, _options) {
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
        if (!Number.isFinite(h) || h < 1) return;
        this._floorPairs.forEach((_, i) => {
          const bInput = this.element.querySelector(`input[name="levelBottom[${i}]"]`);
          const tInput = this.element.querySelector(`input[name="levelTop[${i}]"]`);
          if (bInput) bInput.value = String(i === 0 ? 0 : i * h + 1);
          if (tInput) tInput.value = String((i + 1) * h);
        });
      });
    }

    // Restore levels tab rows after any re-render.
    this._populateLevelsTab();
  }

  /**
   * Remove all dropdown elements previously appended to document.body and clear checkbox refs.
   * Called before rebuilding the list and on dialog close.
   */
  _teardownVisDropdowns() {
    for (const d of this._visDropdowns) d.remove();
    this._visDropdowns = [];
    this._visCheckboxes.clear();
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
    for (const label of ["#", "", "Name", "Bottom", "Top", "Roof", "Visible"]) {
      const span = document.createElement("span");
      span.textContent = label;
      header.appendChild(span);
    }
    list.appendChild(header);

    // First pass — build every row; capture nameInputs for the dropdown labels below.
    const rowData = [];
    for (let i = 0; i < this._floorPairs.length; i++) {
      const pair = this._floorPairs[i];
      const defaultBottom = i === 0 ? 0 : i * FLOOR_HEIGHT + 1;
      const defaultTop = (i + 1) * FLOOR_HEIGHT;

      const row = document.createElement("div");
      row.className = "da-level-row";

      const indexBadge = document.createElement("span");
      indexBadge.className = "da-level-index";
      indexBadge.textContent = String(i);

      const thumb = document.createElement("img");
      thumb.className = "da-level-thumb";
      thumb.src = pair.jpg;
      thumb.alt = "";

      // Hover tooltip — shows an enlarged version of the level image
      let levelTooltip = null;
      thumb.addEventListener("mouseenter", () => {
        levelTooltip = document.createElement("div");
        levelTooltip.className = "da-level-tooltip";
        const tooltipImg = document.createElement("img");
        tooltipImg.src = pair.jpg;
        levelTooltip.appendChild(tooltipImg);
        document.body.appendChild(levelTooltip);
        const rect = thumb.getBoundingClientRect();
        levelTooltip.style.left = `${rect.left + rect.width / 2}px`;
        levelTooltip.style.top  = `${rect.top - 8}px`;
      });
      thumb.addEventListener("mouseleave", () => {
        levelTooltip?.remove();
        levelTooltip = null;
      });

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.name = `levelName[${i}]`;
      nameInput.value = `Floor ${i}`;
      nameInput.placeholder = "Level name";

      const bottomInput = document.createElement("input");
      bottomInput.type = "number";
      bottomInput.name = `levelBottom[${i}]`;
      bottomInput.value = String(defaultBottom);
      bottomInput.min = "0";
      bottomInput.step = "1";

      const topInput = document.createElement("input");
      topInput.type = "number";
      topInput.name = `levelTop[${i}]`;
      topInput.value = String(defaultTop);
      topInput.min = "0";
      topInput.step = "1";

      // Roof toggle
      const roofLabel = document.createElement("label");
      roofLabel.className = "da-toggle";
      roofLabel.title = "When enabled, this level only renders when the level directly below it is active (roof behavior).";

      const roofCheckbox = document.createElement("input");
      roofCheckbox.type = "checkbox";
      roofCheckbox.name = `levelIsRoof[${i}]`;

      const roofTrack = document.createElement("span");
      roofTrack.className = "da-toggle-track";
      const roofThumb = document.createElement("span");
      roofThumb.className = "da-toggle-thumb";
      roofTrack.appendChild(roofThumb);
      roofLabel.append(roofCheckbox, roofTrack);

      row.append(indexBadge, thumb, nameInput, bottomInput, topInput, roofLabel);
      list.appendChild(row);
      rowData.push({ row, nameInput, index: i });
    }

    // Second pass — attach a Visible Levels dropdown to each row.
    // Dropdowns are appended directly to document.body so that position:fixed
    // coordinates are always viewport-relative, bypassing Foundry's window transform.
    for (let i = 0; i < rowData.length; i++) {
      const { row } = rowData[i];

      const wrap = document.createElement("div");
      wrap.className = "da-vis-wrap";

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
          btn.title = "";
        } else if (indices.length === 1) {
          btn.textContent = `${indices[0]} ▾`;
          btn.title = indices[0];
        } else {
          btn.textContent = "Many ▾";
          btn.title = indices.join(", ");
        }
      };
      updateBtn();
      dropdown.addEventListener("change", updateBtn);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasHidden = dropdown.hidden;
        // Close all dropdowns, then open this one if it was closed.
        this._visDropdowns.forEach(d => { d.hidden = true; });
        if (wasHidden) {
          const rect = btn.getBoundingClientRect();
          dropdown.style.top = `${rect.bottom + 2}px`;
          dropdown.style.left = `${rect.left}px`;
          dropdown.hidden = false;
          // Deferred outside-click handler so this very click doesn't close it immediately.
          setTimeout(() => {
            const closeOnOutside = (ev) => {
              if (!dropdown.contains(ev.target) && ev.target !== btn) {
                dropdown.hidden = true;
                document.removeEventListener("click", closeOnOutside);
              }
            };
            document.addEventListener("click", closeOnOutside);
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
    document.querySelector(".da-door-tooltip")?.remove();
    document.querySelector(".da-level-tooltip")?.remove();
    return super._onClose(options);
  }

  static async #onImport(_event, _target) {
    const folder = this.element.querySelector("input[name='folder']")?.value?.trim();
    const source = this.element.querySelector("input[name='source']")?.value?.trim() || "data";
    if (!folder) {
      ui.notifications.warn("Please select a folder first.");
      return;
    }

    const backgroundColor = this.element.querySelector("input[name='backgroundColor']")?.value || "#000000";
    const gridAlpha = parseFloat(this.element.querySelector("input[name='gridAlpha']")?.value ?? "0");
    const copyImages = this.element.querySelector("input[name='copyImages']")?.checked ?? false;
    const doorTexture = this.element.querySelector("select[name='doorTexture']")?.value || "";
    const doorSound   = this.element.querySelector("select[name='doorSound']")?.value   || "";

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

    const scene = await importFolder({ source, path: folder, backgroundColor, gridAlpha, copyImages, doorTexture, doorSound, levelOverrides });
    if (scene) this.close();
  }
}
