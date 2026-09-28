import { describe, expect, it } from 'vitest';
import { accumulateDabs, applyStroke, DEFAULT_BRUSH, type BrushSettings, type Dab } from '../brush/brush';
import { createRasterLayer, Document } from '../doc/document';
import { Viewport } from '../render/viewport';
import { TILE_SIZE, TileGrid } from '../tiles/tile';
import { Compositor } from './compositor';
import { StrokeBuffer } from './stroke-buffer';

function context(width: number, height: number): WebGL2RenderingContext {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('WebGL2 unavailable');
  return gl;
}

const dabs: Dab[] = [
  { x: 100.3, y: 90.7, radius: 40, alpha: 0.6 },
  { x: 130, y: 110, radius: 25.5, alpha: 0.9 },
  { x: 250, y: 250, radius: 12, alpha: 1 }, // crosses into neighbouring tiles
];

describe('GPU conformance (shader vs CPU reference, docs/07 §1)', () => {
  it.each([0, 0.5, 1])('dab shader matches accumulateDabs at hardness %s', (hardness) => {
    const gl = context(4, 4);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    stroke.hardness = hardness;
    const keys = stroke.addDabs(dabs, 600, 600);
    expect(keys.sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    for (const key of keys) {
      const [tx, ty] = key.split(',').map(Number) as [number, number];
      const cpu = new Float32Array(TILE_SIZE * TILE_SIZE);
      accumulateDabs(cpu, tx, ty, dabs, hardness);
      const gpu = stroke.readCoverage(key);
      let maxErr = 0;
      for (let i = 0; i < cpu.length; i++) maxErr = Math.max(maxErr, Math.abs(cpu[i]! - gpu[i]!));
      expect(maxErr, `tile ${key}`).toBeLessThan(2e-3); // half-float precision
    }
  });

  it('live preview composite matches the CPU commit + composite within ±2/255', () => {
    const size = 300;
    const gl = context(size, size);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    const settings: BrushSettings = {
      ...DEFAULT_BRUSH,
      color: [200, 30, 60],
      opacity: 0.7,
      hardness: 0.6,
      mode: 'paint',
    };
    stroke.hardness = settings.hardness;

    // White background + a semi-transparent layer with a gradient, painted with the preview on top.
    const doc = new Document(
      size,
      size,
      createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
    );
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        rgba.set([x % 256, y % 256, 128, 40 + ((x + y) % 200)], (y * size + x) * 4);
    const layer = createRasterLayer('paint', TileGrid.fromRgba(size, size, rgba));
    layer.opacity = 0.8;
    doc.layers.push(layer);
    stroke.addDabs(dabs, size, size);

    const viewport = new Viewport(); // zoom 1, pan 0 → 1 document px = 1 device px
    compositor.render(
      doc,
      viewport,
      { cssWidth: size, cssHeight: size, width: size, height: size, dpr: 1 },
      {
        buffer: stroke,
        layerId: layer.id,
        settings,
      },
    );
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // CPU: commit the same stroke, then composite.
    for (const key of stroke.keys()) {
      const [tileX, tileY] = key.split(',').map(Number) as [number, number];
      const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
      accumulateDabs(cov, tileX, tileY, dabs, settings.hardness);
      layer.tiles.set(
        key,
        applyStroke(layer.tiles.get(key), cov, settings, { tileX, tileY, docWidth: size, docHeight: size }),
      );
    }
    let maxErr = 0;
    for (let y = 0; y < size; y += 3) {
      for (let x = 0; x < size; x += 3) {
        const expected = doc.compositePixel(x, y);
        const i = ((size - 1 - y) * size + x) * 4; // readPixels rows are bottom-up
        for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(pixels[i + c]! - expected[c]!));
      }
    }
    expect(maxErr).toBeLessThanOrEqual(2);
  });
});
