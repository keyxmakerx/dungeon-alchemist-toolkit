/**
 * Persistent on-canvas placement banner for the stairs/portal wizard.
 *
 * A plain DOM element (robust — no canvas/PIXI dependency) pinned over the board
 * with step text, an in-flow floor picker, and Back/Cancel buttons. Replaces the
 * transient `ui.notifications` toasts the old place-then-link flow used. Level
 * option labels are set via `textContent` (never innerHTML) so a DA-derived level
 * name can't inject markup.
 */

import { t } from "../util.js";

export class PlacementBanner {
  constructor() {
    /** @type {HTMLElement|null} */
    this.el = null;
    /** @type {(() => void)|null} */ this.onCancel = null;
    /** @type {(() => void)|null} */ this.onBack = null;
    /** @type {((levelId: string) => void)|null} */ this.onPickLevel = null;
  }

  /** Build and attach the banner. Safe to call once; no-ops if already mounted. */
  mount() {
    if (this.el) return;
    const el = document.createElement("div");
    el.className = "da-place-banner";
    el.innerHTML = `
      <div class="da-place-title"></div>
      <div class="da-place-hint"></div>
      <div class="da-place-row">
        <label class="da-place-level-label" hidden><span class="da-place-level-text"></span>
          <select class="da-place-level"></select>
        </label>
        <span class="da-place-spacer"></span>
        <button type="button" class="da-place-back" hidden>${t("DAT.Stairs.BtnBack")}</button>
        <button type="button" class="da-place-cancel">${t("DAT.Stairs.BtnCancel")}</button>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    el.querySelector(".da-place-cancel").addEventListener("click", () => this.onCancel?.());
    el.querySelector(".da-place-back").addEventListener("click", () => this.onBack?.());
    el.querySelector(".da-place-level").addEventListener("change", (e) => this.onPickLevel?.(e.target.value));
  }

  /**
   * Set the step title + hint line.
   * @param {string} title
   * @param {string} [hint]
   */
  setStep(title, hint = "") {
    if (!this.el) return;
    this.el.querySelector(".da-place-title").textContent = title;
    this.el.querySelector(".da-place-hint").textContent = hint;
  }

  /**
   * Populate and show the floor picker.
   * @param {object[]} levels      Levels (as from getSceneLevels), bottom-first.
   * @param {string} selectedId    Currently selected level _id.
   * @param {string} labelText     Picker label (e.g. "Entrance floor").
   */
  showLevelPicker(levels, selectedId, labelText) {
    if (!this.el) return;
    const label = this.el.querySelector(".da-place-level-label");
    const text = this.el.querySelector(".da-place-level-text");
    const select = this.el.querySelector(".da-place-level");
    text.textContent = labelText ? `${labelText}: ` : "";
    select.replaceChildren();
    for (const lv of levels) {
      const opt = document.createElement("option");
      opt.value = lv._id;
      const b = lv.elevation?.bottom ?? 0;
      const t = lv.elevation?.top ?? 0;
      opt.textContent = `${lv.name ?? "Level"} (elev ${b}–${t})`;
      if (lv._id === selectedId) opt.selected = true;
      select.appendChild(opt);
    }
    label.hidden = false;
  }

  /** Hide the floor picker. */
  hideLevelPicker() {
    if (!this.el) return;
    this.el.querySelector(".da-place-level-label").hidden = true;
  }

  /** Show/hide the Back button. */
  showBack(show) {
    if (!this.el) return;
    this.el.querySelector(".da-place-back").hidden = !show;
  }

  /** Remove the banner from the DOM. Idempotent. */
  destroy() {
    try { this.el?.remove(); } catch (_) { /* ignore */ }
    this.el = null;
  }
}
