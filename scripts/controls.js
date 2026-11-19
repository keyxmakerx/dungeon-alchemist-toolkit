/**
 * Where the toolkit opens from. Each entry sits where the thing it acts on is:
 *
 * - The import button beside Create Scene in the Scenes list, because it makes a scene.
 * - "Floors and stairs" on a scene's right-click menu, because it is about that scene.
 * - One toolbar button for the scene on the canvas, which can be switched off.
 * - A Module Settings entry that always works.
 *
 * The toolbar gets ONE tool on an existing native group, never a group of its
 * own: a custom scene-controls group breaks native floor selection.
 *
 * Every entry is for a GM only, and a failure to add one leaves it missing
 * rather than breaking the sidebar.
 */

import { MODULE_ID } from "./constants.js";
import { DALevelManager } from "./dashboard.js";
import { t } from "./util.js";

const api = () => game.modules.get(MODULE_ID)?.api;

/** Put the import button with the Scenes list's own Create buttons. */
function addImportButton(app, html) {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? app?.element);
  if (!(root instanceof HTMLElement) || root.querySelector(".da-import-scene")) return;
  const create = root.querySelector('[data-action="createEntry"]') ?? root.querySelector(".create-entry, .create-document");
  const holder = create?.parentElement ?? root.querySelector(".header-actions, .action-buttons");
  if (!holder) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "da-import-scene";
  button.textContent = t("DAT.Entry.ImportShort");
  button.dataset.tooltip = t("DAT.Entry.Import");
  button.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); api()?.Importer(); });
  if (create?.nextSibling) holder.insertBefore(button, create.nextSibling);
  else holder.appendChild(button);
}

/** Add "Floors and stairs" to a scene's right-click menu. */
function addSceneMenuEntry(_app, entries) {
  if (!Array.isArray(entries)) return;
  entries.push({
    label: t("DAT.Entry.FloorsAndStairs"),
    icon: "",
    visible: () => !!game.user?.isGM,
    onClick: (_event, target) => {
      const el = target instanceof HTMLElement ? target : target?.[0];
      const row = el?.closest?.("[data-entry-id], [data-document-id], [data-scene-id]") ?? el;
      const sceneId = row?.dataset?.entryId ?? row?.dataset?.documentId ?? row?.dataset?.sceneId;
      if (sceneId) DALevelManager.open({ sceneId });
    }
  });
}

/** Register every way in. Called once at init. */
export function registerToolkitEntries() {
  try {
    game.settings.register(MODULE_ID, "toolbarButton", {
      name: "DAT.Settings.ToolbarButton.Name",
      hint: "DAT.Settings.ToolbarButton.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => { try { ui.controls?.render?.(); } catch (_) { /* shows on the next redraw */ } }
    });
    game.settings.register(MODULE_ID, "dropImport", {
      name: "DAT.Settings.DropImport.Name",
      hint: "DAT.Settings.DropImport.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true
    });
  } catch (err) {
    console.warn("[DA Toolkit] settings registration failed (non-fatal):", err);
  }

  try {
    game.settings.registerMenu(MODULE_ID, "openHub", {
      name: "DAT.Hub.Title",
      label: "DAT.Hub.MenuLabel",
      hint: "DAT.Hub.MenuHint",
      icon: "fa-solid fa-dungeon",
      type: DALevelManager,
      restricted: true
    });
  } catch (err) {
    console.warn("[DA Toolkit] settings-menu registration failed (non-fatal):", err);
  }

  Hooks.on("renderSceneDirectory", (app, html) => {
    try { addImportButton(app, html); }
    catch (err) { console.warn("[DA Toolkit] Scenes list button not added (non-fatal):", err); }
  });

  Hooks.on("getSceneContextOptions", (app, entries) => {
    try { addSceneMenuEntry(app, entries); }
    catch (err) { console.warn("[DA Toolkit] scene menu entry not added (non-fatal):", err); }
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    try {
      if (!game.user?.isGM) return;
      if (!game.settings.get(MODULE_ID, "toolbarButton")) return;
      const group = controls?.tokens ?? controls?.regions ?? Object.values(controls ?? {})[0];
      if (!group || typeof group !== "object") return;
      group.tools ??= {};
      group.tools["da-level-manager"] = {
        name: "da-level-manager",
        title: "DAT.Dash.Title",
        icon: "fa-solid fa-dungeon",
        button: true,
        visible: game.user.isGM,
        order: Object.keys(group.tools).length,
        onChange: (event, active) => { if (active) DALevelManager.open(); }
      };
    } catch (err) {
      console.warn("[DA Toolkit] toolbar tool registration failed (non-fatal):", err);
    }
  });
}
