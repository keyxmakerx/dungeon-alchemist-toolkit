# Dungeon Alchemist Toolkit

Foundry VTT v14 module that imports a Dungeon Alchemist multi-level export and creates a Scene using native v14 Scene Levels.

<p align="center"><img width="900" src="docs/preview.webp"></p>

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-red?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/mestredigital)

# How it Works

Dungeon Alchemist exports multi-floor maps as sibling file pairs — one image and one `.json` data file per floor, named with a numeric suffix (e.g. `TavernMap-_0.jpg`, `TavernMap-_0.json`, `TavernMap-_1.jpg`, `TavernMap-_1.json`). The image can be a static format (`.jpg`, `.jpeg`, `.png`, `.webp`) or an animated video (`.webm`, `.mp4`, `.m4v`); video floors are imported as animated Scene Level backgrounds.

<p align="center"><img width="900" src="docs/importer-preview.webp"></p>

This module reads all pairs in a folder, parses each JSON for wall, door, and light data, and creates a **single Foundry VTT Scene** where each floor becomes a native **Scene Level** (a feature introduced in Foundry VTT v14). Walls, doors, and lights are bound to their respective level so they only activate when that floor is active — no manual setup required.

## Requirements

- Each export folder must contain **only** the files for a single map. Do not mix exports from different maps in the same folder, as the importer will attempt to pair every image/video file with a sibling `.json` by filename stem. (The importer warns if it detects more than one map in a folder.)
- Foundry VTT **v14 or later** is required. The native Levels system used here is not available in earlier versions.
- **Animated (video) floors:** Foundry accepts `.webm`, `.mp4`, and `.m4v` as animated Scene Level backgrounds. Keep video maps reasonably sized (Foundry recommends ~30 fps and under ~50 MB per map). Note that a placed video map may need a single click on the canvas before it begins playing — this is Foundry behavior, not the importer.

## Features

### Importer Dialog (`DA.Importer()`)

The dialog is tabbed. Open it from the **Dungeon Alchemist** group in the scene controls (left canvas toolbar), from the toolkit **hub** (the *Open the Toolkit* button in Module Settings, or `DA.open()`), or by calling `DA.Importer()` from a macro.

#### Scene Defaults tab
- **Copy Media to World** toggle (off by default): copies all floor media (images *and* videos) into `worlds/<your-world>/da-imported/<map-name>/` and renames them to `kebab-case` for portability.
- The dialog remembers your last-used **door texture, door sound, background color, grid opacity, and Copy Media toggle** per browser and restores them the next time you open it.

#### Doors tab
- **Door texture selector** with 25 Foundry canvas door options and a real-time hover preview.
- **Door sound selector** with 21 Foundry door sound options and a play-preview button to audition before import.
- Any wall exported with `door=1` automatically receives the selected texture (with swing animation) and sound key on import.

#### Levels tab
- One row per detected floor showing a thumbnail, an editable name, and editable **bottom / top elevation** inputs. Video floors show a paused first frame in the row and animate in the enlarged hover preview.
- **Uniform floor height** field at the top: changing it recalculates all bottom/top inputs at once.
- Per-level **Is Roof** toggle (available on every floor except the first): marks that level as a roof so it renders only when the floor directly below it is active.
- **Large-media warning**: floors whose media exceeds Foundry's ~50 MB recommendation for animated maps are flagged with an amber outline (hover the thumbnail for the exact size), plus a summary notification. Sizes are probed for local sources only.
- **Elevation validation**: import is blocked with a message if any level's bottom is ≥ its top.

### Stairs & Portals (`DA.AddStairs()`, `DA.StairsManager()`)

Create linked transit between (or within) levels, built on Foundry v14's native `teleportToken` behavior. **Add Stairs / Portal** places an entrance, then an exit on whichever level you switch to, and links them; modes are **stairs** (cross-level, with a confirm), **teleport** (same map), and **trap** (hidden, silent, one-way). The **Stairs Manager** lists every link on the scene to find, edit, or delete it. `DA.LinkStairs()` links two Regions you've already selected.

> **Status:** built on native v14 and hardened, but pending live confirmation in a running v14 world (there is no Foundry runtime in CI). See `docs/STAIRS-TESTING.md`.

### Region Tool (`DA.AddRegion()`) — legacy

> Superseded by the stairs/portal tools above and no longer has a toolbar button; still callable via `DA.AddRegion()`. Opens a dialog to configure a staircase or elevator transit region spanning multiple consecutive levels using the native `changeLevel` behavior. Once placed, move or resize it with Foundry's native Region tools.

## Usage

Open the toolkit from the **Dungeon Alchemist** scene-controls group, the **hub** (`DA.open()` or the *Open the Toolkit* button in Module Settings), or call the API directly. The API lives at `game.modules.get("dungeon-alchemist-toolkit").api`, aliased to `DA` for convenience:

```js
DA.open();           // unified hub (Import / Add Stairs / Stairs Manager)
DA.Importer();       // open the importer dialog
DA.AddStairs();      // place a linked entrance + exit
DA.StairsManager();  // browse/edit this scene's stairs
DA.AddRegion();      // legacy multi-level changeLevel region
```

Select the folder exported by Dungeon Alchemist, configure the tabs, and click Import. The module creates a single Scene with one native Scene Level per floor, with walls, doors, and lights already bound to their respective levels.

# 📦 Installation

Install via the Foundry VTT Module browser or use this manifest link.

> **Testing build:** this manifest currently points to the `claude/gracious-goodall-ukqsio` branch so the in-progress features can be tested before release. It will be repointed to `main` once that work is merged.

```javascript
https://raw.githubusercontent.com/keyxmakerx/dungeon-alchemist-toolkit/refs/heads/claude/gracious-goodall-ukqsio/module.json
```

# ⚖️ Credits & License

* **Code License:** GNU GPLv3.

* **Based on** [da-level-importer](https://github.com/brunocalado/da-level-importer) by **Bruno Calado (Mestre Digital)**, used and extended under GPLv3. *Dungeon Alchemist Toolkit* is an independent fork that substantially expands the original — see NOTICE.

* **Demo:** The maps are from Dungeon Alchemist and are under their license: https://www.dungeonalchemist.com/terms-of-use

