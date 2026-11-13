# Dungeon Alchemist Toolkit

Foundry VTT v14 module that imports a Dungeon Alchemist multi-level export and creates a Scene using native v14 Scene Levels.

<p align="center"><img width="900" src="docs/preview.webp"></p>

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-red?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/mestredigital)

# How it Works

Dungeon Alchemist exports multi-floor maps as sibling file pairs: one image and one `.json` per floor, named with a numeric suffix (`TavernMap-_0.jpg`, `TavernMap-_0.json`, `TavernMap-_1.jpg`, ...). The image is static (`.jpg`, `.jpeg`, `.png`, `.webp`) or video (`.webm`, `.mp4`, `.m4v`); video floors become animated Scene Level backgrounds.

<p align="center"><img width="900" src="docs/importer-preview.webp"></p>

The module reads all pairs in a folder, parses each JSON for walls, doors and lights, and creates one Scene where each floor is a native **Scene Level** (new in Foundry v14). Walls, doors and lights are bound to their level and only act when that floor is active.

## Requirements

- One map per export folder: the importer pairs every image/video with a sibling `.json` by filename stem. It warns if a folder holds more than one map.
- Foundry VTT v14 or later (native Levels).
- Video floors: keep maps under Foundry's recommended ~30 fps and ~50 MB. A placed video map may need one click on the canvas before it plays (Foundry behavior).

## Features

### Level Manager (`DA.open()`)

The toolkit's home window, GM only. Open it from the **Dungeon Alchemist — Level Manager** button in the Token controls (disable with the *Toolbar button* client setting), the *Open the Toolkit* button in Module Settings, or `DA.open()`.

- **Floors** tab: the scene's floors, top first. View, rename, re-elevate, reorder, set the start floor, swap the image, add or remove floors; the stairs touching the selected floor are listed beside it. Cross-level visibility and everything else stays in Foundry's Levels tab (*Open Scene Config (Levels)* shortcut).
- **Import** tab: opens the importer.
- **Stairs** tab: every stair and portal on the scene (go-to, edit, add-a-floor, adopt legacy regions, remove) plus **Add Stairs / Portal**.

### Importer Dialog (`DA.Importer()`)

Open it from the Level Manager's **Import** tab or `DA.Importer()`.

#### Scene Defaults tab
- **Copy Media to World** (off by default): copies floor images and videos into `worlds/<your-world>/da-imported/<map-name>/`, renamed to `kebab-case`.
- The last-used door texture, door sound, background color, grid opacity and Copy Media toggle are remembered per browser.

#### Doors tab
- Door texture selector (25 Foundry canvas doors, hover preview) and door sound selector (21 options, play preview).
- Every wall exported with `door=1` gets the selected texture (with swing animation) and sound.

#### Levels tab
- One row per floor: thumbnail (video floors show a paused first frame, animated on hover), editable name, editable bottom / top elevation. Drag to reorder.
- **Uniform floor height** recalculates all elevations at once.
- **Advanced** toggle: per-level **Roof** checkbox (not on the bottom floor; the level renders only when the floor directly below is active) and a **Start** button for the floor shown on first load. A filename containing "roof" pre-marks a roof.
- Floors over ~50 MB get an amber outline (hover for the size) and a summary notification. Sizes are probed for local sources only.
- Import is blocked if any level's bottom is >= its top.

### Stairs & Portals (`DA.AddStairs()`, `DA.StairsManager()`)

Linked transit between (or within) levels, built on Foundry v14's native `teleportToken` behavior. **Add Stairs / Portal** places an entrance, then an exit on whichever level you switch to, and links them. Modes: **stairs** (cross-level, confirm), **teleport** (same level, confirm), **trap** (hidden, silent, one-way). A link can span more than two floors (place a footprint on each, then Done); every floor interconnects, so stepping onto any floor's stair offers every other connected floor. The **Stairs Manager** lists every link on the scene to find, edit or delete.

The Level Manager's **Stairs** tab has the same add and manage actions. Regions made by the old `DA.AddRegion()` appear tagged **legacy**, with **Adopt** (into a managed link) and **Remove**.

The player overlay is a sight-gated hint label only: clicking it does not move the token. Using a stair is always the native walk-in teleport. A real click-to-use is #18.

Foundry behaviors, not bugs here: two linked teleport regions can ping-pong a token, and the GM's view does not always follow a token's cross-level teleport.

> **Status:** pending live confirmation in a running v14 world (no Foundry runtime in CI), #17. Design: `docs/STAIRS-PORTAL-DESIGN.md`; code map: `docs/ARCHITECTURE.md`.

### Region Tool (`DA.AddRegion()`) — legacy

> Superseded by the stairs/portal tools; no toolbar button, still callable. Configures a region spanning consecutive levels with the native `changeLevel` behavior; move or resize it with Foundry's Region tools.

## Usage

The API is `game.modules.get("dungeon-alchemist-toolkit").api`, aliased to `DA`:

```js
DA.open();              // Level Manager (Floors / Import / Stairs)
DA.Importer();          // open the importer dialog
DA.AddStairs();         // place a linked entrance + exit
DA.LinkStairs();        // link two selected Regions into a pair
DA.AddFloorToLink(id);  // add another floor to an existing stair/portal link
DA.StairsManager();     // browse/edit this scene's stairs
DA.AddRegion();         // legacy multi-level changeLevel region
```

# 📦 Installation

Install via the Foundry VTT Module browser or use this manifest link:

```javascript
https://raw.githubusercontent.com/keyxmakerx/dungeon-alchemist-toolkit/refs/heads/main/module.json
```

# ⚖️ Credits & License

* **Code License:** GNU GPLv3.

* **Based on** [da-level-importer](https://github.com/brunocalado/da-level-importer) by **Bruno Calado (Mestre Digital)**, used and extended under GPLv3. *Dungeon Alchemist Toolkit* is an independent fork that substantially expands the original — see NOTICE.

* **Demo:** The maps are from Dungeon Alchemist and are under their license: https://www.dungeonalchemist.com/terms-of-use

