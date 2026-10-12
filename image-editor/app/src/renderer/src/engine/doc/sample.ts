import type { Document, Layer } from './document';
import { compositePixel, liveLayers } from './flatten';

export type SampleSize = 1 | 3 | 5;
export type SampleSource = 'layer' | 'all';
export type RGB = [number, number, number];

/**
 * Eyedropper (FR-PNT-06): the colour at (x, y), averaged over a size×size square clipped to the canvas.
 * 'all' samples the visible composite; 'layer' samples the active layer's own pixels (a group: its contents,
 * ignoring its opacity and blend mode). Averages are alpha-weighted, so transparent pixels don't darken the
 * result. Null when every sampled pixel is transparent.
 */
export function sampleColor(
  doc: Document,
  x: number,
  y: number,
  size: SampleSize,
  source: SampleSource,
): RGB | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= doc.width || cy >= doc.height) return null;
  const layers = source === 'all' ? liveLayers(doc.layers) : liveLayers([plain(doc.activeLayer)]);
  const half = (size - 1) / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let py = Math.max(0, cy - half); py <= Math.min(doc.height - 1, cy + half); py++) {
    for (let px = Math.max(0, cx - half); px <= Math.min(doc.width - 1, cx + half); px++) {
      const [pr, pg, pb, pa] = compositePixel(layers, px, py);
      r += pr * pa;
      g += pg * pa;
      b += pb * pa;
      a += pa;
    }
  }
  if (a === 0) return null;
  return [Math.round(r / a), Math.round(g / a), Math.round(b / a)];
}

/** The layer as if visible, opaque and Normal (its own pixels only). */
function plain(layer: Layer): Layer {
  return layer.type === 'group'
    ? { ...layer, visible: true, opacity: 1, fillOpacity: 1, blendMode: 'normal', passThrough: false }
    : { ...layer, visible: true, opacity: 1, fillOpacity: 1, blendMode: 'normal' };
}
