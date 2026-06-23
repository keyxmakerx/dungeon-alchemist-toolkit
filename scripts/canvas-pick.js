/**
 * Canvas rectangle picker shared by the legacy region tool and the stairs/portal
 * wizard. Relocated verbatim from `region-adder.js` (Phase 0). Lets the user click
 * (drops a 1-grid square) or drag (sweeps a rectangle) to place a region
 * footprint, with a live preview; Escape cancels. `region-adder.js` re-exports it
 * for backward compatibility.
 */

/** Guards against two concurrent canvas placements double-binding listeners. */
let _pickInProgress = false;

/**
 * Let the user place a region by clicking or dragging on the canvas, resolving
 * with a normalized world-space rectangle `{x, y, width, height}` (top-left
 * origin, positive dimensions). A plain click (drag travel under the
 * screen-pixel threshold) yields a 1-grid-square rectangle centered on the
 * press point; a drag yields the swept rectangle. Pressing Escape rejects with
 * `"cancelled"`.
 *
 * Implementation notes:
 * - Listeners are attached in capture phase so they pre-empt Foundry's own
 *   canvas pointer handlers (avoiding token selection / pan). `mousemove` and
 *   `mouseup` live on `document` so a release outside the canvas still resolves.
 * - The live preview is a `PIXI.Graphics` added to `canvas.controls`, whose
 *   children are in world coordinates (matching `canvas.mousePosition`); it is
 *   non-interactive (`eventMode = "none"`) and destroyed by the single
 *   idempotent `cleanup()` run on every exit path (commit, Escape, error).
 * - v14 uses PIXI v7, so the preview uses the immediate-mode Graphics API
 *   (`beginFill`/`drawRect`/`endFill`/`clear`).
 *
 * @returns {Promise<{x:number, y:number, width:number, height:number}>}
 */
export function pickCanvasRectangle() {
  return new Promise((resolve, reject) => {
    if (_pickInProgress) {
      reject(new Error("A region placement is already in progress."));
      return;
    }
    const view = canvas.app?.view ?? canvas.app?.canvas;
    if (!view) {
      reject(new Error("Canvas view is not available."));
      return;
    }

    const gridSize = canvas.scene?.grid?.size ?? 100;
    const DRAG_THRESHOLD_PX = 8;     // screen-pixel travel below which a drag is a click
    const MIN_WORLD = gridSize / 4;  // floor for a dragged dimension (schema requires > 0)

    let startWorld = null;   // {x,y} world coords at mousedown
    let startScreen = null;  // {x,y} screen coords at mousedown
    let preview = null;      // PIXI.Graphics live preview (null if controls layer absent)
    let done = false;

    const drawPreview = (a, b) => {
      if (!preview) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      preview.clear();
      preview.lineStyle(2, 0xb0cc28, 1);
      preview.beginFill(0xb0cc28, 0.15);
      preview.drawRect(x, y, w, h);
      preview.endFill();
    };

    /** @param {MouseEvent} event */
    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      startScreen = { x: event.clientX, y: event.clientY };
      const p = canvas.mousePosition;
      startWorld = { x: p.x, y: p.y };
      if (canvas.controls) {
        preview = new PIXI.Graphics();
        preview.eventMode = "none";
        canvas.controls.addChild(preview);
      }
    };

    const onMouseMove = () => {
      if (!startWorld) return;
      drawPreview(startWorld, canvas.mousePosition);
    };

    /** @param {MouseEvent} event */
    const onMouseUp = (event) => {
      if (event.button !== 0 || !startWorld) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const p = canvas.mousePosition;
      const dragPx = Math.hypot(event.clientX - startScreen.x, event.clientY - startScreen.y);

      let rect;
      if (dragPx < DRAG_THRESHOLD_PX) {
        // Treat as a click: a 1-grid-square region centered on the press point.
        rect = { x: startWorld.x - gridSize / 2, y: startWorld.y - gridSize / 2, width: gridSize, height: gridSize };
      } else {
        const x = Math.min(startWorld.x, p.x);
        const y = Math.min(startWorld.y, p.y);
        const w = Math.max(Math.abs(p.x - startWorld.x), MIN_WORLD);
        const h = Math.max(Math.abs(p.y - startWorld.y), MIN_WORLD);
        rect = { x, y, width: w, height: h };
      }
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
        cleanup();
        reject(new Error("Invalid placement coordinates."));
        return;
      }
      cleanup();
      resolve(rect);
    };

    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      reject(new Error("cancelled"));
    };

    const cleanup = () => {
      if (done) return;   // idempotent — safe to call from any exit path
      done = true;
      _pickInProgress = false;
      view.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("da-region-picking");
      if (preview) {
        preview.parent?.removeChild(preview);
        preview.destroy();
        preview = null;
      }
    };

    _pickInProgress = true;
    view.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("da-region-picking");
  });
}
