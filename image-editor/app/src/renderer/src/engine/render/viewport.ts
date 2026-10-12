export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

/** Zoom In / Zoom Out steps (FR-NAV-01), as in Photoshop: 1 % … 6400 %. */
export const ZOOM_STEPS = [
  0.01, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7,
  8, 12, 16, 32, 64,
];

/** The next zoom step above (+1) or below (−1) `zoom`; a zoom between steps snaps to the neighbour. */
export function nextZoomStep(zoom: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom * (1 + eps)) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom * (1 - eps)) ?? MIN_ZOOM;
}

/** Zoom at which the pixel grid appears (FR-NAV-01: ≥ 800 %). */
export const PIXEL_GRID_ZOOM = 8;

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

/**
 * Scrollbar geometry for one axis (FR-NAV-02), CSS px: the document (`size` px at the current zoom) can scroll
 * until its edge reaches the middle of the view. `offset` ∈ [0, size]; `thumb` and `start` are fractions of
 * the track.
 */
export function scrollGeometry(size: number, pan: number, viewSize: number) {
  const total = size + viewSize;
  const max = size;
  const offset = Math.min(max, Math.max(0, viewSize / 2 - pan));
  return { total, max, offset, thumb: viewSize / total, start: offset / total };
}
