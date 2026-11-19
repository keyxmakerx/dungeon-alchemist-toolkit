# Dungeon Alchemist Toolkit

Foundry VTT v14 module that imports a Dungeon Alchemist multi-level export and creates a Scene using native v14 Scene Levels.

<p align="center"><img width="900" src="docs/preview.webp"></p>

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-red?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/mestredigital)

# How it Works

Dungeon Alchemist exports multi-floor maps as sibling file pairs: one image and one `.json` per floor, named with a numeric suffix (`TavernMap-_00.jpg`, `TavernMap-_00.json`, `TavernMap-_01.jpg`, ..., or `TavernMap_00.jpg` in current Dungeon Alchemist builds). The image is static (`.jpg`, `.jpeg`, `.png`, `.webp`) or video (`.webm`, `.mp4`, `.m4v`); video floors become animated Scene Level backgrounds.

<p align="center"><img width="900" src="docs/importer-preview.webp"></p>

The module reads all pairs in a folder, parses each JSON for walls, doors and lights, and creates one Scene where each floor is a native **Scene Level** (new in Foundry v14). Walls, doors and lights are bound to their level and only act when that floor is active. Windows let sight and light through, and secret doors stay secret doors.

## Requirements

- One map per export folder: the importer pairs every image/video with a sibling `.json` by filename stem. It warns if a folder holds more than one map.
- Foundry VTT v14 or later (native Levels).
- Video floors: keep maps under Foundry's recommended ~30 fps and ~50 MB. A placed video map may need one click on the canvas before it plays (Foundry behavior).

## Features

### Importing a map

Three ways in, GM only:

- **Drop the folder on Foundry.** Drag the folder Dungeon Alchemist exported from your desktop onto the Foundry window. The files are copied into `worlds/<your-world>/da-imported/<map-name>/` and the import window opens on them. Only a folder, or loose files that pair up into floors, is taken; any other drop is left to Foundry. Switch it off with the *Import by dropping a folder* client setting.
- **The Scenes list.** The **Dungeon Alchemist** button at the top of the Scenes sidebar opens the import window, where you browse to a folder already in Foundry's files (or use Foundry's file picker, which also reaches an S3 bucket).
- `DA.Importer()`.

The import window is one screen:

- **Floors**, top floor first: thumbnail (video floors show a paused first frame, animated on hover), name, height. Drag a row by its number to reorder.
- **Street level.** Pick the floor at street level. It is named *Ground floor* and starts at height 0; floors below become *Basement 1, 2* with heights below zero; floors above count up as *Upper floor 1, 2*. A file with "roof" in its name is called *Roof*. A name you type is kept.
- **Floor height** sets every floor at once. **Advanced** adds each floor's bottom and top, a **Roof** tick (not on the lowest floor; a roof shows only while the floor below it is being viewed) and the **Start** floor, which follows street level until you pick another.
- Floors over about 50 MB are outlined in amber (hover for the size). Import is blocked while any floor's bottom is not below its top.
- **Scene and door options** (folded): background colour, grid strength, **Copy the files into this world** (off by default, not offered after a drop, which has already copied them), door picture (25 Foundry doors, hover preview) and door sound (21 options, with a Play button). The last choices are remembered per browser.

After the import the new scene opens with the Level Manager beside it, showing a short **Left to do** list: join the floors with stairs, check the start floor. The list goes when every floor can be reached, or when you hide it.

### Level Manager (`DA.open()`)

The toolkit's home window, GM only. Open it from the toolbar button in the Token controls (switch it off with the *Toolbar button* client setting), from **Floors and stairs** in a scene's right-click menu in the Scenes sidebar, from Module Settings, or with `DA.open()`. It follows the scene you are viewing; opened from a scene's menu it stays on that scene. Every change saves as you make it.

- **Floors** tab: the building from the side. Each floor is a slab, top floor first; each stair is a bar beside the floors it joins (green stairs, blue teleport, red trap, dashed for one made with the old tool). A floor that cannot be reached from the start floor says *No way up yet* or *No way down yet*. Click a floor to view it; below the picture you can rename it, replace its image, remove it, set its height, make it the start floor, move it up or down, and add stairs on it. **Add a floor** and a shortcut to **Foundry's Levels tab** (what each floor shows of the others) are at the bottom.
- **Stairs** tab: every stair, teleport and trap in the scene, with **Go to**, **Edit**, **Add a floor** and **Delete**. Areas made with the old region tool are listed here too, marked *made with the old tool*, with **Adopt**.

### Stairs (`DA.AddStairs()`)

Linked travel between floors, or within one, built on Foundry v14's native `teleportToken` behavior.

- **A stairwell in one go.** *Add stairs* asks you to drag where the stairs are on the floor you are viewing, then shows a box beside them: name the stair and tick the floors it serves (the floors next to this one are ticked for you). The stair is placed at the same spot on every ticked floor and joined. Leave a floor unticked if the stair passes it without stopping.
- **Each end placed by hand.** *Place each end myself* in that box keeps the end you drew and walks you through the others one floor at a time, with the ends already placed shown as ghosts. Use it when the ends are in different places, for a teleport within one floor, or for a trap. This is also where you choose the kind: **stairs** (shown, the player chooses), **teleport** (shown, the player chooses), **trap** (hidden, no warning, one way).
- Every floor of a stair is joined to every other, so stepping on any end offers each of the rest. Any end is an ordinary Foundry Region: drag it to nudge it, and deleting one end with Foundry's own tools removes it from the other ends.
- **For players:** a label shows over a stair their token is near and can see. Clicking it walks their own token there along a path Foundry finds, so walls and locked doors stop it as they would a drag, and the stair then works exactly as if they had walked. Traps, and the far end of a one-way stair, show no label.

Fog of war needs nothing from the toolkit: Foundry v14 keeps explored fog per floor, so a token that changes floor uncovers that floor's own fog.

Foundry behaviors, not bugs here: two linked teleport regions can ping-pong a token, and the GM's view does not always follow a token's cross-level teleport.

> **Status:** pending live confirmation in a running v14 world (no Foundry runtime in CI), #17. Design: `docs/STAIRS-PORTAL-DESIGN.md`; code map: `docs/ARCHITECTURE.md`.

## Usage

The API is `game.modules.get("dungeon-alchemist-toolkit").api`, aliased to `DA`:

```js
DA.open();              // Level Manager (Floors / Stairs)
DA.Importer();          // open the import window
DA.AddStairs();         // a stairwell in one go; DA.AddStairs({ mode, label, twoWay }) places each end by hand
DA.LinkStairs();        // link two selected Regions into a pair
DA.AddFloorToLink(id);  // add another floor to an existing stair
DA.StairsManager();     // retired: opens the Level Manager's Stairs tab
DA.AddRegion();         // retired: opens the Level Manager's Stairs tab
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

