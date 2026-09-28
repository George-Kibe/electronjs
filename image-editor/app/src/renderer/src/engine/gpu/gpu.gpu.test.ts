import { describe, expect, it, vi } from 'vitest';
import { accumulateDabs, applyStroke, DEFAULT_BRUSH, type BrushSettings, type Dab } from '../brush/brush';
import { IMPLEMENTED_BLEND_MODES } from '../doc/blend';
import { createGroupLayer, createRasterLayer, Document } from '../doc/document';
import { compositePixel, liveLayers } from '../doc/flatten';
import { Editor } from '../editor';
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
