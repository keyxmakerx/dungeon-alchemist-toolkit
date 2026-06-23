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

The dialog is tabbed and opens when you call `DA.Importer()` from a macro or from the **DA Level Importer** button injected in the Scenes directory sidebar.

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

### Region Tool (`DA.AddRegion()`)

Opens a dialog to configure a staircase or elevator transit region spanning multiple consecutive levels. Select a starting level, specify how many levels above and below should share the region, then **click on the canvas to drop a one-square region — or drag to draw a larger footprint** (a live preview follows the cursor). A single region document is created and bound to all target levels using native `changeLevel` behavior. Once placed, you can move or resize the region with Foundry's native Region tools.

## Usage

Open the importer from the Scenes directory sidebar button or call from a macro:

```js
DA.Importer();
```

Select the folder exported by Dungeon Alchemist, configure the tabs, and click Import. The module creates a single Scene with one native Scene Level per floor, with walls, doors, and lights already bound to their respective levels.

To add a staircase/elevator region to an existing scene:

```js
DA.AddRegion()
```

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

