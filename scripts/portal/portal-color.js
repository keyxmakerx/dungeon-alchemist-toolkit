/**
 * Per-link colour. Hash a portal link's id to a stable hue so each linked
 * stair/portal/trap pair draws in its own consistent colour across its markers,
 * connecting line, midpoint label, and cross-floor badge. Pure functions, no
 * Foundry dependencies — stable across reloads (the input is the persisted linkId).
 */

/** FNV-1a 32-bit hash of a string → unsigned 32-bit int. */
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable hue 0..359 for a link id. */
export function linkHue(linkId) {
  return hashStr(String(linkId ?? "")) % 360;
}

/** HSL → packed 0xRRGGBB int. h in [0,360), s/l in [0,1]. */
function hslToRgbInt(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

/**
 * Stable display colour (packed int) for a link id, tuned for a dark canvas.
 * @param {string} linkId
 * @param {{saturation?:number, lightness?:number}} [opts]
 * @returns {number}
 */
export function linkColor(linkId, { saturation = 0.65, lightness = 0.55 } = {}) {
  return hslToRgbInt(linkHue(linkId), saturation, lightness);
}
