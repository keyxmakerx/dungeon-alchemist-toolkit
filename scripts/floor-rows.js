/**
 * Shared floor-row building blocks used by the importer and the Level Manager
 * dashboard. Extracted from importer-dialog.js (Phase 0) so the dashboard can
 * reuse the thumbnail builder without depending on that dialog — which is retired
 * once import folds into the dashboard.
 */

import { isVideoPath } from "./da-importer.js";

/**
 * Build a thumbnail element for a floor's background media path.
 *
 * Video backgrounds (webm/mp4/m4v) use a muted, looping, inline <video>; still
 * images use a plain <img>. Pass `animate:true` to autoplay the video (used for
 * the enlarged hover preview); the default leaves it paused on its first frame
 * (`preload:"metadata"`) so a column of many floors doesn't run N decoders at
 * once. A load/decode error tags the element `da-thumb-error` and warns.
 *
 * @param {string} src                    Media path/URL.
 * @param {string} className              Class to apply (empty = none).
 * @param {object} [opts]
 * @param {boolean} [opts.animate=false]  Autoplay video (vs. paused first frame).
 * @returns {HTMLImageElement|HTMLVideoElement}
 */
export function buildThumb(src, className, { animate = false } = {}) {
  const isVideo = isVideoPath(src);
  const el = document.createElement(isVideo ? "video" : "img");
  if (className) el.className = className;
  el.addEventListener("error", () => {
    el.classList.add("da-thumb-error");
    console.warn(`[DA Toolkit] could not load thumbnail media: ${src}`);
  });
  if (isVideo) {
    el.muted = true;
    el.loop = true;
    el.playsInline = true;
    el.autoplay = animate;
    el.preload = animate ? "auto" : "metadata";
  } else {
    el.alt = "";
  }
  el.src = src;
  return el;
}
