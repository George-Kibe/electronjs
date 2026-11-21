import { describe, expect, it, vi } from 'vitest';
import {
  accumulateDabs,
  applyMaskStroke,
  applySelectionStroke,
  applyStroke,
  DabGenerator,
  DEFAULT_BRUSH,
  type BrushSettings,
  type Dab,
} from '../brush/brush';
import { IMPLEMENTED_BLEND_MODES } from '../doc/blend';
import { createGroupLayer, createRasterLayer, Document } from '../doc/document';
import { compositePixel, liveLayers } from '../doc/flatten';
import { ellipseMask, maskTile } from '../doc/selection';
import { translateLayer } from '../doc/translate';
import { Editor } from '../editor';
import { Viewport } from '../render/viewport';
import { createTile, TILE_SIZE, TileGrid } from '../tiles/tile';
import { tileRange } from '@shared/iep-schema';
import { affineGrid, type Affine } from '../ops/affine';
import { contentBounds } from '../ops/canvas';
import { Compositor, type TransformPreview } from './compositor';
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
  it.each([
    ['rgba16f', 0],
    ['rgba16f', 0.5],
    ['rgba16f', 1],
    ['rgba8', 0.5],
  ] as const)('dab shader (%s) matches accumulateDabs at hardness %s', (format, hardness) => {
    const gl = context(4, 4);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad, format);
    expect(stroke.format).toBe(format);
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
      expect(maxErr, `tile ${key}`).toBeLessThan(format === 'rgba8' ? 2.5 / 255 : 2e-3);
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
        preserveAlpha: false,
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
        const expected = compositePixel(liveLayers(doc.layers), x, y);
        const i = ((size - 1 - y) * size + x) * 4; // readPixels rows are bottom-up
        for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(pixels[i + c]! - expected[c]!));
      }
    }
    expect(maxErr).toBeLessThanOrEqual(2);
  });
});

/**
 * Renders `doc` at zoom 1 and returns the largest per-channel difference from the CPU compositor, split into
 * opaque pixels (T-BLD-01: ±2/255) and translucent ones, which the canvas shows over the checkerboard: there
 * the 8-bit straight rounding of the CPU reference adds up to ~1/255 more.
 */
function maxCompositeError(
  doc: Document,
  format?: 'rgba16f' | 'rgba8',
): { opaque: number; translucent: number } {
  const { width: w, height: h } = doc;
  const gl = context(w, h);
  const compositor = new Compositor(gl);
  const stroke = new StrokeBuffer(gl, compositor.quad);
  compositor.targetFormat = format ?? stroke.format;
  compositor.render(doc, new Viewport(), { cssWidth: w, cssHeight: h, width: w, height: h, dpr: 1 });
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const err = { opaque: 0, translucent: 0 };
  for (let y = 1; y < h; y += 5) {
    for (let x = 2; x < w; x += 5) {
      const [r, g, b, a] = compositePixel(liveLayers(doc.layers), x, y);
      const row = h - 1 - y; // readPixels rows are bottom-up
      // The canvas shows the composite over the checkerboard (checker.frag: 8 px cells, 0.8 / 1.0 grey).
      const light = (Math.floor((x + 0.5) / 8) + Math.floor((row + 0.5) / 8)) % 2 === 1;
      const under = (light ? 1 : 0.8) * 255 * (1 - a / 255);
      const shown = [r, g, b].map((v) => (v * a) / 255 + under);
      const i = (row * w + x) * 4;
      const key = a === 255 ? 'opaque' : 'translucent';
      for (let c = 0; c < 3; c++) err[key] = Math.max(err[key], Math.abs(pixels[i + c]! - shown[c]!));
    }
  }
  return err;
}

function expectClose(doc: Document): void {
  const { opaque, translucent } = maxCompositeError(doc);
  expect(opaque).toBeLessThanOrEqual(2);
  expect(translucent).toBeLessThanOrEqual(3);
}

/** Opaque colourful backdrop and a semi-transparent gradient to blend onto it. */
function gradients(size: number): { backdrop: Uint8ClampedArray; source: Uint8ClampedArray } {
  const backdrop = new Uint8ClampedArray(size * size * 4);
  const source = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      backdrop.set([(x * 255) / size, (y * 255) / size, 128, y < size / 6 ? 90 : 255], i);
      source.set([255 - (y * 255) / size, 60, (x * 255) / size, 40 + ((x * 3 + y) % 215)], i);
    }
  }
  return { backdrop, source };
}

describe('blend modes and groups: GPU vs CPU (T-BLD-01, M1 subset)', () => {
  const size = 120;
  const { backdrop, source } = gradients(size);

  it.each(IMPLEMENTED_BLEND_MODES.flatMap((mode) => [0.3, 1].map((opacity) => [mode, opacity] as const)))(
    '%s at opacity %s',
    (mode, opacity) => {
      const doc = new Document(size, size, [
        createRasterLayer('bg', TileGrid.fromRgba(size, size, backdrop)),
        createRasterLayer('top', TileGrid.fromRgba(size, size, source), { blendMode: mode, opacity }),
      ]);
      expectClose(doc);
    },
  );

  it.each([
    ['pass-through', true, 'normal', 1],
    ['isolated multiply group at 60 %', false, 'multiply', 0.6],
    ['pass-through group at 50 % (composited isolated)', true, 'normal', 0.5],
  ] as const)('%s', (_name, passThrough, mode, opacity) => {
    const doc = new Document(size, size, [
      createRasterLayer('bg', TileGrid.fromRgba(size, size, backdrop)),
      createGroupLayer(
        'g',
        [
          createRasterLayer('a', TileGrid.fromRgba(size, size, source), { blendMode: 'screen' }),
          createRasterLayer('b', TileGrid.filled(size, size, [200, 40, 40, 160]), { blendMode: 'overlay' }),
        ],
        { passThrough, blendMode: mode, opacity },
      ),
    ]);
    expectClose(doc);
  });

  it('transparency-lock preview keeps alpha exactly like the CPU commit', () => {
    const doc = new Document(size, size, [
      createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
      createRasterLayer('p', TileGrid.fromRgba(size, size, source)),
    ]);
    const layer = doc.raster(doc.layers[1]!.id);
    const gl = context(size, size);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    compositor.targetFormat = stroke.format;
    const settings: BrushSettings = {
      ...DEFAULT_BRUSH,
      color: [0, 200, 0],
      opacity: 0.8,
      hardness: 1,
      mode: 'paint',
    };
    stroke.hardness = 1;
    const lockDabs: Dab[] = [{ x: 60, y: 60, radius: 40, alpha: 1 }];
    stroke.addDabs(lockDabs, size, size);
    compositor.render(
      doc,
      new Viewport(),
      { cssWidth: size, cssHeight: size, width: size, height: size, dpr: 1 },
      {
        buffer: stroke,
        layerId: layer.id,
        settings,
        preserveAlpha: true,
      },
    );
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (const key of stroke.keys()) {
      const [tileX, tileY] = key.split(',').map(Number) as [number, number];
      const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
      accumulateDabs(cov, tileX, tileY, lockDabs, 1);
      const before = layer.tiles.get(key);
      const after = applyStroke(
        before,
        cov,
        settings,
        { tileX, tileY, docWidth: size, docHeight: size },
        true,
      );
      for (let i = 3; i < 256 * 256 * 4; i += 4) expect(after?.data[i]).toBe(before?.data[i]); // alpha kept
      layer.tiles.set(key, after);
    }
    let maxErr = 0;
    for (let y = 30; y < 90; y += 3) {
      for (let x = 30; x < 90; x += 3) {
        const expected = compositePixel(liveLayers(doc.layers), x, y);
        const i = ((size - 1 - y) * size + x) * 4;
        for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(pixels[i + c]! - expected[c]!));
      }
    }
    expect(maxErr).toBeLessThanOrEqual(2);
  });
});

describe('selection clips painting: GPU preview vs CPU commit (FR-SEL-06)', () => {
  it('a stroke across a soft-edged selection previews exactly as it commits', () => {
    const size = 300; // two tiles across: one full, one partial, one outside the selection
    const doc = new Document(size, size, [
      createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
      createRasterLayer('p'),
    ]);
    const layer = doc.raster(doc.layers[1]!.id);
    const selection = ellipseMask({ x0: 20.5, y0: 20.5, x1: 240.5, y1: 200.5 }, size, size);
    const gl = context(size, size);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    compositor.targetFormat = stroke.format;
    const settings: BrushSettings = {
      ...DEFAULT_BRUSH,
      color: [200, 0, 40],
      opacity: 1,
      hardness: 1,
      mode: 'paint',
    };
    stroke.hardness = 1;
    const strokeDabs: Dab[] = [10, 70, 130, 190, 250, 290].map((x) => ({ x, y: 110, radius: 30, alpha: 1 }));
    stroke.addDabs(strokeDabs, size, size);
    compositor.render(
      doc,
      new Viewport(),
      { cssWidth: size, cssHeight: size, width: size, height: size, dpr: 1 },
      { buffer: stroke, layerId: layer.id, settings, preserveAlpha: false, selection },
    );
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // The CPU commit, as Editor.commitStroke does it.
    for (const key of stroke.keys()) {
      const mask = selection.tile(key);
      if (!mask) continue;
      const [tileX, tileY] = key.split(',').map(Number) as [number, number];
      const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
      accumulateDabs(cov, tileX, tileY, strokeDabs, 1);
      if (!mask.full) for (let i = 0; i < cov.length; i++) cov[i]! *= mask.data[i]! / 255;
      layer.tiles.set(
        key,
        applyStroke(layer.tiles.get(key), cov, settings, { tileX, tileY, docWidth: size, docHeight: size }),
      );
    }
    let maxErr = 0;
    let painted = 0;
    for (let x = 0; x < size; x += 2) {
      const y = 110;
      const expected = compositePixel(liveLayers(doc.layers), x, y);
      const i = ((size - 1 - y) * size + x) * 4;
      for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(pixels[i + c]! - expected[c]!));
      if (expected[1]! < 128) painted++;
    }
    expect(maxErr).toBeLessThanOrEqual(2);
    // Painted inside the ellipse only: nothing at x < 20 or x > 241.
    expect(painted).toBeGreaterThan(80);
    expect(compositePixel(liveLayers(doc.layers), 5, 110)).toEqual([255, 255, 255, 255]);
    expect(compositePixel(liveLayers(doc.layers), 280, 110)).toEqual([255, 255, 255, 255]);
  });
});

describe('layer masks: GPU vs CPU (FR-LAY-04)', () => {
  const size = 300;
  const render = (
    doc: Document,
    gl: WebGL2RenderingContext,
    compositor: Compositor,
    preview?: Parameters<Compositor['render']>[3],
  ) => {
    compositor.render(
      doc,
      new Viewport(),
      { cssWidth: size, cssHeight: size, width: size, height: size, dpr: 1 },
      preview,
    );
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const maxDiff = (doc: Document, pixels: Uint8Array) => {
    let err = 0;
    for (let y = 2; y < size; y += 7)
      for (let x = 2; x < size; x += 7) {
        const expected = compositePixel(liveLayers(doc.layers), x, y);
        const i = ((size - 1 - y) * size + x) * 4;
        for (let c = 0; c < 3; c++) err = Math.max(err, Math.abs(pixels[i + c]! - expected[c]!));
      }
    return err;
  };
  /** Mask tile 0,0: a horizontal ramp of coverage; elsewhere the background. */
  const rampMask = (background: 0 | 255) => {
    const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) data[(y * 256 + x) * 4 + 3] = x;
    const grid = new TileGrid();
    grid.set('0,0', createTile(data));
    return { grid, background, enabled: true, linked: true };
  };

  it('a masked layer composites like the CPU reference (partial, revealed and hidden tiles)', () => {
    for (const background of [0, 255] as const) {
      const doc = new Document(size, size, [
        createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
        createRasterLayer('ink', TileGrid.filled(size, size, [20, 60, 200, 230]), {
          mask: rampMask(background),
        }),
      ]);
      const gl = context(size, size);
      const compositor = new Compositor(gl);
      expect(maxDiff(doc, render(doc, gl, compositor)), `background ${background}`).toBeLessThanOrEqual(2);
    }
  });

  it('painting the mask previews exactly as it commits', () => {
    const doc = new Document(size, size, [
      createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
      createRasterLayer('ink', TileGrid.filled(size, size, [200, 20, 20, 255]), { mask: rampMask(255) }),
    ]);
    const layer = doc.raster(doc.layers[1]!.id);
    const gl = context(size, size);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    compositor.targetFormat = stroke.format;
    const settings: BrushSettings = {
      ...DEFAULT_BRUSH,
      color: [0, 0, 0],
      opacity: 0.8,
      hardness: 1,
      mode: 'paint',
    };
    stroke.hardness = 1;
    const strokeDabs: Dab[] = [60, 140, 220, 280].map((x) => ({ x, y: 128, radius: 35, alpha: 1 }));
    stroke.addDabs(strokeDabs, size, size);
    const pixels = render(doc, gl, compositor, {
      buffer: stroke,
      layerId: layer.id,
      settings,
      preserveAlpha: false,
      onMask: { target: 0 }, // painting black hides
    });
    for (const key of stroke.keys()) {
      const [tileX, tileY] = key.split(',').map(Number) as [number, number];
      const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
      accumulateDabs(cov, tileX, tileY, strokeDabs, 1);
      const grid = layer.mask!.grid;
      grid.set(key, applyMaskStroke(grid.get(key), layer.mask!.background, cov, 0, settings));
    }
    expect(maxDiff(doc, pixels)).toBeLessThanOrEqual(2);
    // The stroke hid the ink where it passed: white shows through at its centre.
    const centre = compositePixel(liveLayers(doc.layers), 220, 128);
    expect(centre[1]).toBeGreaterThan(150);
  });
});

describe('clipping masks: GPU vs CPU (FR-LAY-05)', () => {
  it('clipped layers composite like the CPU reference (masked, faded base; blend modes)', () => {
    const size = 300;
    const stripe = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let y = 0; y < 256; y++)
      for (let x = 40; x < 200; x++) stripe.set([20, 40, 230, 200], (y * 256 + x) * 4);
    const baseTiles = new TileGrid();
    baseTiles.set('0,0', createTile(stripe));
    const maskData = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let i = 0; i < 256 * 256; i++) maskData[i * 4 + 3] = (i % 256) ^ 0x55;
    const maskGrid = new TileGrid();
    maskGrid.set('0,0', createTile(maskData));
    const doc = new Document(size, size, [
      createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
      createRasterLayer('base', baseTiles, {
        opacity: 0.7,
        mask: { grid: maskGrid, background: 255, enabled: true, linked: true },
      }),
      createRasterLayer('clipped', TileGrid.filled(size, size, [230, 30, 30, 255]), { clipped: true }),
      createRasterLayer('multiply', TileGrid.filled(size, size, [120, 220, 90, 180]), {
        clipped: true,
        blendMode: 'multiply',
      }),
    ]);
    const gl = context(size, size);
    const compositor = new Compositor(gl);
    compositor.render(doc, new Viewport(), {
      cssWidth: size,
      cssHeight: size,
      width: size,
      height: size,
      dpr: 1,
    });
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let maxErr = 0;
    for (let y = 3; y < size; y += 7)
      for (let x = 3; x < size; x += 7) {
        const expected = compositePixel(liveLayers(doc.layers), x, y);
        const i = ((size - 1 - y) * size + x) * 4;
        for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(pixels[i + c]! - expected[c]!));
      }
    expect(maxErr).toBeLessThanOrEqual(2);
    expect(compositePixel(liveLayers(doc.layers), 250, 10)).toEqual([255, 255, 255, 255]); // no base: nothing
  });
});

describe('Quick Mask overlay: GPU vs CPU (FR-SEL-06)', () => {
  it('tints unselected pixels red and previews a stroke exactly as it commits', () => {
    const size = 300;
    const doc = new Document(size, size, [
      createRasterLayer('bg', TileGrid.filled(size, size, [40, 160, 220, 255])),
    ]);
    const selection = ellipseMask({ x0: 30.5, y0: 30.5, x1: 230.5, y1: 200.5 }, size, size);
    const gl = context(size, size);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    compositor.targetFormat = stroke.format;
    const settings: BrushSettings = { ...DEFAULT_BRUSH, opacity: 0.7, hardness: 1, mode: 'paint' };
    stroke.hardness = 1;
    const strokeDabs: Dab[] = [40, 120, 200, 280].map((x) => ({ x, y: 110, radius: 30, alpha: 1 }));
    stroke.addDabs(strokeDabs, size, size);
    const target = 0; // black: deselect
    compositor.render(
      doc,
      new Viewport(),
      { cssWidth: size, cssHeight: size, width: size, height: size, dpr: 1 },
      undefined,
      undefined,
      {
        quickMask: { selection, stroke: { buffer: stroke, settings, target: target / 255 } },
      },
    );
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // CPU: the committed selection, then red at 0.5 × (1 − coverage) over the composite.
    const updates = new Map<string, ReturnType<typeof maskTile>>();
    for (const key of stroke.keys()) {
      const [tileX, tileY] = key.split(',').map(Number) as [number, number];
      const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
      accumulateDabs(cov, tileX, tileY, strokeDabs, 1);
      const old = selection.tile(key);
      updates.set(
        key,
        maskTile(
          applySelectionStroke(old && !old.full ? old.data : null, old ? 255 : 0, cov, target, settings),
        ),
      );
    }
    const after = selection.withTiles(updates);
    let maxErr = 0;
    for (let y = 2; y < size; y += 7)
      for (let x = 2; x < size; x += 7) {
        const comp = compositePixel(liveLayers(doc.layers), x, y);
        const a = 0.5 * (1 - after.value(x, y) / 255);
        const expected = [comp[0]! * (1 - a) + 255 * a, comp[1]! * (1 - a), comp[2]! * (1 - a)];
        const i = ((size - 1 - y) * size + x) * 4;
        for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(pixels[i + c]! - expected[c]!));
      }
    expect(maxErr).toBeLessThanOrEqual(3);
  });
});

describe('WebGL context loss (NFR-REL-02)', () => {
  function editorCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:400px;height:300px;display:block';
    document.body.append(canvas);
    return canvas;
  }

  it('asks the host to move the document when the context is not restored', async () => {
    const onUnrecoverableContextLoss = vi.fn();
    const canvas = editorCanvas();
    const editor = new Editor(canvas, { onUnrecoverableContextLoss, restoreTimeoutMs: 50 });
    editor.newDocument(64, 64);
    editor.addLayer();
    canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
    await vi.waitFor(() => expect(onUnrecoverableContextLoss).toHaveBeenCalledOnce());
    expect(editor.getSnapshot().gpu).toMatch(/lost/);

    // A fresh canvas adopts the document and its history; nothing is lost.
    const state = editor.exportState();
    editor.dispose();
    const next = new Editor(editorCanvas());
    next.adopt(state);
    expect(next.getSnapshot().layers.map((l) => l.name)).toEqual(['Layer 1', 'Background']);
    expect(next.getSnapshot().history.entries.map((e) => e.label)).toEqual(['New Layer']);
    next.undo();
    expect(next.getSnapshot().layers).toHaveLength(1);
    next.dispose();
  });

  it('keeps working after the context is restored', async () => {
    const onUnrecoverableContextLoss = vi.fn();
    const canvas = editorCanvas();
    const editor = new Editor(canvas, { onUnrecoverableContextLoss, restoreTimeoutMs: 5000 });
    editor.newDocument(64, 64);
    const ext = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    ext.loseContext();
    await vi.waitFor(() => expect(editor.getSnapshot().gpu).toMatch(/lost/));
    ext.restoreContext();
    await vi.waitFor(() => expect(editor.getSnapshot().gpu).toMatch(/strokes RGBA/));
    expect(onUnrecoverableContextLoss).not.toHaveBeenCalled();
    editor.dispose();
  });
});

describe('painting and moving: GPU vs CPU (FR-PNT-01/02, FR-TRF-07)', () => {
  it('pencil dabs are whole pixels and match pencilCoverage exactly', () => {
    const gl = context(4, 4);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    stroke.aliased = true;
    const gen = new DabGenerator({ ...DEFAULT_BRUSH, aliased: true, pressureSize: true, size: 6, flow: 0.5 });
    const pencilDabs = [
      ...gen.begin({ x: 20.2, y: 30.7, pressure: 1 }),
      ...gen.moveTo({ x: 270.9, y: 60.1, pressure: 0.3 }), // crosses into the next tile, tapering
    ];
    for (const key of stroke.addDabs(pencilDabs, 600, 600)) {
      const [tx, ty] = key.split(',').map(Number) as [number, number];
      const cpu = new Float32Array(TILE_SIZE * TILE_SIZE);
      accumulateDabs(cpu, tx, ty, pencilDabs, 1, true);
      const gpu = stroke.readCoverage(key);
      let maxErr = 0;
      for (let i = 0; i < cpu.length; i++) maxErr = Math.max(maxErr, Math.abs(cpu[i]! - gpu[i]!));
      expect(maxErr, `tile ${key}`).toBeLessThan(stroke.format === 'rgba8' ? 2.5 / 255 : 2e-3);
    }
  });

  it.each(['chalk', 'charcoal', 'sponge'] as const)(
    'textured tip (%s): live preview matches the CPU commit within ±2/255',
    (tip) => {
      const size = 300;
      const gl = context(size, size);
      const compositor = new Compositor(gl);
      const stroke = new StrokeBuffer(gl, compositor.quad);
      const settings: BrushSettings = { ...DEFAULT_BRUSH, color: [20, 90, 200], hardness: 0.9, tip };
      stroke.hardness = settings.hardness;
      const layer = createRasterLayer('paint');
      const doc = new Document(size, size, [
        createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
        layer,
      ]);
      stroke.addDabs(dabs, size, size);
      compositor.render(
        doc,
        new Viewport(),
        { cssWidth: size, cssHeight: size, width: size, height: size, dpr: 1 },
        { buffer: stroke, layerId: layer.id, settings, preserveAlpha: false },
      );
      const pixels = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (const key of stroke.keys()) {
        const [tileX, tileY] = key.split(',').map(Number) as [number, number];
        const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
        accumulateDabs(cov, tileX, tileY, dabs, settings.hardness);
        layer.tiles.set(
          key,
          applyStroke(undefined, cov, settings, { tileX, tileY, docWidth: size, docHeight: size }),
        );
      }
      let maxErr = 0;
      let textured = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const expected = compositePixel(liveLayers(doc.layers), x, y);
          const i = ((size - 1 - y) * size + x) * 4;
          for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(pixels[i + c]! - expected[c]!));
          if (expected[0] === 255 && Math.hypot(x - 100.3, y - 90.7) < 30) textured++; // holes inside the dab
        }
      }
      expect(maxErr).toBeLessThanOrEqual(2);
      expect(textured).toBeGreaterThan(50);
    },
  );

  it('move preview matches the committed move, and pixels outside the canvas never show', () => {
    const size = 300; // 2×2 tiles: the second column/row of tiles is mostly outside the canvas
    const viewW = 400;
    const gl = context(viewW, size);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    compositor.targetFormat = stroke.format;
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if ((x * 7 + y * 3) % 11 < 6) rgba.set([x % 256, y % 256, 90, 255], (y * size + x) * 4);
    const layer = createRasterLayer('top', TileGrid.fromRgba(size, size, rgba));
    // Red pixels kept off the canvas, in the same edge tile as visible ones (x 300..320).
    const edge = new Uint8ClampedArray(layer.tiles.get('1,0')!.data);
    for (let y = 0; y < 50; y++) for (let x = 44; x < 64; x++) edge.set([255, 0, 0, 255], (y * 256 + x) * 4);
    layer.tiles.set('1,0', createTile(edge));
    const doc = new Document(size, size, [
      createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
      layer,
    ]);
    const render = (move?: { dx: number; dy: number }) => {
      compositor.render(
        doc,
        new Viewport(),
        { cssWidth: viewW, cssHeight: size, width: viewW, height: size, dpr: 1 },
        undefined,
        move && { layerIds: new Set([layer.id]), ...move },
      );
      const px = new Uint8Array(viewW * size * 4);
      gl.readPixels(0, 0, viewW, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const at = (px: Uint8Array, x: number, y: number) => [
      ...px.subarray(((size - 1 - y) * viewW + x) * 4, ((size - 1 - y) * viewW + x) * 4 + 3),
    ];

    // Off-canvas red stays hidden: the area right of the canvas shows the surround, not the layer.
    const still = render();
    for (let y = 0; y < 50; y += 7) expect(at(still, 310, y)).toEqual([0x3a, 0x3a, 0x3a]);

    // Dragging left brings the red pixels onto the canvas; the preview equals the committed move.
    const preview = render({ dx: -37, dy: 21 });
    translateLayer(doc, layer.id, -37, 21)!.do(doc);
    const committed = render();
    let maxErr = 0;
    for (let i = 0; i < preview.length; i++) maxErr = Math.max(maxErr, Math.abs(preview[i]! - committed[i]!));
    expect(maxErr).toBe(0);
    expect(at(committed, 300 - 37 + 10, 30)).toEqual([255, 0, 0]);
    expect(compositePixel(liveLayers(doc.layers), 300 - 37 + 10, 30)).toEqual([255, 0, 0, 255]);
  });
});

describe('editor canvas geometry (FR-TRF-01..03)', () => {
  function editorCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:400px;height:300px;display:block';
    document.body.append(canvas);
    return canvas;
  }

  it('Image Size runs as a job, blocks edits meanwhile, and is one undo step', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const editor = new Editor(editorCanvas(), {
      runOps: async (job, onProgress) => {
        onProgress(0.5);
        await gate;
        const { runOpsJob } = await import('../ops/jobs');
        return runOpsJob(job);
      },
    });
    editor.newDocument(120, 80);
    const pending = editor.resizeImage(60, 40, 'bicubic');
    expect(editor.getSnapshot().job).toEqual({ label: 'Image Size', progress: 0.5 });
    editor.addLayer(); // refused while the job runs
    expect(editor.getSnapshot().layers).toHaveLength(1);
    release();
    await pending;
    const snap = editor.getSnapshot();
    expect(snap.job).toBeNull();
    expect(snap.doc).toMatchObject({ width: 60, height: 40 });
    expect(snap.history.entries.map((e) => e.label)).toEqual(['Image Size']);
    editor.undo();
    expect(editor.getSnapshot().doc).toMatchObject({ width: 120, height: 80 });
    editor.dispose();
  });

  it('crop, rotate and straighten change the canvas size and undo exactly', async () => {
    const editor = new Editor(editorCanvas());
    editor.newDocument(200, 100);
    editor.setTool('crop');
    expect(editor.getSnapshot().crop?.rect).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    editor.setCropRatio('1:1');
    expect(editor.getSnapshot().crop?.rect).toEqual({ x: 50, y: 0, width: 100, height: 100 });
    editor.commitCrop();
    expect(editor.getSnapshot().doc).toMatchObject({ width: 100, height: 100 });
    editor.rotateCanvas(1);
    await editor.straighten(10, true);
    const size = editor.getSnapshot().doc!;
    expect(size.width).toBeLessThan(100);
    expect(editor.getSnapshot().history.entries.map((e) => e.label)).toEqual([
      'Crop',
      'Rotate 90° Clockwise',
      'Straighten',
    ]);
    editor.goToHistory(-1);
    expect(editor.getSnapshot().doc).toMatchObject({ width: 200, height: 100 });
    editor.dispose();
  });
});

describe('Free Transform (FR-TRF-04, T-TRF-01)', () => {
  function editorCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:400px;height:300px;display:block';
    document.body.append(canvas);
    return canvas;
  }

  function preview(matrix: Affine, size = 300) {
    const gl = context(size, size);
    const compositor = new Compositor(gl);
    const stroke = new StrokeBuffer(gl, compositor.quad);
    compositor.targetFormat = stroke.format;
    // A smooth, opaque image well inside the canvas, on white.
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 60; y < 240; y++)
      for (let x = 40; x < 260; x++)
        rgba.set([x % 256, y % 256, Math.round(128 + 100 * Math.sin(x / 20)), 255], (y * size + x) * 4);
    const layer = createRasterLayer('top', TileGrid.fromRgba(size, size, rgba));
    const doc = new Document(size, size, [
      createRasterLayer('bg', TileGrid.filled(size, size, [255, 255, 255, 255])),
      layer,
    ]);
    const render = (transform?: TransformPreview, d = doc) => {
      compositor.render(
        d,
        new Viewport(),
        { cssWidth: size, cssHeight: size, width: size, height: size, dpr: 1 },
        undefined,
        undefined,
        { transform },
      );
      const px = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const live = render({ layerIds: new Set([layer.id]), matrix });
    const after = new Document(size, size, [
      doc.layers[0]!,
      createRasterLayer('top', affineGrid(layer.tiles, matrix, tileRange(size, size))),
    ]);
    const committed = render(undefined, after);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < live.length; i++) {
      const e = Math.abs(live[i]! - committed[i]!);
      sum += e;
      max = Math.max(max, e);
    }
    return { mean: sum / live.length, max };
  }

  it('a quarter turn previews exactly as it commits', () => {
    expect(preview([0, 1, -1, 0, 300, 0])).toEqual({ mean: 0, max: 0 });
  });

  it('a rotation with scaling previews close to the bicubic commit', () => {
    const a = 0.4;
    const s = 0.8;
    const c = Math.cos(a) * s;
    const n = Math.sin(a) * s;
    // About the canvas centre (150, 150).
    const { mean } = preview([c, n, -n, c, 150 - c * 150 + n * 150, 150 - n * 150 - c * 150]);
    expect(mean).toBeLessThan(1.5); // bilinear preview vs bicubic commit: edges differ slightly
  });

  it('Ctrl+T: drag-free numeric entry, apply as one undo step, cancel and undo leave pixels alone', async () => {
    const notices: string[] = [];
    const editor = new Editor(editorCanvas(), { onNotice: (m) => notices.push(m) });
    editor.newDocument(200, 100);
    const rgba = new Uint8Array(40 * 20 * 4);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 40; x++) rgba.set(x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 40 + x) * 4);
    editor.pasteAsLayer(40, 20, rgba);
    const doc = () => editor.exportState().doc!;
    const pixels = () => doc().raster(doc().activeLayerId).tiles;
    const before = pixels();
    const box = contentBounds([before])!;
    expect(box.x1 - box.x0).toBe(40);

    editor.beginTransform();
    const t = editor.getSnapshot().transform!;
    expect(t.box).toEqual(box);
    expect(t.handles.nw).toEqual([box.x0, box.y0]);
    editor.addLayer(); // refused while the box is open
    expect(editor.getSnapshot().layers).toHaveLength(2);
    editor.setTransformParams({ sx: -1 }); // flip: red and blue swap sides
    editor.cancelTransform();
    expect(pixels()).toBe(before);
    expect(editor.getSnapshot().transform).toBeNull();

    editor.beginTransform();
    editor.setTransformParams({ sx: -1, tx: 10 });
    editor.nudge(0, 3); // arrows move the box
    expect(editor.getSnapshot().transform!.params).toMatchObject({ tx: 10, ty: 3 });
    await editor.commitTransform();
    expect(editor.getSnapshot().history.entries.map((e) => e.label)).toEqual(['Paste', 'Free Transform']);
    const flipped = pixels();
    expect(flipped.pixel(box.x0 + 10 + 2, box.y0 + 3 + 5)).toEqual([0, 0, 255, 255]); // exact: no resampling
    expect(flipped.pixel(box.x1 + 10 - 2, box.y0 + 3 + 5)).toEqual([255, 0, 0, 255]);
    editor.undo();
    expect(pixels()).toBe(before);

    // Edit › Transform › Rotate 90° applies at once, about the content's centre, exactly.
    editor.transformStep('rotate90cw');
    await vi.waitFor(() => expect(editor.getSnapshot().job).toBeNull());
    const turned = contentBounds([pixels()])!;
    expect([turned.x1 - turned.x0, turned.y1 - turned.y0]).toEqual([20, 40]);
    expect(pixels().pixel(turned.x0 + 5, turned.y0 + 2)).toEqual([255, 0, 0, 255]); // left half → top
    expect(editor.getSnapshot().history.entries.at(-1)!.label).toBe('Rotate 90° Clockwise');

    // Undo while the box is open closes it; a selection is not transformed yet.
    editor.beginTransform();
    editor.undo();
    expect(editor.getSnapshot().transform).toBeNull();
    expect(editor.getSnapshot().history.entries.at(-1)!.label).toBe('Rotate 90° Clockwise');
    editor.selectAll();
    editor.beginTransform();
    expect(editor.getSnapshot().transform).toBeNull();
    expect(notices.at(-1)).toMatch(/selection/);
    editor.dispose();
  });

  it('a linked reveal-all mask transforms with its layer; missing tiles stay revealed', async () => {
    const editor = new Editor(editorCanvas());
    editor.newDocument(600, 300);
    const rgba = new Uint8Array(300 * 100 * 4).fill(255);
    editor.pasteAsLayer(300, 100, rgba);
    editor.addLayerMask('reveal');
    const doc = () => editor.exportState().doc!;
    const layer = () => doc().raster(doc().activeLayerId);
    const box = contentBounds([layer().tiles])!;
    // Hide a 10 × 10 patch near the layer's left edge.
    const hidden = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4).fill(255);
    const [tx, ty] = [Math.floor(box.x0 / TILE_SIZE), Math.floor(box.y0 / TILE_SIZE)];
    const [lx, ly] = [box.x0 - tx * TILE_SIZE + 5, box.y0 - ty * TILE_SIZE + 5];
    for (let y = ly; y < ly + 10; y++)
      for (let x = lx; x < lx + 10; x++) hidden[(y * TILE_SIZE + x) * 4 + 3] = 0;
    layer().mask!.grid.set(`${tx},${ty}`, createTile(hidden));

    editor.beginTransform();
    editor.setTransformParams({ angle: Math.PI / 2 });
    await editor.commitTransform();
    const mask = layer().mask!;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    // The patch's centre (x0 + 10, y0 + 10) turns 90° clockwise about the box centre.
    const [px, py] = [Math.floor(cx - (box.y0 + 10 - cy)), Math.floor(cy + (box.x0 + 10 - cx))];
    const maskAlpha = (x: number, y: number) => {
      const tile = mask.grid.get(`${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`);
      return tile ? tile.data[((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4 + 3] : mask.background;
    };
    expect(maskAlpha(px, py)).toBeLessThan(10);
    // Elsewhere inside and right next to the turned layer, the mask still reveals.
    expect(maskAlpha(Math.floor(cx), Math.floor(cy))).toBe(255);
    expect(maskAlpha(Math.floor(cx) + 60, Math.floor(cy))).toBe(255);
    editor.dispose();
  });
});

describe('pixel grid (FR-NAV-01)', () => {
  function renderWhite(zoom: number, pixelGrid: boolean): Uint8Array {
    const w = 64;
    const gl = context(w, w);
    const compositor = new Compositor(gl);
    const doc = new Document(16, 16, createRasterLayer('bg', TileGrid.filled(16, 16, [255, 255, 255, 255])));
    const viewport = new Viewport();
    viewport.zoom = zoom;
    compositor.render(
      doc,
      viewport,
      { cssWidth: w, cssHeight: w, width: w, height: w, dpr: 1 },
      undefined,
      undefined,
      {
        pixelGrid,
      },
    );
    const px = new Uint8Array(w * w * 4);
    gl.readPixels(0, 0, w, w, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }
  const red = (px: Uint8Array, x: number, y: number) => px[((64 - 1 - y) * 64 + x) * 4]!;

  it('draws a line on every pixel boundary at 800 %, and leaves pixel interiors alone', () => {
    const px = renderWhite(8, true);
    for (const x of [0, 8, 16, 40]) expect(red(px, x, 3), `x ${x}`).toBeLessThan(220);
    for (const x of [1, 4, 7, 12, 45]) expect(red(px, x, 3), `x ${x}`).toBe(255);
    expect(red(px, 3, 24)).toBeLessThan(220); // horizontal line at y = 3 doc px
  });

  it('is hidden below 800 % and when turned off', () => {
    for (const px of [renderWhite(4, true), renderWhite(8, false)])
      for (const x of [0, 8, 16]) expect(red(px, x, 3)).toBe(255);
  });
});

describe('document tabs (FR-DOC-03)', () => {
  function editorCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:400px;height:300px;display:block';
    document.body.append(canvas);
    return canvas;
  }

  it('keeps each document with its own history and view; closing shows a neighbour', () => {
    const editor = new Editor(editorCanvas());
    editor.newDocument(100, 80);
    editor.addLayer();
    const first = editor.getSnapshot().doc!.id;
    editor.zoomTo(3);
    editor.newDocument(50, 40);
    const second = editor.getSnapshot().doc!.id;
    let snap = editor.getSnapshot();
    expect(snap.tabs.map((t) => [t.id, t.active, t.dirty])).toEqual([
      [first, false, true],
      [second, true, false],
    ]);
    expect(snap.history.entries).toEqual([]);

    editor.activateDocument(first);
    snap = editor.getSnapshot();
    expect(snap.doc).toMatchObject({ width: 100, height: 80 });
    expect(snap.zoom).toBe(3); // the view comes back with the document
    expect(snap.history.entries.map((e) => e.label)).toEqual(['New Layer']);
    editor.undo();
    expect(editor.getSnapshot().tabs[0]!.dirty).toBe(false);

    editor.cycleDocument(1);
    expect(editor.getSnapshot().doc!.id).toBe(second);
    editor.closeDocument();
    expect(editor.getSnapshot().doc!.id).toBe(first);
    editor.closeDocument();
    expect(editor.getSnapshot().doc).toBeNull();
    expect(editor.getSnapshot().tabs).toEqual([]);
    editor.dispose();
  });

  it('a new canvas after context loss keeps every tab', () => {
    const editor = new Editor(editorCanvas());
    editor.newDocument(10, 10);
    editor.newDocument(20, 20);
    const state = editor.exportState();
    editor.dispose();
    const next = new Editor(editorCanvas());
    next.adopt(state);
    expect(next.getSnapshot().tabs).toHaveLength(2);
    next.cycleDocument(1);
    expect(next.getSnapshot().doc).toMatchObject({ width: 10, height: 10 });
    next.dispose();
  });
});
