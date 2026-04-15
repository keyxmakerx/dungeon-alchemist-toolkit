# Dungeon Alchemist Level Importer

Foundry VTT v14 module that imports a Dungeon Alchemist multi-level export and creates a Scene using native v14 Scene Levels.

# How it Works

Dungeon Alchemist exports multi-floor maps as sibling file pairs — one `.jpg` image and one `.json` data file per floor, named with a numeric suffix (e.g. `TavernMap-_0.jpg`, `TavernMap-_0.json`, `TavernMap-_1.jpg`, `TavernMap-_1.json`).

This module reads all pairs in a folder, parses each JSON for wall, door, and light data, and creates a **single Foundry VTT Scene** where each floor becomes a native **Scene Level** (a feature introduced in Foundry VTT v14). Walls, doors, and lights are bound to their respective level so they only activate when that floor is active — no manual setup required.

## Requirements

- Each export folder must contain **only** the files for a single map. Do not mix exports from different maps in the same folder, as the importer will attempt to pair every `.jpg`   with a sibling `.json` by filename stem.
- Foundry VTT **v14 or later** is required. The native Levels system used here is not available in earlier versions.

## Optional: Copy Images to World

The importer dialog includes a **Copy Images to World** toggle (off by default). When enabled, all floor images are copied from their original location into `worlds/<your-world>/da-imported/<map-name>/` before the scene is created. Files are renamed to `kebab-case` automatically. Use this option if you want the map assets stored inside your world folder for portability or backup purposes.

## Usage

Call from a macro:

```js
DA.Importer();
```

This opens a dialog where you select the folder exported by Dungeon Alchemist. The folder should contain the level images and the exported JSON file.

# 📦 Installation

Install via the Foundry VTT Module browser or use this manifest link:

```javascript
https://raw.githubusercontent.com/brunocalado/da-level-importer/main/module.json
```

# ⚖️ Credits & License

* **Code License:** GNU GPLv3.

* **Demo:** The maps are from Dungeon Alchemist and are under their license: https://www.dungeonalchemist.com/terms-of-use

