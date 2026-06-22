# Dungeon Alchemist Toolkit — Architecture

> Provisional — being updated for the v0.1.0 relaunch.

Developer documentation for the **Dungeon Alchemist Toolkit** Foundry VTT module
(`module.json:2` → id `dungeon-alchemist-toolkit`, version `0.1.0`, compatibility minimum/verified `14`,
authored by *Mestre Digital*; `module.json:6-9`, `module.json:11-17`).

The module imports a multi-floor Dungeon Alchemist export — one background media file
(image **or** video) plus one `.json` per floor — into a **single Foundry v14 Scene** that uses
**native v14 Scene Levels**, with walls/doors/lights bound to each level. It also ships a region
tool that creates multi-level staircase/elevator transit regions.

> All references below are `file:line` into the real source as of v0.1.0. Where behavior is
> inferred or relies on undocumented Foundry internals, this is called out explicitly.

---

## Table of Contents

1. [Overview & Entry Points](#1-overview--entry-points)
2. [Import Data Flow (End-to-End)](#2-import-data-flow-end-to-end)
3. [Key Data Shapes](#3-key-data-shapes)
4. [The Importer Dialog](#4-the-importer-dialog)
5. [The Region Adder](#5-the-region-adder)
6. [v14-Specific APIs Relied Upon](#6-v14-specific-apis-relied-upon)
7. [Extension Points — Where to Change Things](#7-extension-points--where-to-change-things)

---

## File Map

| File | Role |
| --- | --- |
| `scripts/main.js` | Entry hooks (`init`/`ready`), the `DA` global API, Scenes-sidebar button injection |
| `scripts/da-importer.js` | Core import logic: pairing, mixed-folder detection, fetch/parse, copy-to-world, Scene payload, wall/light mapping |
| `scripts/importer-dialog.js` | `DAImporterDialog` — the tabbed ApplicationV2 UI (incl. media size-probe) |
| `scripts/region-adder.js` | Region helpers: level introspection, canvas drag-to-draw rectangle capture, region creation |
| `scripts/region-adder-dialog.js` | `DARegionAdderDialog` — the region configuration ApplicationV2 UI |
| `scripts/constants.js` | `MODULE_ID`, `FLOOR_HEIGHT`, `SETTING_IMPORTER_DEFAULTS`, `MEDIA_SIZE_WARN_BYTES` shared constants |
| `templates/importer.hbs` | Handlebars template for the importer dialog |
| `templates/region-adder.hbs` | Handlebars template for the region dialog |
| `styles/module.css` | All module styling (dialogs, tabs, toggles, dropdowns, sidebar button) |
| `module.json` | Manifest (esmodule entry = `scripts/main.js`; `module.json:19-22`) |

---

## 1. Overview & Entry Points

The module is loaded as a single ES module via `module.json:19-21` (`esmodules: ["scripts/main.js"]`),
with `styles/module.css` registered as the only stylesheet (`module.json:22`).

### `init` hook — register the setting + API (`scripts/main.js:5-19`)

```js
Hooks.once("init", () => {
  // Per-client memory of the importer dialog's last-used selections.
  game.settings.register(MODULE_ID, SETTING_IMPORTER_DEFAULTS, {
    scope: "client", config: false, type: Object, default: {}
  });

  game.modules.get(MODULE_ID).api = {
    Importer: () => new DAImporterDialog().render(true),
    AddRegion: () => new DARegionAdderDialog().render(true)
  };
});
```

On `init`, the module does two things:

- **Registers a client-scoped, hidden setting** keyed by `SETTING_IMPORTER_DEFAULTS`
  (`= "importerDefaults"`, `scripts/constants.js:14`) via `game.settings.register`
  (`scripts/main.js:8-13`). `scope: "client"` keeps it per-browser; `config: false` hides it from
  the Settings UI. It stores the importer dialog's last-used selections (door texture/sound,
  background color, grid alpha, copy toggle) so they survive across opens — see
  [§4](#persisted-dialog-defaults).
- **Attaches an `api` object** onto its own module entry (`scripts/main.js:15-18`). The API has two
  members:
  - `Importer()` — constructs and renders a `DAImporterDialog` (`scripts/importer-dialog.js:42`).
  - `AddRegion()` — constructs and renders a `DARegionAdderDialog` (`scripts/region-adder-dialog.js:19`).

`MODULE_ID` is the shared constant `"dungeon-alchemist-toolkit"` (`scripts/constants.js:2`), kept in
sync with `module.json:2`.

### `ready` hook — expose the `DA` global (`scripts/main.js:21-23`)

```js
Hooks.once("ready", () => {
  window.DA = game.modules.get(MODULE_ID).api;
});
```

This makes the same API reachable from the browser console or any macro as `DA.Importer()` /
`DA.AddRegion()`. The canonical, namespaced access path remains
`game.modules.get("dungeon-alchemist-toolkit").api.{Importer,AddRegion}()`; `DA` is a convenience
alias bound to the identical object.

### Scenes-directory sidebar button injection (`scripts/main.js:32-49`)

```js
Hooks.on("renderSceneDirectory", (_app, html) => {
  if (html.querySelector(".da-importer-sidebar-btn")) return;          // idempotency guard
  const header = html.querySelector(".directory-header");
  if (!header) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "da-importer-sidebar-btn";
  btn.innerHTML = '<i class="fas fa-file-import"></i> DA Level Importer';
  btn.addEventListener("click", () => game.modules.get(MODULE_ID).api.Importer());
  const actionButtons = header.querySelector(".action-buttons") ?? header.querySelector(".header-actions");
  const anchor = actionButtons ? actionButtons.nextSibling : null;
  header.insertBefore(btn, anchor);
});
```

Notable details:

- The hook fires on **every** `SceneDirectory` render; the early-return guard at `scripts/main.js:33`
  prevents duplicate buttons.
- The handler receives the **DOM element** (`html`) directly and calls `querySelector` on it —
  this is the ApplicationV2 hook signature, not the jQuery object older Foundry passed.
- Placement is defensive: it looks for `.action-buttons` and falls back to `.header-actions`
  (`scripts/main.js:46`), inserting the button **after** the native Create-Scene/Create-Folder
  buttons so it lands between them and the search bar regardless of the search element's
  tag/class in v14 (`scripts/main.js:44-48`).
- The button click goes through the namespaced API (`game.modules.get(MODULE_ID).api.Importer()`),
  not the `DA` global — so it works even if something has clobbered `window.DA`.
- Styling: `.da-importer-sidebar-btn` is full-width minus padding (`styles/module.css:2-5`).

```mermaid
flowchart LR
  A[module load] --> B["Hooks.once init<br/>scripts/main.js:5"]
  B --> S["game.settings.register<br/>importerDefaults<br/>scripts/main.js:8"]
  B --> C["module.api = { Importer, AddRegion }"]
  A --> D["Hooks.once ready<br/>scripts/main.js:21"]
  D --> E["window.DA = module.api"]
  A --> F["Hooks.on renderSceneDirectory<br/>scripts/main.js:32"]
  F --> G["inject .da-importer-sidebar-btn"]
  G -->|click| H["api.Importer() → DAImporterDialog.render"]
  C -.-> H
  E -.-> H
```

---

## 2. Import Data Flow (End-to-End)

The whole pipeline lives in `importFolder(...)` (`scripts/da-importer.js:144-335`), driven by the
dialog's `#onImport` handler (`scripts/importer-dialog.js:607-653`). The stages below trace one
import from the user's click to `Scene.create`.

```mermaid
flowchart TD
  U["User clicks Import<br/>importer-dialog.js:607 #onImport"] --> EV["Validate elevations<br/>(bottom < top per level)<br/>importer-dialog.js:618-627"]
  EV -->|bottom ≥ top| ERRV["error → return (no import)"]
  EV --> OV["Build levelOverrides[]<br/>from form fields<br/>importer-dialog.js:638-649"]
  OV --> IF["importFolder(...)<br/>da-importer.js:144"]

  IF --> BR["FilePicker.browse(source, path)<br/>da-importer.js:149"]
  BR -->|browse error| ERR1["ui.notifications.error → return null"]
  BR --> CFP["collectFloorPairs(listing.files)<br/>da-importer.js:155 / 344"]
  CFP -->|0 pairs| ERR2["warn 'no floor pairs' → return null"]
  CFP --> MIX["distinctMapStems(pairs)<br/>>1 → warn (don't block)<br/>da-importer.js:165-168"]
  MIX --> FETCH["Promise.all: fetch + parse each p.json<br/>da-importer.js:172-176"]
  FETCH -->|fetch/JSON error| ERR3["error → return null"]

  FETCH --> COPY{copyImages?}
  COPY -->|yes| CP["_commonStem → _toKebab →<br/>_ensureUniqueSubfolder →<br/>_copyMedia per floor (mutates f.media)<br/>da-importer.js:187-216"]
  COPY -->|no| LV
  CP --> LV["Build levels[] (one per floor)<br/>da-importer.js:222-249"]

  LV --> VIS["Compute visibility.levels per level<br/>(isRoof shortcut only)<br/>da-importer.js:254-259"]
  VIS --> WL["Map walls + lights per floor<br/>_mapWall / _mapLight<br/>da-importer.js:267-274"]
  WL --> SD["Assemble sceneData<br/>(grid, env, levels, initialLevel, walls, lights)<br/>da-importer.js:277-312"]
  SD --> SC["Scene.create(sceneData)<br/>da-importer.js:318"]
  SC -->|throws / null| ERR4["error → return null"]
  SC --> OK["notify success → return scene<br/>da-importer.js:333-334"]
```

### Stage 1 — Folder browse (dialog side)

`#onBrowse` (`scripts/importer-dialog.js:90-118`) opens a `FilePicker` in `folder` mode
(`scripts/importer-dialog.js:92-93`). On selection, the callback:

1. Writes the chosen path into the hidden/readonly inputs `folder` and `source`
   (`scripts/importer-dialog.js:96-100`); `source` defaults to the picker's `activeSource`
   or `"data"`.
2. Immediately calls `FilePicker.browse(source, path)` and feeds the file list into
   `collectFloorPairs` to populate `this._floorPairs` (`scripts/importer-dialog.js:104-105`).
3. Gives each floor a stable `uid`, resets `_levelState`, sets `_initialLevelUid` to the first
   floor's uid (so a re-selection with fewer floors can't leave the star on a missing row), resets
   the size-probe cache `_mediaSizes`, calls `_populateLevelsTab()` to rebuild the Levels-tab rows,
   then kicks off the (fire-and-forget) media size probe `_probeMediaSizes(source)` — see
   [Large-media size warning](#large-media-size-warning).

So the **dialog browses the folder twice** in effect: once eagerly (to render per-level rows),
and again inside `importFolder` at import time (`scripts/da-importer.js:149`) as the source of truth.

### Stage 2 — `collectFloorPairs` (pairing rules, sorting, media precedence)

`collectFloorPairs(files)` (`scripts/da-importer.js:344-390`) is the heart of pairing. It is
**exported** so the dialog can inspect pairs before a full import.

Inputs are full URLs from `FilePicker.browse()`. The algorithm:

1. **Group by filename stem** (`scripts/da-importer.js:345-368`). For each file it
   `decodeURIComponent`s the basename, splits off the extension, and keys a `Map` by the stem
   (everything before the final dot).
2. **Filter to relevant extensions** (`scripts/da-importer.js:352`): only `json` or a member of
   `MEDIA_EXTS` is considered; anything else is skipped.
   - `IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"]` (`scripts/da-importer.js:27`)
   - `VIDEO_EXTS = ["webm", "mp4", "m4v"]` (`scripts/da-importer.js:28`)
   - `MEDIA_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS]` (`scripts/da-importer.js:29`)
3. **Slot assignment per stem** (`scripts/da-importer.js:355-367`):
   - `json` files fill `entry.json`.
   - Media files compete for a single `entry.img` / `entry.imgExt` slot. When a floor ships more
     than one media file, the winner is chosen **deterministically** by `MEDIA_PRIORITY`
     (`scripts/da-importer.js:36`) — the order `["webm", "mp4", "m4v", "webp", "png", "jpeg",
     "jpg"]`, i.e. *video > webp > png > jpg*. Each candidate's `MEDIA_PRIORITY.indexOf(ext)` is its
     rank (lower = preferred); a new file only displaces the current pick if its rank is strictly
     lower (`scripts/da-importer.js:361-366`). Because the decision is by extension rank rather than
     arrival order, the outcome is independent of the order `FilePicker` returns files in.
4. **Build pair objects** (`scripts/da-importer.js:370-389`): only stems that have **both** a
   `json` and an `img` become a pair; any stem missing one side is pushed onto an `orphans` list
   instead (`scripts/da-importer.js:372-376`). The floor index is parsed from the `-_NN` suffix via
   `FLOOR_RE = /-_(\d+)$/` (`scripts/da-importer.js:20`, applied at `:377`); stems without the
   suffix get `index: 0`.
5. **Warn on orphans** (`scripts/da-importer.js:385-387`): if any unpaired files were collected
   (a `.json` with no media, or media with no `.json`), the whole list is logged once via
   `console.warn("[DA Importer] skipped N unpaired file(s):", orphans)` — they are skipped, not
   silently dropped, so a mis-exported folder is diagnosable from the console.
6. **Sort** (`scripts/da-importer.js:388`): ascending by parsed `index`, then `localeCompare` on
   the stem as a tiebreaker.

The resulting pair object is `{ stem, index, json, media }` (`scripts/da-importer.js:378-383`),
where `media` is the chosen background media URL for the floor — an image **or** a video,
whichever won the `MEDIA_PRIORITY` contest.

> Pairing is purely filename-stem based, which is why the README requires one map per folder
> (`README.md:19`).

#### Mixed-folder detection (`distinctMapStems`)

Because pairing is stem-based, a folder that accidentally holds **two different maps** would pair
each media with its sibling JSON and silently merge both maps' floors into one Scene. To surface
this, `importFolder` calls the exported helper **`distinctMapStems(pairs)`**
(`scripts/da-importer.js:414-416`) right after pairing (`:165`): it strips each stem's `-_NN`
suffix and `_toKebab`-normalizes it (so case/accents/numbering don't create false positives),
returning the **unique** base-names. When more than one distinct base-name is found, the importer
**warns but does not block** — the import proceeds, mixing the floors, but the GM is told which
base-names collided (`scripts/da-importer.js:166-168`). This is a heuristic guard, not a hard
constraint: a single map always yields exactly one base-name.

### Stage 3 — JSON fetch & parse (`scripts/da-importer.js:170-180`)

All pairs are fetched in parallel with `Promise.all`. Each floor object is a **shallow copy** of its
pair plus a `data` field holding the parsed JSON (`{ ...p, data: await res.json() }`,
`scripts/da-importer.js:175`). A non-OK HTTP response throws and aborts the whole import with an
error notification (`scripts/da-importer.js:174`, `:177-180`).

The shallow-copy detail matters later: because `floors[i]` is its own object, the copy-to-world
stage can mutate `floors[i].media` without touching the original `pairs[i]`
(comment at `scripts/da-importer.js:206-208`).

### Stage 4 — Optional copy-to-world (`scripts/da-importer.js:187-216`)

Gated on the `copyImages` flag. When enabled, the world becomes self-contained: each floor's media
is copied into `worlds/<id>/da-imported/<map>/` and renamed to kebab-case.

- **Destination folder name** comes from `_commonStem(pairs)` (`scripts/da-importer.js:188` →
  `:398-401`), which strips the `-_NN` suffix from the first stem; it is then kebab-cased via
  `_toKebab` (`scripts/da-importer.js:189`), falling back to `"da-map"`.
- **`_ensureUniqueSubfolder(baseName)`** (`scripts/da-importer.js:80-106`):
  - `root = worlds/<game.world.id>/da-imported` (`scripts/da-importer.js:82`).
  - Best-effort `FP.createDirectory("data", root, {})`, ignoring errors if it already exists
    (`scripts/da-importer.js:84-86`).
  - Then probes `root/<candidate>` by calling `FP.browse(...)`: **success means the directory
    already exists** (so try the next name); a thrown error means it's free
    (`scripts/da-importer.js:92-98`). The first free slot is created and returned.
  - Collision handling appends an incrementing integer: `tavern → tavern1 → tavern2 …`
    (`scripts/da-importer.js:103-104`).
- **Per-floor copy** (`scripts/da-importer.js:198-214`):
  - Derives the original filename and extension from `f.media` (decoding the URL;
    `scripts/da-importer.js:200-203`), defaulting the extension to `"jpg"` if there's no dot.
  - Computes the kebab filename from `f.stem` via `_toKebab` (`scripts/da-importer.js:204`).
  - Calls `_copyMedia(...)` and **reassigns `f.media`** to the uploaded path
    (`scripts/da-importer.js:209`). Because the `levels[]` build below reads `f.media`, this is what
    redirects the Scene to the copies.
  - Any failure aborts with an error notification and `return null`
    (`scripts/da-importer.js:210-213`).
- **`_copyMedia(srcUrl, destFolder, kebabStem, ext)`** (`scripts/da-importer.js:118-130`): the
  copy primitive (its JSDoc describes it as downloading an "image or video";
  `scripts/da-importer.js:108-117`). `fetch`es the source URL, wraps the blob in a `File` named
  `<kebabStem>.<ext>`, and `FP.upload("data", destFolder, file, {})`, returning `result.path`. A
  non-OK fetch throws (`scripts/da-importer.js:122`).
- **`_toKebab(name)`** (`scripts/da-importer.js:61-68`): NFD-normalizes, strips combining
  diacritics (`[̀-ͯ]`), collapses any non-alphanumeric run to a single `-`, trims leading/
  trailing hyphens, and lowercases.

> The `_copyMedia` extension is computed from `f.media` (the chosen media URL), so video floors are
> copied with their real extension (`.webm` etc.), preserving the animated background.

### Stage 5 — Build `levels[]` (`scripts/da-importer.js:222-249`)

One Scene Level per floor. For floor `i`:

- `name` = override's trimmed name, else `` `Floor ${i}` `` (`scripts/da-importer.js:224`).
- **Default elevation** uses `FLOOR_HEIGHT` (= 10; `scripts/constants.js:8`):
  - `defaultBottom = i === 0 ? 0 : i * FLOOR_HEIGHT + 1` (`scripts/da-importer.js:225`).
  - `defaultTop = (i + 1) * FLOOR_HEIGHT` (`scripts/da-importer.js:226`).
  - i.e. `0–10`, `11–20`, `21–30`, … — the `+1` (added in v0.0.2) prevents adjacent floors from
    sharing a boundary elevation (`CHANGELOG.md:58-59`).
  - Overrides win only when finite: `Number.isFinite(ov?.bottom) ? ov.bottom : defaultBottom`
    (`scripts/da-importer.js:227-228`).
- `_id` is a fresh `foundry.utils.randomID()` (`scripts/da-importer.js:230`); this id is the
  binding key reused by walls, lights, `initialLevel`, and `visibility.levels`.
- `background.src` = `f.media` (the possibly-copied media URL; `scripts/da-importer.js:234`).
- `sort = i` (`scripts/da-importer.js:246`).

The complete emitted Level shape is documented in [§3](#scene-level-object).

#### `visibility.levels` second pass (`scripts/da-importer.js:254-259`)

After all levels exist (so their `_id`s are known), `visibility.levels` is computed per level from a
single source — the **`isRoof` shortcut**: if `i > 0` and the override marks this level a roof, push
the *immediately-lower* level's id (`scripts/da-importer.js:257`), so a roof renders only when the
floor directly below it is active. Any finer cross-level visibility is now configured natively via
the **v14 Levels tab in Scene Config** after import — the importer no longer ships a Visible-Levels
dropdown.

### Stage 6 — Map walls & lights (`scripts/da-importer.js:267-274`)

For each floor, with `levelId = levels[i]._id` and `elevation = levels[i].elevation.bottom` — the
level's **resolved** bottom, which honors any per-level override rather than recomputing a raw
`i * FLOOR_HEIGHT` that would ignore overrides (`scripts/da-importer.js:271`, comment at `:269-270`):

- `f.data.walls ?? []` → `_mapWall(w, levelId, doorTexture, doorSound)`
  (`scripts/da-importer.js:272`).
- `f.data.lights ?? []` → `_mapLight(l, levelId, elevation)` (`scripts/da-importer.js:273`).

Mapping details are in [§3](#wall-document-mapping). Counts are logged at
`scripts/da-importer.js:275`.

### Stage 7 — Assemble `sceneData` & create (`scripts/da-importer.js:277-335`)

The Scene payload (`scripts/da-importer.js:277-312`) pulls map-wide properties from the **first
floor's JSON** (`first = floors[0].data`, `scripts/da-importer.js:219`):

- `name` = `_commonStem` result, else `"Dungeon Alchemist Map"` (`scripts/da-importer.js:278`).
- `width` / `height` / `padding` from `first` (padding defaults `0.25`;
  `scripts/da-importer.js:279-281`).
- `grid`: `type: 1` (square), `size: first.grid`, plus color/alpha/distance/units pulled from
  `first` with fallbacks (`scripts/da-importer.js:283-292`); `alpha` is the dialog's `gridAlpha`.
- `tokenVision: true`; **fog is omitted** so the Scene inherits the v14 default — v14 replaced the
  numeric `fog.mode` with `fog.exploration` modes, so emitting `mode` would fail validation
  (`scripts/da-importer.js`).
- `environment` block (`scripts/da-importer.js:295-307`): `darknessLevel`, a `globalLight` whose
  `enabled` mirrors `!!first.globalLight`, plus static `base`/`dark` color grading.
- `levels` (from Stage 5), `initialLevel`, `walls`, `lights` (`scripts/da-importer.js:308-311`).
- **`initialLevel`** = `(levels[initialLevelIndex] ?? levels[0])._id`
  (`scripts/da-importer.js:309`) — the selected floor's id, falling back to the first level.

`Scene.create(sceneData)` is wrapped in try/catch (`scripts/da-importer.js:316-323`); a thrown
error or a falsy return both abort with notifications (`scripts/da-importer.js:324-327`). On
success it reads back `scene.levels` / `scene.walls` / `scene.lights` sizes for a confirmation
notification (`scripts/da-importer.js:329-334`). The function returns the created `Scene` (or
`null`). Back in the dialog, a truthy result closes the dialog (`scripts/importer-dialog.js:652`).

---

## 3. Key Data Shapes

### The floor-pair object (`collectFloorPairs`)

Produced at `scripts/da-importer.js:378-383`:

```js
{
  stem:  "TavernMap-_1",   // filename stem (no extension)
  index: 1,                // parsed from the -_NN suffix (FLOOR_RE), else 0
  json:  "<url>.json",     // the .json sibling URL
  media: "<url>.webm"      // the chosen background media URL (image OR video, per MEDIA_PRIORITY)
}
```

After `Promise.all` (`scripts/da-importer.js:175`) each **floor object** is `{ ...pair, data }`,
where `data` is the parsed DA JSON. If `copyImages` is on, `floor.media` is later overwritten with
the copied path (`scripts/da-importer.js:209`).

<a name="scene-level-object"></a>
### The Scene Level object (every field)

Emitted at `scripts/da-importer.js:229-248`, with `visibility.levels` filled by the second pass
(`scripts/da-importer.js:262`):

```js
{
  _id: "<randomID>",                       // da-importer.js:230 — binding key
  name: "Floor 0",                         // override or `Floor ${i}`        :224
  elevation: { bottom, top },              // override or FLOOR_HEIGHT default :227-228, :232
  background: {
    src: f.media,                          // floor media (possibly copied)   :234
    color: backgroundColor,                // dialog background color         :235
    tint: "#ffffff",
    alphaThreshold: 0.75
  },
  foreground: { src: null, tint: "#ffffff", alphaThreshold: 0.75 },  // :239
  fog: { src: null, tint: "#ffffff" },                                // :240
  textures: {                                                         // :241-244
    anchorX: 0.5, anchorY: 0.5,
    fit: "fill", scaleX: 1, scaleY: 1
  },
  visibility: { levels: [/* ids */] },     // filled by 2nd pass             :245, :262
  sort: i,                                 // floor index                    :246
  flags: {}                                // :247
}
```

> The `textures` block no longer carries `offsetX`/`offsetY`/`rotation`: those keys were removed
> from Foundry's `TextureData` in v14.354, so emitting them would fail schema validation.

### DA → Foundry wall enums (`_senseEnum` / `_moveEnum`)

DA's compact `{0: none, 1: normal, 2: limited}` restriction scheme is translated by **two**
helpers, because v14 has different value sets for *sense* vs *movement* restrictions:

- **`_senseEnum(v)`** (`scripts/da-importer.js:426-430`) — used for **sight** and **sound** (the
  `WALL_SENSE_TYPES` set `{NONE: 0, LIMITED: 10, NORMAL: 20}`). It maps `2→10`, `1→20`, anything
  else (incl. `0`) `→0`, clamping to exactly the three values DA emits.
- **`_moveEnum(v)`** (`scripts/da-importer.js:442-444`) — used for **movement**. v14
  `WALL_MOVEMENT_TYPES` only defines `{NONE: 0, NORMAL: 20}` — there is **no** `LIMITED` for
  movement — so it collapses to binary `v ? 20 : 0`: any blocking value (normal *or* limited) maps
  to `NORMAL`, and `0` stays `NONE`. Routing movement through `_senseEnum` would emit the invalid
  value `10` (rationale at `scripts/da-importer.js:432-441`).

| field | helper | DA `2` (limited) | DA `1` (normal) | DA `0`/other (none) |
| --- | --- | --- | --- | --- |
| `sight` | `_senseEnum` | `10` (`LIMITED`) | `20` (`NORMAL`) | `0` (`NONE`) |
| `sound` | `_senseEnum` | `10` (`LIMITED`) | `20` (`NORMAL`) | `0` (`NONE`) |
| `move`  | `_moveEnum`  | `20` (`NORMAL`)  | `20` (`NORMAL`) | `0` (`NONE`) |

<a name="wall-document-mapping"></a>
### Wall document mapping (`_mapWall`)

`_mapWall(daWall, levelId, doorTexture, doorSound)` (`scripts/da-importer.js:458-473`):

```js
{
  c: daWall.c,                       // [x1,y1,x2,y2] segment endpoints, passed through
  move:  _moveEnum(daWall.move  ?? 1),    // 0 or 20 only (no LIMITED for movement)
  sight: _senseEnum(daWall.sense ?? 1),   // NB: DA field is `sense`, Foundry field is `sight`
  sound: _senseEnum(daWall.sound ?? 1),
  door:  daWall.door ?? 0,           // 0 none, 1 door (DA passthrough)
  ds: 0,                             // door state: closed
  levels: [levelId]                  // SceneLevelsSetField binding
}
```

If `daWall.door === 1` **and** the dialog supplied options
(`scripts/da-importer.js:468-471`):

- `doorTexture` (non-empty) → `wallDoc.animation = { texture: doorTexture, type: "swing" }`.
- `doorSound` (non-empty) → `wallDoc.doorSound = doorSound` (a `CONFIG.Wall.doorSounds` key).

Defaults of `?? 1` on `move`/`sense`/`sound` mean an absent DA flag is treated as *normal*
(→ `20`).

<a name="light-document-mapping"></a>
### Light document mapping (`_mapLight`)

`_mapLight(daLight, levelId, elevation)` (`scripts/da-importer.js:485-505`):

```js
{
  x: daLight.x, y: daLight.y,
  rotation: 0,
  walls: true,                       // light occluded by walls
  vision: false,
  elevation,                         // = levels[i].elevation.bottom (resolved) da-importer.js:271
  config: {
    dim:   daLight.dim,
    bright: daLight.bright,
    color: daLight.tintColor ?? null,
    alpha: daLight.tintAlpha ?? 0.5,
    angle: 360,
    coloration: 1,
    luminosity: 0.5,
    animation: { type: null, speed: 5, intensity: 5, reverse: false }
  },
  levels: [levelId]                  // SceneLevelsSetField binding
}
```

`elevation` is the level's **resolved** `elevation.bottom` — honoring any per-level override, not a
recomputed `i * FLOOR_HEIGHT` — stamped as a sensible default so the light sorts correctly in
3D-aware tooling (comment at `scripts/da-importer.js:475-484`, value computed at `:271`).

### Region document (see also §5)

Built in `createMultiLevelRegion` (`scripts/region-adder.js:225-284`). Summary:

```js
{
  name, color: "#b0cc28",
  elevation: { bottom: minBottom, top: maxTop },  // spans the bound levels  region-adder.js:248-249,:254
  levels: levelIds,                               // Set of bound level ids  :255
  visibility: 2, highlightMode: "shapes",
  displayMeasurements: false, hidden: false,
  shapes: [ { type: "rectangle", x, y, width, height, hole: false, rotation: 0 } ],  // resolved rect (drag or 1-grid fallback)  :260-270
  behaviors: [ { name: "Change Level", type: "changeLevel", system: {}, disabled: false, flags: {} } ]  // :271-279
}
```

> The rectangle shape carries **only** `type`/`x`/`y`/`width`/`height`/`hole`/`rotation`. The
> `anchorX`/`anchorY`/`gridBased` keys present through v0.0.5 were removed in v0.0.6 — they are
> **not** valid v14 `RectangleShapeData` fields and would fail schema validation
> (`CHANGELOG.md:9-10`). `x,y` is the rectangle's top-left; `width`/`height` come from the drag (or
> the 1-grid fallback) — see [§5](#region-placement-drag-to-draw).

---

## 4. The Importer Dialog

`DAImporterDialog` (`scripts/importer-dialog.js:42-654`).

### Class structure (ApplicationV2 + HandlebarsApplicationMixin)

```js
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;   // :4
export class DAImporterDialog extends HandlebarsApplicationMixin(ApplicationV2) { ... }
```

**Instance state** (`scripts/importer-dialog.js:43-62`):

- `_floorPairs` — the pairs from the last folder browse.
- `_thumbVideos` — the Levels-tab `<video>` thumbnails currently mounted; paused/released on
  rebuild and close.
- `_initialLevelUid` — stable uid of the level shown on scene load; `null` until a folder is browsed.
- `_levelState` — `Map` keyed by floor uid holding each floor's editable `{name, bottom, top, isRoof}`
  so edits survive row rebuilds and reordering.
- `_dragFromIndex` — source row index during a drag-to-reorder; `null` when not dragging.
- `_restoredDefaults` — guards the one-time restore of persisted selections on first render.
- `_advancedView` — Levels-tab "Show advanced columns" (Roof / Start) state, persisted across
  re-renders.

> The standalone Visible-Levels dropdown is gone, so the former `_visDropdowns` / `_visCheckboxes` /
> `_visOutsideHandler` body-dropdown machinery no longer exists. Cross-level visibility is now edited
> in the native v14 Levels tab in Scene Config after import.
- `_mediaSizes` — `Map<floorIndex, bytes>` of probed media sizes, re-applied to rows on each render
  (`:57-58`); see [Large-media size warning](#large-media-size-warning).
- `_sizeProbeGen` — monotonic token so a stale size-probe batch can't patch rows after a newer
  browse (`:59-60`).
- `_sizeAbort` — `AbortController` for the in-flight size-probe batch, aborted on re-browse/close
  (`:61-62`).

**`DEFAULT_OPTIONS`** (`scripts/importer-dialog.js:63-82`):

- `id: "da-importer"`, `tag: "form"`, `form.closeOnSubmit: false`.
- `window.title` (`"Dungeon Alchemist Toolkit"`), `window.resizable: false`; `position.width: 620`,
  `height: "auto"`.
- **`actions`** map (the ApplicationV2 click-delegation system; keyed by `data-action` in the
  template): `browse → #onBrowse`, `import → #onImport`, `previewSound → #onPreviewSound`
  (`:77-81`).

**`PARTS`** (`scripts/importer-dialog.js:84-88`): a single `form` part →
`modules/dungeon-alchemist-toolkit/templates/importer.hbs`.

<a name="persisted-dialog-defaults"></a>
### Persisted dialog defaults (`game.settings`)

The dialog remembers a handful of selections **per client** across opens, backed by the hidden
setting registered in `init` (`scripts/main.js:8-13`, key `SETTING_IMPORTER_DEFAULTS`). Two methods
bracket the lifecycle:

- **`_restoreSavedDefaults()`** (`scripts/importer-dialog.js:145-164`): runs **once**, guarded by
  the `_restoredDefaults` flag (`:146-147`) so later re-renders can't clobber in-progress edits. It
  `game.settings.get`s the saved object (tolerating a thrown/absent setting via try-catch; `:149-150`)
  and writes each remembered value back into the corresponding input — `backgroundColor`,
  `gridAlpha`, `doorTexture`, `doorSound` via a `setValue` helper (`:153-161`), and the `copyImages`
  checkbox's `checked` state (`:162-163`). It is invoked at the **top** of `_onRender` (`:187`) so
  the range-display and door-preview wiring below reflect the restored values.
- **`_saveCurrentDefaults({...})`** (`scripts/importer-dialog.js:167-173`): called from `#onImport`
  just before the import runs (`:636`); `game.settings.set`s the same five fields. Failures are
  swallowed as non-fatal (`:168-172`).

Remembered fields: background color, grid alpha, door texture, door sound, and the Copy-Media
toggle. (The Levels-tab per-row inputs are **not** persisted — they depend on the selected folder.)

### Tabbed UI (`templates/importer.hbs` + `_onRender`)

The template declares three tab buttons and three panels keyed by `data-tab`: **Scene Defaults**,
**Doors**, **Levels** (`templates/importer.hbs:14-18`, panels at `:20`, `:67`, `:145`). The Scene
Defaults tab is active by default (`da-tab-btn--active`, `templates/importer.hbs:15`).

Tab switching is wired in `_onRender` (`scripts/importer-dialog.js:200-213`): clicking a
`.da-tab-btn` toggles `da-tab-btn--active` + `aria-selected` on the buttons and
`da-tab-panel--hidden` on the panels. (`.da-tab-panel--hidden { display: none }`,
`styles/module.css:59-61`.)

`_onRender` (`scripts/importer-dialog.js:184-263`) also handles:

- **Restore persisted defaults** first thing (`:187`) — see
  [Persisted dialog defaults](#persisted-dialog-defaults).
- **Grid-alpha range sync** (`:190-197`) — mirrors the slider value into `.range-value`, formatted
  to 2 decimals.
- **Door texture preview + tooltip** (`:216-244`) — sets `.da-door-preview` `src` from the
  `doorTexture` select and shows an enlarged hover tooltip appended to `document.body`
  (`:227-243`).
- **Uniform floor-height recompute** (`:247-259`) — on change, recalculates every
  `levelBottom[i]`/`levelTop[i]` input using `i === 0 ? 0 : i*h+1` and `(i+1)*h`, mirroring the
  importer's defaults.
- Finally re-runs `_populateLevelsTab()` so rows survive any re-render (`:262`).

### Doors tab

Pure template (`templates/importer.hbs:67-143`): a 25-option **door texture** `<select>` (each value
a `canvas/doors/...webp` path; `:73-100`) with the preview `<img class="da-door-preview">`
(`:101`), and a 21-option **door sound** `<select>` (`:111-134`) with a `previewSound` button
(`:135-137`). `#onPreviewSound` (`scripts/importer-dialog.js:130-137`) resolves the selected key
through `CONFIG.Wall.doorSounds`, picks `open` (falling back to `close`), and plays it via
`foundry.audio.AudioHelper.play(...)`.

<a name="large-media-size-warning"></a>
### Large-media size warning

After a folder browse, `_onBrowse` fires `_probeMediaSizes(source)` (`scripts/importer-dialog.js:114`)
to flag floors whose background media is large enough to slow scene loads — Foundry recommends
keeping animated maps under ~50 MB, encoded as the constant `MEDIA_SIZE_WARN_BYTES`
(`= 50 * 1024 * 1024`, `scripts/constants.js:20`).

- **`_probeMediaSizes(source)`** (`scripts/importer-dialog.js:311-340`) issues one **HEAD** request
  per floor and reads `Content-Length`. Guards:
  - **Gated to local sources**: returns early unless `source` is `"data"` or `"public"` (`:312`) —
    remote/absolute URLs (e.g. S3) are skipped so the probe never issues a cross-origin request or
    leaks the GM's address to arbitrary hosts.
  - The fetch uses `credentials:"omit"`, `cache:"no-store"`, and an `AbortController` whose 10 s
    timeout (`:317-319`) is also the `_sizeAbort` aborted on re-browse/close. A monotonic
    `_sizeProbeGen` token (`:315`) is captured per batch; a result is discarded if a newer browse
    has bumped the token (`:328`), so a slow batch can't patch rows from a stale folder.
  - Any failure (CORS, 405, missing `Content-Length`, network) is swallowed (`:332`) — "size
    unknown" never warns and never blocks import.
  - Successful sizes are cached in `_mediaSizes` (`:329`) and a badge is applied immediately
    (`:330`). Oversized floors are collected and, if any, summarized in a single
    `ui.notifications.warn` (`:336-339`).
- **`_applySizeBadge(i, bytes, thumbEl)`** (`scripts/importer-dialog.js:352-363`) marks the floor's
  thumbnail via attribute/`title` channels only (no `innerHTML`). It accepts an optional `thumbEl`
  for the build-time call (the row isn't in the DOM yet) and otherwise looks the thumb up by
  `.da-level-row[data-level-index="${i}"]` (`:353`). At or above the threshold it adds
  `da-thumb-oversize` and a "exceeds ~50 MB" `title` (`:356-358`); otherwise it sets a plain
  `"N MB"` `title` (`:359-362`).

To make the index lookup work, each row now carries a `data-level-index` attribute
(`row.dataset.levelIndex`, `scripts/importer-dialog.js:411`), and the first pass of
`_populateLevelsTab` re-applies any cached badge to the freshly-built thumbnail
(`:419-420`) since rows are rebuilt on every render. The probe is aborted in `_onClose` (`:599`).

The oversize appearance is the `.da-level-thumb.da-thumb-oversize` rule — a 2 px amber outline
(`styles/module.css:380-383`).

### Levels-tab construction (`_populateLevelsTab`, `scripts/importer-dialog.js:375-587`)

This method **fully rebuilds** the Levels list from `this._floorPairs`. It is called after a folder
browse (`:113`) and after every render (`:262`).

1. **Teardown** prior video thumbnails via `_teardownThumbVideos()`. (There are no longer any
   body-attached Visible-Levels dropdowns to tear down.)
2. **Placeholder vs list**: with no pairs, the
   `.da-levels-placeholder` ("Select a folder above…") is shown and
   the list cleared; otherwise the placeholder is hidden and the list rebuilt.
3. **Header row** (`:464-483`): columns `# · "" · Name · Bottom · Top · Roof · Start`, where **Roof**
   and **Start** are advanced columns shown only when "Show advanced columns" is on. There is no
   longer a **Visible** column.
4. **First pass — one `.da-level-row` per floor** (`:404-489`):
   - The row element gets a `data-level-index` attribute for the size-badge lookup (`:411`).
   - Index badge (`:413-415`).
   - **Thumbnail** via `_buildThumbEl(pair.media, "da-level-thumb", { animate: false })` (`:417`) —
     paused on its first frame; if it's a `<video>` it's pushed onto `_thumbVideos` for later
     teardown (`:418`). A previously-probed size badge is re-applied to the new thumb (`:419-420`).
     A hover tooltip media built with `_buildThumbEl(pair.media, "", { animate: true })`
     (autoplaying) is appended to `document.body` (`:424-438`); on mouse-leave the tooltip video is
     paused before removal (`:434-438`).
   - `levelName[i]` text input defaulting to `` `Floor ${i}` `` (`:440-444`).
   - `levelBottom[i]` / `levelTop[i]` number inputs seeded with the `FLOOR_HEIGHT` defaults
     (`:406-407`, `:446-458`).
   - **Roof toggle** `levelIsRoof[i]` — a styled checkbox with the roof-behavior tooltip
     (`:461-474`).
   - **Initial-level star button** (advanced **Start** column) — `★`/`☆`, active when the row's uid
     equals `this._initialLevelUid`.
5. **Initial-level wiring**: clicking any star sets `_initialLevelUid` (by floor uid) and resets all
   other stars — a radio-style, single-select toggle.

> **Removed in v0.1.0:** the second-pass per-row **Visible Levels** dropdown (and its
> `document.body`-attached, `position: fixed` machinery) no longer exists. Per-level cross-visibility
> is configured natively in the v14 Levels tab in Scene Config after import, so the Levels tab now
> carries only the basic columns plus the advanced **Roof**/**Start** toggles.

#### Thumbnails: image-vs-video, paused vs animated (`_buildThumbEl`, `isVideoPath`)

`_buildThumbEl(src, className, { animate = false })` (`scripts/importer-dialog.js:21-40`): builds a
`<video>` when `isVideoPath(src)`, otherwise an `<img>` (`:22-23`). Videos are always `muted`,
`loop`, `playsInline`, but **autoplay is gated on the `animate` option**: `el.autoplay = animate`
and `el.preload = animate ? "auto" : "metadata"` (`:29-34`). So the small row thumbnail
(`animate:false`) sits **paused on its first frame** — a tall building doesn't spin up N video
decoders at once — while the enlarged **hover tooltip** (`animate:true`) autoplays. A load/decode
error tags the element `da-thumb-error` and logs a `console.warn` (`:25-28`); the CSS then renders a
hatched placeholder (see [Thumbnail states](#thumbnail-states)).

`isVideoPath(path)` (`scripts/da-importer.js:46-51`, exported): strips any `?`/`#` query/hash, takes
the lowercased extension, and returns whether it's in `VIDEO_EXTS`. It's used for both the row
thumbnail and the hover tooltip (`scripts/importer-dialog.js:417`, `:427`), and the tooltip CSS sizes
`img` and `video` identically (`styles/module.css:398-404`).

<a name="thumbnail-states"></a>
**Video thumbnail teardown.** Because detached `<video>` elements keep decoding until GC,
`_teardownThumbVideos()` (`scripts/importer-dialog.js:290-295`) pauses each tracked video, clears its
`src`, and calls `load()` to release it. It runs before the list is rebuilt (`:377`) and on close
(`:598`). The error-state appearance is the `.da-level-thumb.da-thumb-error` rule
(`styles/module.css:374-377`) — a hatched gradient placeholder with a red border instead of a blank
box.

### Import handler & teardown

- **`#onImport`** (`scripts/importer-dialog.js`): reads `folder`/`source` (warns if no
  folder), then **validates elevations** (see below), reads
  `backgroundColor`/`gridAlpha`/`copyImages`/`doorTexture`/`doorSound`, **persists those
  five via `_saveCurrentDefaults(...)`**, then builds `levelOverrides` by reading each row's
  inputs — `name`, `bottom`, `top`, and `isRoof` (`:676-681`). It resolves `initialLevelIndex` from
  `_initialLevelUid` (`:683`) and calls `importFolder(...)` **inside a try/catch** so any unexpected
  failure surfaces a toast instead of an unhandled rejection (`:688-694`), closing on success.
  Note the UI toggle is labelled **"Copy Media to World"** but the param/field is still named
  `copyImages`.
- **Elevation validation (in `#onImport`)** (`scripts/importer-dialog.js:618-627`): before reading any
  other field, it scans every row's `levelBottom[i]`/`levelTop[i]`. A row is flagged only when **both**
  values parse to finite numbers **and** `bottom >= top` (`:622`) — a blank field is left to the
  computed default downstream (always valid), so it is deliberately **not** flagged. If any row is bad
  it shows a `ui.notifications.error` listing the offending indices and returns **without importing**
  (`:624-627`).
- **`_onClose`** (`scripts/importer-dialog.js:596-605`): tears down body dropdowns (`:597`) **and
  video thumbnails** (`:598`), **aborts any in-flight size probe** via `_sizeAbort?.abort()` (`:599`),
  pauses and removes any lingering door/level tooltips — pausing the level tooltip's `<video>` before
  removal (`:600-603`) — then delegates to `super._onClose`.

---

## 5. The Region Adder

Goal: bind a **single** Region document to several **consecutive** levels and attach a native
`changeLevel` behavior, so one shape acts as a transit point (stairs/ladder/elevator) across floors
(`scripts/region-adder.js:1-12`, `:203-212`).

### Helpers (`scripts/region-adder.js`)

- **`getSceneLevels(scene)`** (`:25-37`): returns the scene's levels **sorted ascending by
  `elevation.bottom`** (bottom floor first). It tolerates both a Collection (`.contents`) and a
  plain array, since v14 may hydrate `scene.levels` either way (`:32-34`).
- **`getCurrentLevelId(scene)`** (`:48-62`): best-effort detection of the level being viewed. It
  probes, in order, `canvas.scene.activeLevel._id`, `canvas.environment.activeLevel._id`,
  `canvas.activeLevel._id`, `game.user.activeLevel`, then `scene.initialLevel`, finally falling
  back to the bottom-most level (`:50-56`). These are candidate properties across the v14 canvas
  pipeline; the layered fallback is intentional because the exact source varies with canvas state.
- <a name="region-placement-drag-to-draw"></a>**`pickCanvasRectangle()`** (`:85-201`): the canvas
  placement primitive — **drag-to-draw** as of v0.0.6 (it replaced `pickCanvasPosition`). It resolves
  a normalized world-space rectangle `{x, y, width, height}` (top-left origin, positive dimensions):
  - On `mousedown` it records the press point in both **screen** (`event.clientX/Y`) and **world**
    (`canvas.mousePosition`) coords and, if `canvas.controls` exists, attaches a `PIXI.Graphics`
    live preview to it (`:120-133`).
  - On `mouseup` it measures the screen-pixel travel; a drag **under** `DRAG_THRESHOLD_PX = 8`
    (`:98`) is treated as a **click** → a 1-grid-square rect centered on the press point, while a
    real drag yields the swept rect with each dimension floored at `MIN_WORLD = gridSize/4` (`:99`)
    so it satisfies the schema's strictly-positive requirement (`:141-167`).
  - **Listeners**: capture-phase `mousedown` on the canvas **view**, plus `mousemove`/`mouseup` on
    `document` so a release **outside** the canvas still resolves (`:195-198`, attached after a
    `_pickInProgress` re-entrancy check; the module-level guard at `:14-15` rejects a second
    concurrent placement at `:87-90`).
  - **Live preview** is a `PIXI.Graphics` added to `canvas.controls` — whose children are in world
    coordinates, matching `canvas.mousePosition` — drawn each `mousemove` via the PIXI **v7
    immediate-mode** API (`clear`/`lineStyle`/`beginFill`/`drawRect`/`endFill`; `:106-117`), and
    `eventMode = "none"` so it never intercepts pointer events (`:130`).
  - `Escape` rejects with an `Error("cancelled")` (`:170-176`). Every exit path (commit, Escape,
    error) runs one **idempotent** `cleanup()` (guarded by a `done` flag; `:178-192`) that clears
    `_pickInProgress`, removes all listeners and the `da-region-picking` body class — the latter
    drives the crosshair cursor (`styles/module.css:503-506`) — and destroys the preview graphic.
- **`createMultiLevelRegion({ scene, x, y, width, height, levelIds, name })`** (`:225-284`):
  validates a non-empty `levelIds` (`:226-229`), resolves the matching level objects (`:232-235`),
  computes the region's elevation span as `[min(bottom), max(top)]` over those levels (`:248-249`),
  and builds the region data (see [§3](#region-document)). **Rectangle resolution** (`:237-246`):
  when `width`/`height` are present and **strictly positive finite** (`hasSize`, `:240`) they are
  used as-is with `x,y` as the **top-left**; otherwise it falls back to a **1-grid-square rectangle
  centered on `(x, y)`** (`x - gridSize/2`, `y - gridSize/2`, `width/height = gridSize`; `:241-243`).
  The resolved rect is re-checked for finite, positive dimensions (`:244-246`). It then calls
  `scene.createEmbeddedDocuments("Region", [regionData])` and returns the created document
  (`:282-283`).

> **Correction (v0.0.6):** the rectangle shape no longer emits `anchorX`/`anchorY`/`gridBased` —
> these are **not** valid v14 `RectangleShapeData` fields; only `type`/`x`/`y`/`width`/`height`/
> `hole`/`rotation` are written (`scripts/region-adder.js:260-270`; `CHANGELOG.md:9-10`).

> Single region, not one per floor: `Region.levels` is a Set of ids, so one document appears on
> every requested floor, and `changeLevel` lets the user pick the destination at runtime
> (`scripts/region-adder.js:209-212`).

### Dialog (`scripts/region-adder-dialog.js` + `templates/region-adder.hbs`)

`DARegionAdderDialog` (`scripts/region-adder-dialog.js:19-229`) — also
`HandlebarsApplicationMixin(ApplicationV2)`. `DEFAULT_OPTIONS` (`:20-38`): `id: "da-region-adder"`,
`tag: "form"`, `classes: ["da-region-adder"]`, `width: 420`, `height: "auto"`, single action
`pickLocation → #onPickLocation`. `PARTS` → `templates/region-adder.hbs` (`:40-44`). The single
footer button reads **"Place on Canvas"** (`templates/region-adder.hbs:55-57`), preceded by a hint
spelling out the drag-to-draw interaction — "Click to drop a one-square region, or drag to draw a
larger footprint. Press Escape to cancel." (`templates/region-adder.hbs:52`).

- **`_prepareContext`** (`:55-78`): the ApplicationV2 data-prep stage. If there's no active scene or
  no levels, returns `{ hasScene: false }` (the template then renders the empty state,
  `templates/region-adder.hbs:2-3`). Otherwise computes the current level index, the per-level
  dropdown options (with the current one `selected`), and **`maxUp`/`maxDown`** — how many floors
  exist above/below the current one (`:69-77`). These bound the number inputs
  (`templates/region-adder.hbs:31`, `:42`).
- **`_onRender`** (`:88-102`): wires the starting-level `<select>` `change` (→ `#updateLimits` +
  `#refreshPreview`) and the up/down `input` events (→ `#refreshPreview`), then seeds the preview.
- **`#updateLimits`** (`:122-138`): after the starting level changes, recomputes the up/down maxima
  and clamps the current values so the user can never select out of bounds.
- **`#computeTargetLevelIds`** (`:166-184`): resolves the **contiguous, inclusive** range
  `[idx - down … idx + up]` (clamped to the scene), returning level ids **ascending by elevation**.
- **`#refreshPreview`** (`:144-157`): re-renders the `.da-region-target-list` `<ul>`
  (`templates/region-adder.hbs:49`) with the formatted labels (name + elevation range,
  `#formatLevelLabel` at `:111-115`) of the currently-targeted levels.
- **`#onPickLocation`** (`:198-228`): the action handler. Validates an active scene
  (`:199-203`) and a non-empty target set (`:204-208`), **closes the dialog** (`:210`), prompts the
  user to click or drag (`:211`), awaits **`pickCanvasRectangle()`** (cancel → info notification;
  `:213-219`), then calls `createMultiLevelRegion(...)` **forwarding the resolved
  `width`/`height`** alongside `x`/`y` (`:222`) and notifies success/failure (`:221-227`).

```mermaid
sequenceDiagram
  participant U as User
  participant D as DARegionAdderDialog
  participant H as region-adder.js helpers
  participant S as Scene

  U->>D: DA.AddRegion()
  D->>H: getSceneLevels / getCurrentLevelId
  H-->>D: sorted levels + current id
  D->>U: render (Starting Level, Up, Down, live preview)
  U->>D: adjust → #refreshPreview (#computeTargetLevelIds)
  U->>D: click "Place on Canvas" (#onPickLocation)
  D->>D: validate + this.close()
  D->>H: pickCanvasRectangle() [capture-phase mousedown + document move/up]
  U->>H: click (1-grid) or drag (swept rect) on canvas; live PIXI preview (or Esc → cancel)
  H-->>D: {x, y, width, height}
  D->>H: createMultiLevelRegion({scene, x, y, width, height, levelIds})
  H->>S: scene.createEmbeddedDocuments("Region", [regionData])
  S-->>U: region appears on all target levels (changeLevel behavior)
```

---

## 6. v14-Specific APIs Relied Upon

- **Native Scene Levels.** The whole import targets `scene.levels[]` — the v14 feature that lets one
  Scene hold multiple floors (`scripts/da-importer.js:222-249`, `:308`; read back at `:329`).
  Each level carries `_id`, `elevation`, `background`, `visibility.levels`, `sort`, etc. — the
  full shape in [§3](#scene-level-object).
- **`SceneLevelsSetField` on walls/lights** — the `levels` field (a Set of Level `_id`s) on
  `BaseWall` and `BaseAmbientLight`. The module emits `levels: [levelId]` per document
  (`scripts/da-importer.js:466`, `:503`; rationale at `:1-16`, `:446-457`). The same Set-of-ids
  field exists on `Region` (`scripts/region-adder.js:255`).
- **`initialLevel`** — the Scene field naming the floor shown on load; set from the dialog's star
  selection (`scripts/da-importer.js:309`) and consulted as a fallback by `getCurrentLevelId`
  (`scripts/region-adder.js:55`).
- **`visibility.levels`** on a Level — controls which other floors are co-visible when that level is
  active; the importer populates it only from the roof shortcut (`scripts/da-importer.js:254-259`),
  leaving finer cross-level visibility to the native v14 Levels tab.
- **`game.settings.register` / `get` / `set`** — a **client-scoped, `config:false`** setting
  (`SETTING_IMPORTER_DEFAULTS`) registered on `init` (`scripts/main.js:8-13`) and read/written by the
  dialog to remember last-used selections across opens (`scripts/importer-dialog.js:149`, `:169`).
- **`foundry.applications.apps.FilePicker.implementation`** — the v14 FilePicker entry point, used
  for `browse`, `createDirectory`, and `upload` (`scripts/da-importer.js:81`, `:119`, `:145`;
  `scripts/importer-dialog.js:91`). Probing existence via `browse` throwing is an intentional
  idiom (`scripts/da-importer.js:92-98`).
- **`foundry.applications.api.ApplicationV2` + `HandlebarsApplicationMixin`** — both dialogs are
  ApplicationV2 (`scripts/importer-dialog.js:4`, `:42`; `scripts/region-adder-dialog.js:8`, `:19`).
  This brings the `static PARTS` template system, the `static DEFAULT_OPTIONS.actions` click map
  (handlers invoked with `this` bound to the instance), and lifecycle stages `_prepareContext` /
  `_onRender` / `_onClose`.
- **ApplicationV2 render hook signature** — `renderSceneDirectory` passes a raw `HTMLElement`, which
  `main.js` uses with `querySelector`/`insertBefore` (`scripts/main.js:32-48`).
- **`CONFIG.Wall.doorSounds`** — the registry mapping door-sound keys to `{ open, close }` file
  paths; used for the sound preview (`scripts/importer-dialog.js:133-136`). The selected key is
  also stamped onto door walls as `doorSound` (`scripts/da-importer.js:470`).
- **`foundry.audio.AudioHelper.play(...)`** — plays the door-sound preview
  (`scripts/importer-dialog.js:136`).
- **`foundry.utils.randomID()`** — generates Level `_id`s (`scripts/da-importer.js:230`).
- **`scene.createEmbeddedDocuments("Region", ...)`** with a `changeLevel` **Region Behavior**
  (`type: "changeLevel"`) — the native multi-level transit mechanism
  (`scripts/region-adder.js:271-282`).
- **`Scene.create(...)`** — top-level Scene creation (`scripts/da-importer.js:318`).
- **Canvas access** — `canvas.scene`, `canvas.mousePosition`, `canvas.app.view`, `canvas.controls`
  (the world-coordinate layer hosting the drag preview), and the candidate `*.activeLevel`
  properties for current-level detection (`scripts/region-adder.js:50-56`, `:91`, `:97`, `:126`,
  `:128-131`).
- **`PIXI` (v7) immediate-mode `Graphics`** — the live drag-to-draw preview is a `PIXI.Graphics`
  drawn with `clear`/`lineStyle`/`beginFill`/`drawRect`/`endFill` and made non-interactive via
  `eventMode = "none"` (`scripts/region-adder.js:106-117`, `:128-131`).

> **Uncertainty noted:** `getCurrentLevelId` probes *several* candidate `activeLevel` locations
> precisely because the authoritative source isn't fixed across v14 canvas states
> (`scripts/region-adder.js:48-62`). Likewise `getSceneLevels` handles both Collection and array
> shapes (`:32-34`). These are deliberate hedges against v14 API surface that the code treats as not
> fully settled — not signs of a bug.

---

## 7. Extension Points — Where to Change Things

- **Support a new background format.** Add the extension to `IMAGE_EXTS` or `VIDEO_EXTS`
  (`scripts/da-importer.js:27-28`); `MEDIA_EXTS` (`:29`), the pairing filter (`:352`), `isVideoPath`
  (`:46-51`), and `_buildThumbEl` (`scripts/importer-dialog.js:21-40`) all derive from those two
  arrays, so a one-line change propagates. **Also add it to `MEDIA_PRIORITY`**
  (`scripts/da-importer.js:36`), which decides which file wins when a floor ships several — a new
  extension absent from that list ranks `Infinity` (least-preferred) and would never be chosen over
  a listed sibling.
- **Change floor pairing / sorting.** The suffix regex is `FLOOR_RE` (`scripts/da-importer.js:20`),
  consumed by `collectFloorPairs` (`:377`), `_commonStem` (`:399`), and `distinctMapStems` (`:415`).
  Pairing logic, the one-media-per-floor `MEDIA_PRIORITY` rule, and the orphan-warning live in
  `collectFloorPairs` (`:344-390`); the sort comparator is at `:388`.
- **Change mixed-folder detection.** `distinctMapStems(pairs)` (`scripts/da-importer.js:414-416`) is
  the only place the "one map per folder" heuristic is computed; the warn-but-proceed call is in
  `importFolder` (`:165-168`). Loosen/tighten the normalization there, or change it from a warning to
  a hard block.
- **Add / change door options.** Door **texture** options are template `<option>`s
  (`templates/importer.hbs:73-100`); door **sound** options at `:111-134` (values must be valid
  `CONFIG.Wall.doorSounds` keys). The application of texture/sound to door walls is in `_mapWall`
  (`scripts/da-importer.js:468-471`) — change the animation `type` or add new door doc fields here.
- **Add a per-level field (Levels tab).** Three coordinated edits: (1) render the input in the
  first pass of `_populateLevelsTab` and extend the header columns
  (`scripts/importer-dialog.js:393-400`, `:404-489`) — and update the CSS grid template
  `grid-template-columns` at `styles/module.css:266`; (2) read it into `levelOverrides` in
  `#onImport` (`scripts/importer-dialog.js:638-649`); (3) consume it when building `levels[]` in
  `importFolder` (`scripts/da-importer.js:222-263`).
- **Tune the large-media warning.** The threshold is `MEDIA_SIZE_WARN_BYTES`
  (`scripts/constants.js:20`). The probe (HEAD request, local-source gating, abort/generation
  bookkeeping) is `_probeMediaSizes` (`scripts/importer-dialog.js:311-340`) and the per-thumb badge
  is `_applySizeBadge` (`:352-363`); the amber outline is `styles/module.css:380-383`.
- **Change elevation validation.** The bottom-`>=`-top guard is in `#onImport`
  (`scripts/importer-dialog.js:618-627`) — adjust the predicate (`:622`) or the message.
- **Persist a new dialog default.** Add the field to the `_saveCurrentDefaults({...})` payload and
  call site (`scripts/importer-dialog.js:167-173`, `:636`) and restore it in `_restoreSavedDefaults`
  (`:145-164`). The setting itself is registered in `init` (`scripts/main.js:8-13`); its key is
  `SETTING_IMPORTER_DEFAULTS` (`scripts/constants.js:14`).
- **Change default elevation math.** `FLOOR_HEIGHT` (`scripts/constants.js:8`) is the single source;
  the default formulas appear in three places that must stay consistent: the importer
  (`scripts/da-importer.js:225-226`), the row seeds (`scripts/importer-dialog.js:406-407`), and the
  uniform-height recompute (`scripts/importer-dialog.js:255-256`).
- **Change Scene-wide defaults** (grid style, fog, environment/global-light, padding). Edit the
  `sceneData` literal in `importFolder` (`scripts/da-importer.js:277-312`).
- **Change wall sense/movement mapping.** `_senseEnum` (`scripts/da-importer.js:426-430`, for
  sight/sound) and `_moveEnum` (`:442-444`, for movement) are the only places DA's 0/1/2 scheme is
  translated to Foundry's `WALL_SENSE_TYPES` / `WALL_MOVEMENT_TYPES` enums; they are wired up in
  `_mapWall` (`:461-463`).
- **Change light defaults.** `_mapLight` (`scripts/da-importer.js:485-505`) — e.g. enable vision,
  add animation, or change `luminosity`/`coloration`.
- **Change region shape / behavior / color.** `createMultiLevelRegion`
  (`scripts/region-adder.js:225-284`): the rectangle resolution / 1-grid fallback (`:237-246`), the
  emitted rectangle shape (`:260-270`), the `changeLevel` behavior block (`:271-279`), color (`:253`),
  or elevation span (`:248-249`). The drag-to-draw interaction itself (threshold, preview, min size)
  is `pickCanvasRectangle` (`:85-201`). To change how the target range is chosen, edit
  `#computeTargetLevelIds` (`scripts/region-adder-dialog.js:166-184`).
- **Add a new dialog action / button.** Add an entry to the relevant `DEFAULT_OPTIONS.actions` map
  (`scripts/importer-dialog.js:77-81` or `scripts/region-adder-dialog.js:35-37`) and a matching
  `data-action="..."` element in the template.
- **Module identity.** `MODULE_ID` (`scripts/constants.js:2`) must match `module.json:2`; the
  template paths in `PARTS` are hard-coded to `modules/dungeon-alchemist-toolkit/...`
  (`scripts/importer-dialog.js:87`, `scripts/region-adder-dialog.js:42`) and would need updating if
  the id changes.

---

*Originally generated from source at v0.0.6; correctness-updated for the v0.1.0 relaunch. Keep
`file:line` references in sync when the source changes.*
