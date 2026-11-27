import { describe, expect, it } from 'vitest';
import { TILE_SIZE, TileGrid } from '../tiles/tile';
import {
  gradientPosition,
  paintGradient,
  presetStops,
  sampleStops,
  type GradientFill,
  type GradientType,
} from './gradient';

const S = { x: 100, y: 100 };
const E = { x: 200, y: 100 };

describe('Gradient (FR-PNT-04)', () => {
  it.each<[GradientType, number, number, number]>([
    ['linear', 150, 100, 0.5],
    ['linear', 50, 300, 0], // before the start
    ['linear', 260, 0, 1], // past the end
    ['reflected', 50, 100, 0.5], // mirrored at the start
    ['radial', 100, 150, 0.5], // any direction
    ['radial', 100, 300, 1],
    ['diamond', 125, 125, 0.5], // L1 distance
    ['diamond', 150, 100, 0.5],
    ['angle', 100, 200, 0.25], // a quarter turn clockwise on screen (y down)
    ['angle', 0, 100, 0.5],
  ])('%s at (%s, %s) is %s', (type, x, y, t) => {
    expect(gradientPosition(type, S, E, x, y)).toBeCloseTo(t, 6);
  });

  it('interpolates between stops, colour and alpha', () => {
    const out = new Float32Array(4);
    const stops = presetStops('fg-transparent', [255, 0, 0], [0, 0, 0]);
    sampleStops(stops, 0.25, out);
    expect([...out]).toEqual([1, 0, 0, 0.75]);
    const three = [
      { at: 0, color: [0, 0, 0] as [number, number, number], alpha: 1 },
      { at: 0.5, color: [255, 255, 255] as [number, number, number], alpha: 1 },
      { at: 1, color: [0, 0, 0] as [number, number, number], alpha: 1 },
    ];
    sampleStops(three, 0.75, out);
    expect(out[0]).toBeCloseTo(0.5, 5);
    sampleStops(three, -1, out);
    expect(out[0]).toBe(0);
  });

  const W = 300;
  const H = 40;
  const white = () => {
    const grid = TileGrid.filled(W, H, [255, 255, 255, 255]);
    return new Map([...grid.entries()].map(([k, t]) => [k, new Uint8Array(t.data)]));
  };
  const px = (tiles: Map<string, Uint8Array>, x: number, y: number) => {
    const t = tiles.get(`${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`)!;
    const i = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4;
    return [...t.subarray(i, i + 4)];
  };
  const fill = (o: Partial<GradientFill> = {}): GradientFill => ({
    gradient: {
      type: 'linear',
      stops: presetStops('black-white', [0, 0, 0], [0, 0, 0]),
      start: { x: 0, y: 0 },
      end: { x: W, y: 0 },
      reverse: false,
    },
    opacity: 1,
    mode: 'normal',
    dither: false,
    ...o,
  });

  it('draws black to white across the canvas at pixel centres', () => {
    const out = new Map(paintGradient(white(), { width: W, height: H }, fill(), null, false));
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(out, 149, 20)).toEqual([127, 127, 127, 255]); // t = 149.5 / 300
    expect(px(out, 299, 39)).toEqual([255, 255, 255, 255]);
  });

  it('reverse, opacity and blend mode', () => {
    const rev = fill();
    rev.gradient.reverse = true;
    expect(px(new Map(paintGradient(white(), { width: W, height: H }, rev, null, false)), 0, 0)).toEqual([
      255, 255, 255, 255,
    ]);
    const half = new Map(
      paintGradient(white(), { width: W, height: H }, fill({ opacity: 0.5 }), null, false),
    );
    expect(px(half, 0, 0)).toEqual([128, 128, 128, 255]);
    // Multiply over white is the gradient itself; Screen over white stays white (no change).
    const mul = new Map(
      paintGradient(white(), { width: W, height: H }, fill({ mode: 'multiply' }), null, false),
    );
    expect(px(mul, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(paintGradient(white(), { width: W, height: H }, fill({ mode: 'screen' }), null, false)).toEqual(
      [],
    );
  });

  it('stays inside the selection, onto transparency, and keeps alpha when locked', () => {
    const sel = new Uint8Array(TILE_SIZE * TILE_SIZE);
    for (let y = 0; y < H; y++) sel.fill(255, y * TILE_SIZE, y * TILE_SIZE + 10);
    const empty = new Map<string, Uint8Array>();
    const out = new Map(
      paintGradient(empty, { width: W, height: H }, fill(), new Map([['0,0', sel]]), false),
    );
    expect(px(out, 5, 5)).toEqual([5, 5, 5, 255]); // t = 5.5 / 300
    expect(px(out, 50, 5)).toEqual([0, 0, 0, 0]); // outside the selection
    expect(out.has('1,0')).toBe(false); // no selection there: untouched
    // Transparency locked: nothing to paint on an empty layer; on a white one alpha stays.
    expect(paintGradient(empty, { width: W, height: H }, fill(), null, true)).toEqual([]);
    const ghost = white();
    for (const t of ghost.values()) for (let i = 3; i < t.length; i += 4) t[i] = 100;
    const locked = new Map(paintGradient(ghost, { width: W, height: H }, fill(), null, true));
    expect(px(locked, 0, 0)).toEqual([0, 0, 0, 100]);
  });

  it('dither keeps every pixel within half a level of the exact value', () => {
    const exact = new Map(paintGradient(white(), { width: W, height: H }, fill(), null, false));
    const dithered = new Map(
      paintGradient(white(), { width: W, height: H }, fill({ dither: true }), null, false),
    );
    let differ = 0;
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const t = (x + 0.5) / W;
        const v = px(dithered, x, y)[0]!;
        expect(Math.abs(v - t * 255)).toBeLessThanOrEqual(1);
        if (v !== px(exact, x, y)[0]) differ++;
      }
    expect(differ).toBeGreaterThan(0);
  });

  it('a click without a drag draws nothing', () => {
    const f = fill();
    f.gradient.end = { x: 0.5, y: 0 };
    expect(paintGradient(white(), { width: W, height: H }, f, null, false)).toEqual([]);
  });
});
