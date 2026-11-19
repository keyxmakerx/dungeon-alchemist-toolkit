/**
 * DA Level Manager — the toolkit's home window (ApplicationV2).
 *
 * Floors tab: the building from the side. Floors are a stack, top floor first,
 * and each stair is a bar beside the stack spanning the floors it joins, so a
 * floor nobody can reach is visible at a glance. The selected floor's actions
 * sit underneath and save as they are made.
 *
 * Stairs tab: the one list of every stair, teleport and trap on the scene.
 *
 * It manages the scene on the canvas, or a scene it was opened for from the
 * Scenes list. Everything is read from native data (`scene.levels`,
 * portal-flagged Regions); there is no second copy of it.
 */

import { MODULE_ID, TODO_FLAG } from "./constants.js";
import { requireGM, t } from "./util.js";
import { getSceneLevels, getCurrentLevelId, getInitialLevelId, viewLevel } from "./levels.js";
import { getPortalLinkGroups, getScenePortals, getRegionBehaviors, deletePortalLink, bindPortals, regionCenter, regionLevelId, regionLevelIds, adoptLegacyRegion, LEGACY_LINK_PREFIX } from "./portal/portal-core.js";
import { updateLevel, setStartLevel, moveLevel, openNativeLevels, replaceLevelImage, addLevel, removeLevel } from "./scene-levels-edit.js";
import { assignLanes, unreachableFloors, hasCrossFloorStairs } from "./building.js";
import { safeDecode } from "./floor-grouping.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The kind of a stair, in words. */
function kindWord(mode) {
  return t(`DAT.Stairs.Kind.${["stairs", "teleport", "trap"].includes(mode) ? mode : "stairs"}`);
}

/**
 * Everything the window shows about one stair link.
 *
 * @param {string} linkId
 * @param {{region:RegionDocument, portal:object, legacy?:boolean}[]} entries
 * @param {object[]} levelsAsc  The scene's floors, bottom-first.
 */
function describeLink(linkId, entries, levelsAsc) {
  const indexOf = (id) => levelsAsc.findIndex((l) => l._id === id);
  const first = entries[0]?.portal ?? {};
  const legacy = entries[0]?.legacy ?? false;
  const mode = first.mode || "stairs";
  // Entrance first, so a one-way stair reads in the direction it travels.
  const ordered = entries.slice().sort((a, b) =>
    Number(b.portal?.role === "entrance") - Number(a.portal?.role === "entrance"));
  // A stair made with the old tool is one Region on several floors.
  const solo = entries.length === 1 && regionLevelIds(entries[0].region).length > 1;
  const ends = solo
    ? regionLevelIds(entries[0].region).map((levelId) => ({ regionId: entries[0].region.id, levelId }))
    : ordered.map((e) => ({ regionId: e.region.id, levelId: regionLevelId(e.region) }));
  const floors = ends.map((e) => indexOf(e.levelId)).filter((i) => i >= 0);
  // One-way when the far ends carry no way back (always so for a trap).
  const oneWay = !legacy && (mode === "trap" || ordered.slice(1).some((e) =>
    !getRegionBehaviors(e.region).some((b) => b?.type === "teleportToken")));
  const from = floors[0] ?? -1;

  const unique = [...new Set(floors)].sort((a, b) => a - b);
  const name = (i) => levelsAsc[i]?.name || t("DAT.Dash.UnnamedFloor");
  let where;
  if (!unique.length) where = t("DAT.Dash.WhereGone");
  else if (unique.length === 1) where = t("DAT.Dash.WhereSame", { floor: name(unique[0]) });
  else if (unique.length === 2 && oneWay) {
    const to = unique.find((i) => i !== from) ?? unique[1];
    where = t("DAT.Dash.WhereOneWay", { from: name(from), to: name(to) });
  } else if (unique.length === 2) where = t("DAT.Dash.WhereTwo", { a: name(unique[0]), b: name(unique[1]) });
  else where = t("DAT.Dash.WhereMany", { a: name(unique[0]), b: name(unique[unique.length - 1]), count: unique.length });

  const parts = [kindWord(mode), where];
  if (legacy) parts.push(t("DAT.Dash.OldTool"));
  return {
    linkId,
    label: first.label || kindWord(mode),
    mode,
    legacy,
    oneWay,
    from,
    floors,
    ends,
    where: parts.join(" · "),
    warn: !legacy && entries.length < 2 ? t("DAT.Dash.OneEndMissing") : ""
  };
}

export class DALevelManager extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Scene this window was opened for; null follows the scene on the canvas. */
  _sceneId = null;
  /** Currently-selected floor `_id` (null picks the viewed, then the lowest floor). */
  _selectedId = null;
  /** Active tab: "floors" | "stairs". */
  _tab = "floors";
  /** True while the selected floor's name is being typed. */
  _renaming = false;
  /** Stair to point out on the Stairs tab after a bar was clicked. */
  _focusLink = null;
  /** Which end of each stair "Go to" visits next. */
  _gotoNext = new Map();
  /** Set while drawing: every floor is joined, so the "left to do" list can go. */
  _todoDone = false;

  static DEFAULT_OPTIONS = {
    id: "da-level-manager",
    tag: "div",
    classes: ["da-level-manager-app"],
    window: { title: "DAT.Dash.Title", icon: "fa-solid fa-dungeon", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      switchTab: DALevelManager.#onSwitchTab,
      viewFloor: DALevelManager.#onViewFloor,
      renameFloor: DALevelManager.#onRenameFloor,
      setStart: DALevelManager.#onSetStart,
      moveUp: DALevelManager.#onMoveUp,
      moveDown: DALevelManager.#onMoveDown,
      replaceImage: DALevelManager.#onReplaceImage,
      addFloor: DALevelManager.#onAddFloor,
      removeFloor: DALevelManager.#onRemoveFloor,
      openNative: DALevelManager.#onOpenNative,
      openScene: DALevelManager.#onOpenScene,
      hideTodo: DALevelManager.#onHideTodo,
      importFolder: DALevelManager.#onImport,
      addStairs: DALevelManager.#onAddStairs,
      addStairsHere: DALevelManager.#onAddStairsHere,
      showStair: DALevelManager.#onShowStair,
      gotoStair: DALevelManager.#onGotoStair,
      editStair: DALevelManager.#onEditStair,
      addFloorStair: DALevelManager.#onAddFloorStair,
      adoptStair: DALevelManager.#onAdoptStair,
      removeStair: DALevelManager.#onRemoveStair
    }
  };

  static PARTS = {
    body: { template: "modules/dungeon-alchemist-toolkit/templates/dashboard.hbs" }
  };

  /**
   * Open (or bring forward) the Level Manager. GM only; one window.
   *
   * @param {object} [opts]
   * @param {string|null} [opts.sceneId]  Manage this scene; omit to follow the canvas.
   * @param {"floors"|"stairs"} [opts.tab]
   */
  static open({ sceneId = null, tab = null } = {}) {
    if (!requireGM()) return null;
    const existing = foundry.applications?.instances?.get("da-level-manager");
    const app = existing ?? new DALevelManager();
    // Opened for the scene already on the canvas is the same as following it.
    app._sceneId = sceneId && sceneId !== canvas?.scene?.id ? sceneId : null;
    if (tab === "floors" || tab === "stairs") app._tab = tab;
    app._selectedId = existing && !sceneId ? app._selectedId : null;
    app._renaming = false;
    app.render(true);
    if (existing) existing.bringToFront?.();
    return app;
  }

  /** The scene being managed. */
  get scene() {
    return (this._sceneId && game.scenes?.get(this._sceneId)) || canvas?.scene || null;
  }

  /** Whether the managed scene is the one on the canvas. */
  get isViewed() {
    const scene = this.scene;
    return !!scene && scene.id === canvas?.scene?.id;
  }

  /** @override */
  get title() {
    const scene = this.scene;
    return scene ? t("DAT.Dash.TitleScene", { scene: scene.name }) : t("DAT.Dash.Title");
  }

  /** @override */
  async _prepareContext(_options) {
    const scene = this.scene;
    if (!scene) return { hasScene: false, emptyText: t("DAT.Dash.NoScene") };

    const levelsAsc = getSceneLevels(scene);            // bottom-first
    if (!levelsAsc.length) return { hasScene: false, emptyText: t("DAT.Dash.NoLevels", { name: scene.name }) };
    const n = levelsAsc.length;
    const isViewed = this.isViewed;

    const validIds = new Set(levelsAsc.map((l) => l._id));
    const viewedId = isViewed ? getCurrentLevelId(scene) : null;
    let selectedId = this._selectedId && validIds.has(this._selectedId) ? this._selectedId : viewedId;
    if (!validIds.has(selectedId)) selectedId = levelsAsc[0]._id;
    this._selectedId = selectedId;

    const startId = getInitialLevelId(scene);
    const startIndex = Math.max(0, levelsAsc.findIndex((l) => l._id === startId));

    const links = [];
    for (const [linkId, entries] of getPortalLinkGroups(scene)) links.push(describeLink(linkId, entries, levelsAsc));
    links.sort((a, b) => a.label.localeCompare(b.label) || a.linkId.localeCompare(b.linkId));

    const { placed, lanes, hidden } = assignLanes(links);
    const cut = unreachableFloors(n, startIndex, links);
    const joinedAtAll = hasCrossFloorStairs(links);
    const hasBasement = levelsAsc.some((l) => (l.elevation?.bottom ?? 0) < 0);

    // Grid rows count from the top, floors from the bottom.
    const rowOf = (index) => n - index;
    const runs = placed.map((p) => ({
      linkId: p.linkId,
      mode: ["stairs", "teleport", "trap"].includes(p.mode) ? p.mode : "stairs",
      legacy: p.legacy,
      col: p.lane + 1,
      rowStart: rowOf(p.high),
      rowEnd: rowOf(p.low) + 1,
      tip: `${p.label}: ${p.where}`
    }));

    const floors = levelsAsc.map((l, index) => {
      const notes = [];
      if (l._id === viewedId) notes.push(t("DAT.Dash.Viewing"));
      if (l._id === startId) notes.push(t("DAT.Dash.StartFloor"));
      return {
        id: l._id,
        name: l.name || t("DAT.Dash.UnnamedFloor"),
        row: rowOf(index),
        active: l._id === selectedId,
        ground: hasBasement && (l.elevation?.bottom ?? 0) === 0,
        notes,
        warn: joinedAtAll && cut.has(index)
          ? t(index > startIndex ? "DAT.Dash.NoWayUp" : "DAT.Dash.NoWayDown")
          : ""
      };
    }).reverse();

    const sel = levelsAsc.find((l) => l._id === selectedId);
    const selIdx = levelsAsc.findIndex((l) => l._id === selectedId);
    const here = links.filter((k) => k.floors.includes(selIdx)).map((k) => k.label);

    let todo = null;
    if (n > 1 && cut.size > 0 && scene.getFlag?.(MODULE_ID, TODO_FLAG)) {
      todo = {
        joined: t("DAT.Todo.Joined", { done: n - 1 - cut.size, total: n - 1 }),
        startName: levelsAsc[startIndex]?.name || t("DAT.Dash.UnnamedFloor"),
        addLabel: t(joinedAtAll ? "DAT.Todo.AddMore" : "DAT.Todo.AddFirst")
      };
    }
    this._todoDone = n > 1 && cut.size === 0 && !!scene.getFlag?.(MODULE_ID, TODO_FLAG);

    const tab = this._tab === "stairs" ? "stairs" : "floors";
    return {
      hasScene: true,
      isViewed,
      isFloors: tab === "floors",
      isStairs: tab === "stairs",
      renaming: this._renaming,
      lanes,
      runs,
      floors,
      hiddenRuns: hidden ? t("DAT.Dash.MoreStairs", { count: hidden }) : "",
      notJoined: n > 1 && !joinedAtAll,
      todo,
      links: links.map((k) => ({ ...k, focus: k.linkId === this._focusLink })),
      selected: {
        name: sel?.name || t("DAT.Dash.UnnamedFloor"),
        bottom: sel?.elevation?.bottom ?? 0,
        top: sel?.elevation?.top ?? 0,
        start: selectedId === startId,
        canUp: selIdx < n - 1,
        canDown: selIdx > 0,
        stairsLine: here.length ? t("DAT.Dash.OnThisFloor", { stairs: here.join(", ") }) : t("DAT.Dash.NoStairs")
      }
    };
  }

  /** @override */
  _onRender(_context, _options) {
    // The frame is drawn once, so a change of scene has to rewrite the title.
    try { if (this.window?.title) this.window.title.textContent = this.title; } catch (_) { /* keep the old title */ }

    const root = this.element;
    const rename = root.querySelector(".da-rename");
    if (rename) {
      let cancelled = false;
      rename.focus();
      rename.select();
      rename.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); rename.blur(); }
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancelled = true; this._renaming = false; this.render(); }
      });
      rename.addEventListener("blur", async () => {
        if (cancelled || !this._renaming) return;
        this._renaming = false;
        await updateLevel(this.scene, this._selectedId, { name: rename.value });
        this.render();
      });
    }

    for (const sel of [".da-edit-bottom", ".da-edit-top"]) {
      root.querySelector(sel)?.addEventListener("change", () => this._commitHeights());
    }

    if (this._focusLink) {
      try { root.querySelector(".da-link.is-focus")?.scrollIntoView({ block: "nearest" }); } catch (_) { /* not worth an error */ }
    }

    // Every floor is joined, so the list has done its job.
    if (this._todoDone && game.user?.isGM) {
      this._todoDone = false;
      this.scene?.unsetFlag?.(MODULE_ID, TODO_FLAG)?.catch?.(() => {});
    }
  }

  /**
   * Save the selected floor's heights as typed. A range that runs backwards is
   * refused with a message and the fields go back to the saved values.
   */
  async _commitHeights() {
    const scene = this.scene;
    const id = this._selectedId;
    if (!scene || !id || !this.element) return;
    const bottom = parseFloat(this.element.querySelector(".da-edit-bottom")?.value ?? "");
    const top = parseFloat(this.element.querySelector(".da-edit-top")?.value ?? "");
    if (!Number.isFinite(bottom) || !Number.isFinite(top)) return;
    if (bottom >= top) {
      ui.notifications?.warn?.(t("DAT.Dash.BadElevation"));
      this.render();
      return;
    }
    await updateLevel(scene, id, { bottom, top });
  }

  /** Put the managed scene on the canvas if it is not there already. */
  async _ensureViewed() {
    const scene = this.scene;
    if (!scene) return false;
    if (scene.id === canvas?.scene?.id) return true;
    try { await scene.view(); } catch (err) {
      ui.notifications?.error?.(t("DAT.Dash.OpenFailed", { error: err.message }));
      return false;
    }
    return scene.id === canvas?.scene?.id;
  }

  static async #onViewFloor(_event, target) {
    const id = target?.dataset?.levelId;
    if (!id) return;
    this._selectedId = id;
    this._renaming = false;
    if (this.isViewed) { try { await viewLevel(id); } catch (_) { /* the floor is still selected */ } }
    this.render();
  }

  static #onRenameFloor() {
    this._renaming = true;
    this.render();
  }

  static async #onSetStart() {
    if (!this.scene || !this._selectedId) return;
    await setStartLevel(this.scene, this._selectedId);
    this.render();
  }

  static async #onMoveUp() {
    if (!this.scene || !this._selectedId) return;
    await moveLevel(this.scene, this._selectedId, +1);
    this.render();
  }

  static async #onMoveDown() {
    if (!this.scene || !this._selectedId) return;
    await moveLevel(this.scene, this._selectedId, -1);
    this.render();
  }

  static #onOpenNative() { openNativeLevels(this.scene); }

  static async #onOpenScene() {
    await this._ensureViewed();
    this.render();
  }

  static async #onHideTodo() {
    try { await this.scene?.unsetFlag?.(MODULE_ID, TODO_FLAG); } catch (_) { /* the list just stays */ }
    this.render();
  }

  /** Swap the selected floor's map image; its stairs, tokens and lights stay. */
  static #onReplaceImage() {
    const scene = this.scene;
    const id = this._selectedId;
    if (!scene || !id) return;
    const FilePicker = foundry.applications.apps?.FilePicker?.implementation;
    if (!FilePicker) { ui.notifications?.warn?.(t("DAT.Dash.NoPicker")); return; }
    const current = getSceneLevels(scene).find((l) => l._id === id)?.background?.src ?? "";
    const picker = new FilePicker({
      type: "imagevideo",
      current,
      callback: async (path) => {
        if (path) { await replaceLevelImage(scene, id, path); this.render(); }
      }
    });
    picker.browse(current).catch(() => { /* closed without a pick */ });
  }

  /** Add a new floor from a picked image or video, and select it. */
  static #onAddFloor() {
    const scene = this.scene;
    if (!scene) return;
    const FilePicker = foundry.applications.apps?.FilePicker?.implementation;
    if (!FilePicker) { ui.notifications?.warn?.(t("DAT.Dash.NoPicker")); return; }
    const picker = new FilePicker({
      type: "imagevideo",
      current: "",
      callback: async (path) => {
        if (!path) return;   // closed without a pick: no empty floor
        const name = safeDecode(path.split("/").pop().replace(/\.[^.]+$/, ""));
        const newId = await addLevel(scene, { src: path, name });
        if (newId) this._selectedId = newId;
        this.render();
      }
    });
    picker.browse("").catch(() => { /* closed without a pick */ });
  }

  /** Remove the selected floor after a confirm that says what stays behind. */
  static async #onRemoveFloor() {
    const scene = this.scene;
    const id = this._selectedId;
    if (!scene || !id) return;
    const name = getSceneLevels(scene).find((l) => l._id === id)?.name || t("DAT.Dash.UnnamedFloor");
    const DialogV2 = foundry.applications.api?.DialogV2;
    let ok = true;
    if (typeof DialogV2?.confirm === "function") {
      ok = await DialogV2.confirm({
        window: { title: t("DAT.Dash.RemoveTitle") },
        content: `<p>${t("DAT.Dash.RemoveConfirm", { name: esc(name) })}</p>`,
        modal: true,
        rejectClose: false
      });
    }
    if (!ok) return;
    await removeLevel(scene, id);
    this._selectedId = null;   // pick a surviving floor on the next draw
    this.render();
  }

  static #onSwitchTab(_event, target) {
    const tab = target?.dataset?.tab;
    if (!tab || tab === this._tab) return;
    this._tab = tab;
    this._focusLink = null;
    this._renaming = false;
    this.render();
  }

  /** A bar in the side view was clicked: show that stair in the list. */
  static #onShowStair(_event, target) {
    this._focusLink = target?.dataset?.linkId ?? null;
    this._tab = "stairs";
    this.render();
  }

  /** Show one end of a stair on the map; each press visits the next end. */
  static async #onGotoStair(_event, target) {
    const linkId = target?.dataset?.linkId;
    const scene = this.scene;
    const entries = getPortalLinkGroups(scene).get(linkId) ?? [];
    if (!entries.length) { ui.notifications?.warn?.(t("DAT.Stairs.GoneLink")); return; }
    if (!(await this._ensureViewed())) return;
    const turn = this._gotoNext.get(linkId) ?? 0;
    this._gotoNext.set(linkId, turn + 1);
    const region = entries[turn % entries.length].region;
    const levelIds = regionLevelIds(region);
    const levelId = levelIds.length > 1 ? levelIds[Math.floor(turn / entries.length) % levelIds.length] : regionLevelId(region);
    try { await viewLevel(levelId); } catch (_) { /* still pan to it */ }
    const c = regionCenter(region);
    if (c && typeof canvas?.animatePan === "function") canvas.animatePan({ x: c.x, y: c.y, duration: 250 });
    try { canvas?.regions?.activate?.(); } catch (_) { /* the pan is enough */ }
    try { region.object?.control?.({ releaseOthers: true }); } catch (_) { /* the pan is enough */ }
  }

  /**
   * Edit a whole stair at once: its name, its kind, whether it leads back, and
   * what each end is called. Written through the shared bindPortals path so
   * every end stays in step.
   */
  static async #onEditStair(_event, target) {
    const linkId = target?.dataset?.linkId;
    const scene = this.scene;
    const entries = getScenePortals(scene).filter((e) => e.portal?.linkId === linkId);
    if (!entries.length) { ui.notifications?.warn?.(t("DAT.Stairs.GoneLink")); return; }
    const entrance = entries.find((e) => e.portal?.role === "entrance") ?? entries[0];
    const others = entries.filter((e) => e !== entrance);
    const regions = [entrance.region, ...others.map((e) => e.region)];

    // A stair with one end has nothing to join, so Foundry's own sheet edits it.
    if (regions.length < 2) { entrance.region.sheet?.render(true); return; }

    const cur = entrance.portal ?? {};
    const curMode = cur.mode || "stairs";
    const curLabel = cur.label || kindWord(curMode);
    const curTwoWay = others.length
      ? others.every((e) => getRegionBehaviors(e.region).some((b) => b.type === "teleportToken"))
      : (curMode !== "trap");

    const modeOpts = ["stairs", "teleport", "trap"]
      .map((m) => `<option value="${m}"${m === curMode ? " selected" : ""}>${esc(t(`DAT.Stairs.KindLong.${m}`))}</option>`).join("");
    // Each end's name is what players read when asked which floor to go to.
    const levels = getSceneLevels(scene);
    const lvName = (id) => levels.find((l) => l._id === id)?.name ?? t("DAT.Dash.UnnamedFloor");
    const stopRows = regions.map((r) => {
      const id = r.id ?? r._id;
      const floor = lvName(regionLevelId(r));
      return `<div class="form-group"><label>${esc(floor)}</label>
        <input type="text" name="stop-${esc(id)}" value="${esc(r.name ?? floor)}" placeholder="${esc(floor)}" /></div>`;
    }).join("");
    const content = `
      <div class="da-stairs-opts">
        <div class="form-group"><label>${esc(t("DAT.Stairs.FieldName"))}</label>
          <input type="text" name="label" value="${esc(curLabel)}" /></div>
        <div class="form-group"><label>${esc(t("DAT.Stairs.FieldKind"))}</label>
          <select name="mode">${modeOpts}</select></div>
        <label class="da-stairs-opts-check">
          <input type="checkbox" name="twoWay"${curTwoWay ? " checked" : ""} /> ${esc(t("DAT.Stairs.FieldTwoWay"))}</label>
        <p class="hint">${esc(t("DAT.Stairs.FieldStops"))}</p>
        <div class="da-stairs-stops">${stopRows}</div>
      </div>`;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: t("DAT.Stairs.EditTitle") },
      content,
      buttons: [
        {
          action: "save", label: t("DAT.Stairs.BtnSave"), default: true,
          callback: (_e, btn) => {
            const f = btn?.form;
            const names = {};
            for (const r of regions) {
              const id = r.id ?? r._id;
              const v = f?.elements?.[`stop-${id}`]?.value?.trim();
              if (v) names[id] = v;
            }
            return {
              action: "save",
              label: f?.elements?.label?.value?.trim() || curLabel,
              mode: f?.elements?.mode?.value || "stairs",
              twoWay: f?.elements?.twoWay?.checked ?? true,
              names
            };
          }
        },
        { action: "sheet", label: t("DAT.Stairs.BtnSheet"), callback: () => ({ action: "sheet" }) },
        { action: "cancel", label: t("DAT.Stairs.BtnCancel"), callback: () => ({ action: "cancel" }) }
      ],
      rejectClose: false
    }).catch(() => null);

    if (!choice || choice.action === "cancel") return;
    if (choice.action === "sheet") { entrance.region.sheet?.render(true); return; }
    try {
      await bindPortals({ regions, mode: choice.mode, label: choice.label, twoWay: choice.twoWay });
      for (const r of regions) {
        const id = r.id ?? r._id;
        const nm = choice.names?.[id];
        if (nm && nm !== r.name) { try { await r.update({ name: nm }); } catch (_) { /* the rest still saved */ } }
      }
      ui.notifications?.info?.(t("DAT.Stairs.Updated"));
    } catch (err) {
      ui.notifications?.error?.(t("DAT.Stairs.UpdateFailed", { error: err.message }));
      console.error(err);
    }
    this.render();
  }

  /** Add another floor to this stair, placed on the map. */
  static async #onAddFloorStair(_event, target) {
    const linkId = target?.dataset?.linkId;
    if (!linkId) return;
    if (!(await this._ensureViewed())) return;
    try { await game.modules.get(MODULE_ID).api.AddFloorToLink(linkId); }
    catch (err) { ui.notifications?.error?.(t("DAT.Stairs.CreateFailed", { error: err.message })); console.error(err); }
    this.render();
  }

  /** Take a stair made with the old tool into the list as a managed stair. */
  static async #onAdoptStair(_event, target) {
    try {
      await adoptLegacyRegion(this.scene, target?.dataset?.linkId);
      ui.notifications?.info?.(t("DAT.Stairs.Adopted"));
    } catch (err) {
      ui.notifications?.error?.(t("DAT.Stairs.AdoptFailed", { error: err.message }));
      console.error(err);
    }
    this.render();
  }

  /** Delete every end of a stair, after a confirm. */
  static async #onRemoveStair(_event, target) {
    const linkId = target?.dataset?.linkId;
    const isLegacy = typeof linkId === "string" && linkId.startsWith(LEGACY_LINK_PREFIX);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("DAT.Stairs.DeleteTitle") },
      content: `<p>${esc(t(isLegacy ? "DAT.Stairs.DeleteOld" : "DAT.Stairs.DeleteAll"))}</p>`,
      rejectClose: false,
      modal: true
    }).catch(() => false);
    if (!ok) return;
    try {
      await deletePortalLink(this.scene, linkId);
      ui.notifications?.info?.(t("DAT.Stairs.Deleted"));
    } catch (err) {
      ui.notifications?.error?.(t("DAT.Stairs.DeleteFailed", { error: err.message }));
      console.error(err);
    }
    this.render();
  }

  static #onImport() { game.modules.get(MODULE_ID).api.Importer(); }

  /** Add a stair anywhere: the scene has to be on the canvas to place it. */
  static async #onAddStairs() {
    if (!(await this._ensureViewed())) return;
    game.modules.get(MODULE_ID).api.AddStairs();
  }

  /** Add a stair starting on the selected floor. */
  static async #onAddStairsHere() {
    if (!(await this._ensureViewed())) return;
    if (this._selectedId) { try { await viewLevel(this._selectedId); } catch (_) { /* place on the viewed floor */ } }
    game.modules.get(MODULE_ID).api.AddStairs();
  }
}
