/**
 * Shared canvas label/badge builder (PIXI v7).
 *
 * One implementation behind both overlays: the player overlay's sight-gated "Stairs"
 * hint and the GM overlay's same-floor midpoint labels + cross-floor ↑/↓ badges. A
 * `PIXI.Text` over a rounded-rect background, anchored above its centre point.
 *
 * Pure presentation — no Foundry document access. The caller adds the returned
 * container to its own layer (it's positioned at `center`).
 *
 * @param {{x:number,y:number}} center  World coords the label sits above.
 * @param {string} text
 * @param {object} [opts]
 * @param {number}  [opts.bg=0x000000]        Background fill colour.
 * @param {number}  [opts.bgAlpha=0.5]        Background fill alpha.
 * @param {number}  [opts.fill=0xffffff]      Text colour.
 * @param {number}  [opts.fontSize=16]
 * @param {number}  [opts.offsetY=-10]        Vertical offset of the text from `center`.
 * @param {boolean} [opts.interactive=false]  Hover-scale + clickable.
 * @param {string}  [opts.cursor="help"]      Cursor when interactive.
 * @param {(ev:any)=>void} [opts.onClick]     Pointerdown handler when interactive.
 * @returns {PIXI.Container}
 */
export function drawCanvasLabel(center, text, opts = {}) {
  const {
    bg = 0x000000, bgAlpha = 0.5, fill = 0xffffff, fontSize = 16,
    offsetY = -10, interactive = false, cursor = "help", onClick = null
  } = opts;

  const cont = new PIXI.Container();
  cont.x = center.x;
  cont.y = center.y;

  const label = new PIXI.Text(String(text), {
    fontFamily: "Signika, sans-serif",
    fontSize,
    fill,
    stroke: 0x000000,
    strokeThickness: 3,
    align: "center"
  });
  label.anchor.set(0.5, 1);
  label.y = offsetY;

  const padX = 6;
  const padY = 3;
  const bgGfx = new PIXI.Graphics();
  bgGfx.beginFill(bg, bgAlpha);
  bgGfx.drawRoundedRect(
    -label.width / 2 - padX,
    offsetY - label.height - padY,
    label.width + padX * 2,
    label.height + padY * 2,
    4
  );
  bgGfx.endFill();

  cont.addChild(bgGfx, label);

  if (interactive) {
    cont.eventMode = "static";
    cont.cursor = cursor;
    cont.on("pointerover", () => cont.scale.set(1.08));
    cont.on("pointerout", () => cont.scale.set(1));
    if (onClick) cont.on("pointerdown", onClick);
  }
  return cont;
}
