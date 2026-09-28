export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

/**
 * Maps document pixels to canvas CSS pixels: screen = doc · zoom + pan (FR-NAV-01/02). Pure, so it is
 * unit-tested without a GPU.
 */
export class Viewport {
  zoom = 1;
  panX = 0;
  panY = 0;

  docToScreen(x: number, y: number): [number, number] {
    return [x * this.zoom + this.panX, y * this.zoom + this.panY];
  }

  screenToDoc(sx: number, sy: number): [number, number] {
    return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom];
  }

  /** Zooms by `factor` keeping the document point under (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const [dx, dy] = this.screenToDoc(sx, sy);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.panX = sx - dx * this.zoom;
    this.panY = sy - dy * this.zoom;
  }

  setZoomCentered(zoom: number, viewW: number, viewH: number): void {
    this.zoomAt(zoom / this.zoom, viewW / 2, viewH / 2);
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  /** Fits the document inside the view with padding, never enlarging above 100 %. */
  fit(docW: number, docH: number, viewW: number, viewH: number, padding = 24): void {
    const scale = Math.min((viewW - padding * 2) / docW, (viewH - padding * 2) / docH, 1);
    this.zoom = Math.max(MIN_ZOOM, scale);
    this.panX = Math.round((viewW - docW * this.zoom) / 2);
    this.panY = Math.round((viewH - docH * this.zoom) / 2);
  }

  /**
   * Column-major 3×3 matrix mapping document pixels to clip space for a canvas of viewW×viewH CSS pixels
   * (y flipped: screen y grows down, clip y grows up).
   */
  docToClip(viewW: number, viewH: number): Float32Array {
    const sx = (2 * this.zoom) / viewW;
    const sy = (-2 * this.zoom) / viewH;
    const tx = (2 * this.panX) / viewW - 1;
    const ty = 1 - (2 * this.panY) / viewH;
    return new Float32Array([sx, 0, 0, 0, sy, 0, tx, ty, 1]);
  }

  /** Document-space rectangle currently visible (for culling tiles). */
  visibleDocRect(viewW: number, viewH: number): { x0: number; y0: number; x1: number; y1: number } {
    const [x0, y0] = this.screenToDoc(0, 0);
    const [x1, y1] = this.screenToDoc(viewW, viewH);
    return { x0, y0, x1, y1 };
  }
}
