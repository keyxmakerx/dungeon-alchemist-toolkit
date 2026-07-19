/**
 * Dungeon Alchemist folder → floor grouping (pure, Foundry-free).
 *
 * Extracted from da-importer.js so the folder-parsing contract — "a folder is one
 * map; every image+JSON pair is one floor of it" — can be unit-tested in isolation
 * (see test/floor-grouping.test.mjs). Nothing here touches Foundry globals.
 *
 * DA exports a multi-floor map as sibling pairs of one media file (image or video)
 * + a `.json`, one pair per floor. The canonical filename suffix is `-_NN`
 * ("Inn by the Lake-_03"), but exports/renames in the wild also use `_N`, `-N`,
 * " - N", or none — so ordering tolerates any trailing number, while the genuine
 * "two maps in one folder" warning keys strictly off the canonical suffix.
 */

// Canonical Dungeon Alchemist floor suffix: "-_NN" (e.g. "Inn by the Lake-_03").
// DA writes one media+JSON pair per floor with this exact suffix.
const DA_FLOOR_RE = /-_(\d+)$/;
// Generalized trailing floor number: tolerates any separator — or none — before
// the digits ("-_3", "_3", "-3", " - 3", " 3", "3"). Used ONLY to recover floor
// ORDER for non-standard exports; it never decides how many maps a folder holds.
const FLOOR_INDEX_RE = /^(.*?)[\s._-]*(\d+)$/;
// Folder names too generic to name a scene after (fall through to other signals).
const GENERIC_DIRS = /^(data|public|worlds|assets|maps|exports?|dungeon ?alchemist|da)$/i;

/**
 * Background media accepted alongside each floor's `.json`. Foundry can use any
 * of these as a Scene Level `background.src`; the VIDEO_EXTS render as animated
 * textures, the IMAGE_EXTS as static backgrounds.
 */
export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];
export const VIDEO_EXTS = ["webm", "mp4", "m4v"];
export const MEDIA_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];

/**
 * Preference order when a single floor ships more than one media file (e.g. a
 * `.jpg` and a `.webp`, or a still image alongside an animated video). Earlier =
 * preferred: animated video wins outright, then the most efficient still formats.
 */
export const MEDIA_PRIORITY = ["webm", "mp4", "m4v", "webp", "png", "jpeg", "jpg"];

/**
 * Whether a path points to a video Foundry renders as an animated texture
 * (rather than a static image). Lets the dialog choose a <video> over an <img>
 * for a floor's thumbnail.
 *
 * @param {string} path  File path or URL (trailing query/hash tolerated).
 * @returns {boolean}
 */
export function isVideoPath(path) {
  const clean = String(path).split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  const ext = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
  return VIDEO_EXTS.includes(ext);
}

/**
 * Convert an arbitrary filename stem to strict kebab-case.
 * Replaces accented/special characters with ASCII equivalents,
 * then collapses any non-alphanumeric run into a single hyphen.
 *
 * @param {string} name  Raw filename stem (no extension).
 * @returns {string}     Normalized kebab-case stem.
 */
export function toKebab(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Split a filename stem into its map "base" and floor "index". The canonical DA
 * suffix (`-_NN`) wins and marks the pair `canonical`; otherwise any trailing
 * number (with or without a separator) is read purely for ordering; otherwise
 * there is no index.
 *
 * @param {string} stem  Filename stem (no extension).
 * @returns {{base:string, index:(number|null), canonical:boolean}}
 */
function _floorParts(stem) {
  const canon = stem.match(DA_FLOOR_RE);
  if (canon) return { base: stem.slice(0, canon.index).trim(), index: parseInt(canon[1], 10), canonical: true };
  const loose = stem.match(FLOOR_INDEX_RE);
  if (loose) return { base: loose[1].replace(/[\s._-]+$/, "").trim(), index: parseInt(loose[2], 10), canonical: false };
  return { base: stem.trim(), index: null, canonical: false };
}

/**
 * Pair `.json` files with sibling image/video files and order them into floors.
 * A folder is one map, so this never splits the files — it only groups each
 * `.json` with its media sibling and sorts the resulting floors. Exported so the
 * importer dialog can preview and reorder the pairs before the full import.
 *
 * Ordering: if any floor exposes a trailing number it sorts ascending by that
 * number (numeric, not lexical — `Map_10` follows `Map_2`); floors without a
 * number, and ties, keep their discovery order (a stable sort, so a floor is
 * never dropped). If no floor has a number, discovery order is preserved.
 *
 * @param {string[]} files  Full URLs returned by FilePicker.browse().
 * @returns {{stem:string, base:string, index:(number|null), canonical:boolean, json:string, media:string}[]}
 */
export function collectFloorPairs(files) {
  const byStem = new Map();
  const order = [];
  for (const f of files) {
    const base = decodeURIComponent(f.split("/").pop());
    const dot = base.lastIndexOf(".");
    if (dot < 0) continue;
    const stem = base.slice(0, dot);
    const ext = base.slice(dot + 1).toLowerCase();
    if (ext !== "json" && !MEDIA_EXTS.includes(ext)) continue;
    if (!byStem.has(stem)) { byStem.set(stem, {}); order.push(stem); }
    const entry = byStem.get(stem);
    if (ext === "json") {
      entry.json = f;
    } else {
      // One media file per floor. When several are present, keep the
      // highest-priority extension (lower MEDIA_PRIORITY index) so the choice is
      // deterministic regardless of the order FilePicker returns files in.
      const rank = MEDIA_PRIORITY.indexOf(ext);
      const curRank = entry.imgExt ? MEDIA_PRIORITY.indexOf(entry.imgExt) : Infinity;
      if (rank < curRank) {
        entry.img = f;
        entry.imgExt = ext;
      }
    }
  }

  const pairs = [];
  const orphans = [];
  // Iterate in discovery order so the tiebreak below is stable and reproducible.
  order.forEach((stem, seq) => {
    const entry = byStem.get(stem);
    if (!entry.json || !entry.img) {
      orphans.push(`${stem} — ${entry.json ? "JSON with no image/video" : "image/video with no JSON"}`);
      return;
    }
    const parts = _floorParts(stem);
    pairs.push({ stem, base: parts.base, index: parts.index, canonical: parts.canonical, seq, json: entry.json, media: entry.img });
  });
  if (orphans.length) {
    console.warn(`[DA Importer] skipped ${orphans.length} unpaired file(s):`, orphans);
  }
  const anyIndex = pairs.some((p) => p.index !== null);
  pairs.sort((a, b) => {
    if (anyIndex) {
      const ai = a.index ?? Number.MAX_SAFE_INTEGER;
      const bi = b.index ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
    }
    return a.seq - b.seq;
  });
  // Carry the orphan list so importFolder can surface it to the GM (the dialog
  // ignores this property).
  pairs.orphans = orphans;
  return pairs;
}

/**
 * Longest common prefix (character-wise) across a list of strings.
 *
 * @param {string[]} strs
 * @returns {string}
 */
function _lcp(strs) {
  if (!strs.length) return "";
  let p = strs[0];
  for (const s of strs.slice(1)) {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}

/**
 * The browsed folder's own name, or "" if it's absent or too generic to name a
 * scene after (a bucket root, `data`, `worlds`, an `exports` dump, etc.).
 *
 * @param {string} path  Folder path (may have a trailing slash / URL-encoding).
 * @returns {string}
 */
function _folderName(path) {
  const seg = decodeURIComponent(String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "").trim();
  return GENERIC_DIRS.test(seg) ? "" : seg;
}

/**
 * The map (scene) name. A folder is one map, so prefer a name shared by the
 * floors. Precedence: (1) the base shared by canonical `-_NN` floors — DA writes
 * the map name into those; (2) the browsed folder name — the folder IS the map;
 * (3) the common filename prefix; (4) the first floor's base; (5) a default.
 *
 * @param {{base?:string, stem?:string, canonical?:boolean}[]} pairs
 * @param {string} [folderPath=""]
 * @returns {string}
 */
export function mapName(pairs, folderPath = "") {
  const canonBases = [...new Set(pairs.filter((p) => p.canonical).map((p) => p.base).filter(Boolean))];
  if (canonBases.length === 1) return canonBases[0];
  const folder = _folderName(folderPath);
  if (folder) return folder;
  const common = _lcp(pairs.map((p) => p.base || p.stem || "").filter(Boolean)).replace(/[\s._-]+$/, "").trim();
  if (common) return common;
  return pairs.find((p) => p.base)?.base || "Dungeon Alchemist Map";
}

/**
 * Distinct DA map base-names among floors carrying the CANONICAL `-_NN` suffix
 * (kebab-normalized so case/accents don't create false positives). More than one
 * entry is the genuine "two DA maps dumped in one folder" signature. Loose or
 * custom-named floors never count — a folder is contractually one map — so this
 * no longer false-positives on alternative numbering or custom per-floor names.
 *
 * @param {{base?:string, canonical?:boolean}[]} pairs
 * @returns {string[]} Unique normalized canonical base-names (may be empty).
 */
export function distinctMapStems(pairs) {
  return [...new Set(pairs.filter((p) => p.canonical).map((p) => toKebab(p.base)).filter(Boolean))];
}
