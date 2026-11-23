import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_BLEND_MODES } from '../../src/renderer/src/engine/doc/blend';
import {
  createAdjustmentLayer,
  createRasterLayer,
  Document,
} from '../../src/renderer/src/engine/doc/document';
import { compositeTile, liveLayers } from '../../src/renderer/src/engine/doc/flatten';
import { defaultAdjustment, type Adjustment } from '../../src/renderer/src/engine/ops/adjust';
import { applyFilter, type Filter } from '../../src/renderer/src/engine/ops/filters';
import { createTile, TILE_SIZE, TileGrid } from '../../src/renderer/src/engine/tiles/tile';
import { decodePng, encodePng } from './png';

/**
 * Golden images (docs/07 §2, M2 exit): every blend mode × opacity × mask, every adjustment and filter at 3
 * settings, rendered by the CPU reference (deterministic on every OS; the GPU is held to it by the
 * conformance tests in gpu.gpu.test.ts). Each set is one contact sheet, compared cell by cell within ±2/255.
 * A missing baseline is written (never in CI); `pnpm test:golden --update` rewrites them, only after the
 * change has been reviewed (CLAUDE.md). Failures leave the actual image and a diff in __diff__/.
 */
const DIR = import.meta.dirname;
const UPDATE = process.env.GOLDEN_UPDATE === '1';

type Sheet = { width: number; height: number; rgba: Uint8Array; cell: number; labels: string[][] };

function compare(name: string, sheet: Sheet): void {
  const path = join(DIR, `${name}.png`);
  const png = encodePng(sheet.width, sheet.height, sheet.rgba);
  if (UPDATE || !existsSync(path)) {
    if (process.env.CI && !UPDATE)
      throw new Error(`Missing golden ${name}.png: run pnpm test:golden --update and review it.`);
    writeFileSync(path, png);
    return;
  }
  const base = decodePng(readFileSync(path));
  expect([base.width, base.height], `${name}.png has a different size`).toEqual([sheet.width, sheet.height]);
  const diff = new Uint8Array(sheet.rgba.length);
  const failing = new Set<string>();
  for (let i = 0; i < sheet.rgba.length; i += 4) {
    let worst = 0;
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(sheet.rgba[i + c]! - base.rgba[i + c]!));
    // The diff: the image dimmed, red where a pixel is out of tolerance, amber where it changed within it.
    const dim = Math.round((sheet.rgba[i]! + sheet.rgba[i + 1]! + sheet.rgba[i + 2]!) / 12);
    diff.set(worst > 2 ? [255, 0, 0, 255] : worst > 0 ? [255, 191, 0, 255] : [dim, dim, dim, 255], i);
    if (worst > 2) {
      const p = i / 4;
      const x = p % sheet.width;
      const y = Math.floor(p / sheet.width);
      const row = Math.floor(y / sheet.cell);
      const col = Math.floor(x / sheet.cell);
      failing.add(sheet.labels[row]![col] ?? `empty cell ${row},${col}`);
    }
  }
  if (failing.size > 0) {
    const out = join(DIR, '__diff__');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${name}.actual.png`), png);
    writeFileSync(join(out, `${name}.diff.png`), encodePng(sheet.width, sheet.height, diff));
  }
  expect([...failing], `cells of ${name}.png that changed (see __diff__/)`).toEqual([]);
}

/** Lays cells out in rows. */
function sheetOf(cell: number, rows: Array<Array<{ label: string; rgba: Uint8Array }>>): Sheet {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = cols * cell;
  const height = rows.length * cell;
  const rgba = new Uint8Array(width * height * 4);
  rows.forEach((row, r) =>
    row.forEach(({ rgba: c }, k) => {
      for (let y = 0; y < cell; y++)
        rgba.set(c.subarray(y * cell * 4, (y + 1) * cell * 4), ((r * cell + y) * width + k * cell) * 4);
    }),
  );
  return { width, height, rgba, cell, labels: rows.map((row) => row.map((c) => c.label)) };
}

/** The top-left `size`² pixels of a composite. */
function render(doc: Document, size: number): Uint8Array {
  const tile = compositeTile(liveLayers(doc.layers), '0,0');
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    out.set(tile.subarray(y * TILE_SIZE * 4, (y * TILE_SIZE + size) * 4), y * size * 4);
  return out;
}

function image(
  size: number,
  f: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set(f(x, y), (y * size + x) * 4);
  return rgba;
}

/** Every hue across, dark to light down. */
function hues(size: number, alpha = (_x: number, _y: number) => 255) {
  return image(size, (x, y) => {
    const h = x / size;
    const l = 0.12 + (0.76 * y) / size;
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return Math.round((l - 0.9 * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
    };
    return [f(0), f(8), f(4), alpha(x, y)];
  });
}

describe('golden images', () => {
  it('blend modes × opacity × mask (T-BLD-01 baselines)', () => {
    const S = 48;
    const backdrop = image(S, (x, y) => [(x * 255) / S, (y * 255) / S, 128, 255]);
    const source = hues(S, (x, y) => 60 + ((x * 3 + y * 2) % 195));
    // The mask: hidden on the left edge of the cell, fully shown on the right.
    const ramp = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++)
        ramp[(y * 256 + x) * 4 + 3] = Math.min(255, Math.round((x * 255) / (S - 1)));
    const rows = IMPLEMENTED_BLEND_MODES.map((mode) =>
      [false, true].flatMap((masked) =>
        [1, 0.3].map((opacity) => {
          const grid = new TileGrid();
          grid.set('0,0', createTile(ramp));
          const doc = new Document(S, S, [
            createRasterLayer('bg', TileGrid.fromRgba(S, S, backdrop)),
            createRasterLayer('top', TileGrid.fromRgba(S, S, source), {
              blendMode: mode,
              opacity,
              mask: masked ? { grid, background: 255, enabled: true, linked: true } : null,
            }),
          ]);
          return { label: `${mode} ${opacity}${masked ? ' masked' : ''}`, rgba: render(doc, S) };
        }),
      ),
    );
    compare('blend-modes', sheetOf(S, rows));
  });

  it('adjustments at 3 settings each (FR-ADJ-01)', () => {
    const S = 48;
    const photo = hues(S);
    const levels = (
      rgb: Partial<Record<'rgb' | 'r' | 'g' | 'b', [number, number, number, number, number]>>,
    ) => {
      const a = defaultAdjustment('levels');
      for (const [k, [inBlack, inWhite, gamma, outBlack, outWhite]] of Object.entries(rgb))
        a.channels[k as 'rgb'] = { inBlack, inWhite, gamma, outBlack, outWhite };
      return a;
    };
    const curves = (ch: 'rgb' | 'g', pts: Array<[number, number]>) => {
      const a = defaultAdjustment('curves');
      a.channels[ch] = pts;
      return a;
    };
    const bw = defaultAdjustment('black-white');
    const sets: Adjustment[][] = [
      [
        { kind: 'brightness-contrast', brightness: 40, contrast: 20, legacy: false },
        { kind: 'brightness-contrast', brightness: -60, contrast: 50, legacy: false },
        { kind: 'brightness-contrast', brightness: 30, contrast: -30, legacy: true },
      ],
      [
        levels({ rgb: [20, 230, 1.3, 0, 255] }),
        levels({ r: [0, 200, 0.8, 30, 255] }),
        levels({ rgb: [0, 255, 1, 40, 200] }),
      ],
      [
        curves('rgb', [
          [0, 0],
          [64, 40],
          [192, 220],
          [255, 255],
        ]),
        curves('g', [
          [0, 30],
          [255, 200],
        ]),
        curves('rgb', [
          [0, 255],
          [128, 100],
          [255, 0],
        ]),
      ],
      [
        { kind: 'exposure', exposure: 1, offset: 0, gamma: 1 },
        { kind: 'exposure', exposure: -1, offset: 0.05, gamma: 1.5 },
        { kind: 'exposure', exposure: 0.5, offset: -0.02, gamma: 0.8 },
      ],
      [
        { kind: 'vibrance', vibrance: 60, saturation: 0 },
        { kind: 'vibrance', vibrance: -50, saturation: 20 },
        { kind: 'vibrance', vibrance: 30, saturation: -40 },
      ],
      [
        { kind: 'hue-saturation', hue: 60, saturation: 20, lightness: 0, colorize: false },
        { kind: 'hue-saturation', hue: -120, saturation: -50, lightness: 30, colorize: false },
        { kind: 'hue-saturation', hue: 200, saturation: 60, lightness: -20, colorize: true },
      ],
      [
        {
          kind: 'color-balance',
          shadows: [40, 0, -20],
          midtones: [0, 0, 0],
          highlights: [0, 0, 0],
          preserveLuminosity: true,
        },
        {
          kind: 'color-balance',
          shadows: [0, 0, 0],
          midtones: [-50, 30, 10],
          highlights: [0, 0, 0],
          preserveLuminosity: false,
        },
        {
          kind: 'color-balance',
          shadows: [0, 0, 0],
          midtones: [0, 0, 0],
          highlights: [10, -40, 60],
          preserveLuminosity: true,
        },
      ],
      [
        bw,
        { ...bw, weights: { r: 120, y: 20, g: -40, c: 80, b: 200, m: 10 } },
        { ...bw, tint: [225, 211, 179] },
      ],
      [
        { kind: 'photo-filter', color: [236, 138, 0], density: 25, preserveLuminosity: true },
        { kind: 'photo-filter', color: [0, 109, 255], density: 60, preserveLuminosity: false },
        { kind: 'photo-filter', color: [25, 201, 25], density: 40, preserveLuminosity: true },
      ],
      [{ kind: 'invert' }], // no settings
      [
        { kind: 'posterize', levels: 2 },
        { kind: 'posterize', levels: 4 },
        { kind: 'posterize', levels: 8 },
      ],
      [
        { kind: 'threshold', level: 64 },
        { kind: 'threshold', level: 128 },
        { kind: 'threshold', level: 200 },
      ],
    ];
    const rows = sets.map((row) =>
      row.map((adjustment, i) => {
        const doc = new Document(S, S, [
          createRasterLayer('photo', TileGrid.fromRgba(S, S, photo)),
          createAdjustmentLayer('adj', adjustment, { mask: null }),
        ]);
        return { label: `${adjustment.kind} #${i + 1}`, rgba: render(doc, S) };
      }),
    );
    compare('adjustments', sheetOf(S, rows));
  });

  it('filters at 3 settings each (FR-FLT-01)', () => {
    const S = 64;
    // Hard edges, a soft gradient, fine stripes and a transparent corner.
    const src = image(S, (x, y) => {
      if (x > 48 && y > 48) return [0, 0, 0, 0];
      if ((x - 20) ** 2 + (y - 20) ** 2 < 140) return [230, 40, 40, 255];
      if (y > 40) return x % 4 < 2 ? [20, 20, 20, 255] : [240, 240, 240, 255];
      return [Math.round((x * 255) / S), 120, Math.round((y * 255) / S), 255];
    });
    const tiles = new Map(
      [...TileGrid.fromRgba(S, S, src).entries()].map(([k, t]) => [k, new Uint8Array(t.data)]),
    );
    const sets: Filter[][] = [
      [1, 3, 8].map((radius) => ({ kind: 'gaussian-blur', radius })),
      [1, 4, 10].map((radius) => ({ kind: 'box-blur', radius })),
      [
        { kind: 'motion-blur', angle: 0, distance: 10 },
        { kind: 'motion-blur', angle: 45, distance: 20 },
        { kind: 'motion-blur', angle: -80, distance: 6 },
      ],
      [{ kind: 'sharpen' }], // no settings
      [
        { kind: 'unsharp-mask', amount: 100, radius: 1, threshold: 0 },
        { kind: 'unsharp-mask', amount: 200, radius: 3, threshold: 10 },
        { kind: 'unsharp-mask', amount: 50, radius: 6, threshold: 0 },
      ],
      [
        { kind: 'add-noise', amount: 12.5, distribution: 'uniform', monochromatic: false, seed: 1 },
        { kind: 'add-noise', amount: 40, distribution: 'gaussian', monochromatic: false, seed: 1 },
        { kind: 'add-noise', amount: 25, distribution: 'gaussian', monochromatic: true, seed: 1 },
      ],
      [1, 2, 4].map((radius) => ({ kind: 'reduce-noise', radius })),
      [4, 8, 16].map((cellSize) => ({ kind: 'mosaic', cellSize })),
      [
        { kind: 'emboss', angle: 135, height: 3, amount: 100 },
        { kind: 'emboss', angle: 45, height: 1, amount: 300 },
        { kind: 'emboss', angle: -90, height: 5, amount: 50 },
      ],
      [{ kind: 'find-edges' }], // no settings
      [
        { kind: 'vignette', amount: -50, midpoint: 50 },
        { kind: 'vignette', amount: -90, midpoint: 20 },
        { kind: 'vignette', amount: 70, midpoint: 40 },
      ],
    ];
    const rows = sets.map((row) =>
      row.map((filter, i) => {
        const out = new Map<string, Uint8Array>(tiles);
        for (const [k, t] of applyFilter(filter, {
          tiles,
          size: { width: S, height: S },
          selection: null,
          keys: null,
          preserveAlpha: false,
        }))
          if (t.length) out.set(k, t);
          else out.delete(k);
        const tile = out.get('0,0');
        const rgba = new Uint8Array(S * S * 4);
        if (tile)
          for (let y = 0; y < S; y++)
            rgba.set(tile.subarray(y * TILE_SIZE * 4, (y * TILE_SIZE + S) * 4), y * S * 4);
        return { label: `${filter.kind} #${i + 1}`, rgba };
      }),
    );
    compare('filters', sheetOf(S, rows));
  });
});
