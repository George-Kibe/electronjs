import { describe, expect, it } from 'vitest';
import type { TextModel } from '../engine/doc/document';
import { DEFAULT_TEXT_STYLE, textModel } from '../engine/text/text';
import { TILE_SIZE, type TileGrid } from '../engine/tiles/tile';
import { renderText } from './text-render';

/** The text renderer in Chromium (FR-TXT-01..03): layout by the DOM, painted onto tiles. */

/** Bounds and colours of the painted pixels. */
function scan(tiles: TileGrid) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const colours = new Set<string>();
  for (const [key, t] of tiles.entries()) {
    const [tx, ty] = key.split(',').map(Number) as [number, number];
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
      const a = t.data[i * 4 + 3]!;
      if (a < 128) continue;
      const x = tx * TILE_SIZE + (i % TILE_SIZE);
      const y = ty * TILE_SIZE + Math.floor(i / TILE_SIZE);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      if (a === 255) colours.add(`${t.data[i * 4]},${t.data[i * 4 + 1]},${t.data[i * 4 + 2]}`);
    }
  }
  return { x0, y0, x1, y1, colours };
}

const style = { ...DEFAULT_TEXT_STYLE, family: 'sans-serif', size: 40 };

describe('text rendering (FR-TXT-01..03)', () => {
  it('point text sits at its origin, one line, as wide as the text', () => {
    const r = renderText(textModel('Hello', style), { x: 300, y: 200 });
    const b = scan(r.tiles);
    expect(b.x0).toBeGreaterThanOrEqual(300);
    expect(b.x0).toBeLessThan(310);
    expect(b.y0).toBeGreaterThanOrEqual(200);
    expect(b.y1).toBeLessThan(200 + 40 * 1.2 + 2);
    expect(r.size.width).toBeGreaterThan(60);
    expect(b.x1).toBeLessThanOrEqual(300 + r.size.width + 2);
    expect(b.colours).toEqual(new Set(['0,0,0']));
  });

  it('box text wraps inside the box, and nothing shows below it', () => {
    const words = 'one two three four five six seven eight nine ten';
    const r = renderText(textModel(words, style, 'box', { w: 150, h: 120 }), { x: 0, y: 0 });
    const b = scan(r.tiles);
    expect(b.x1).toBeLessThan(150);
    expect(b.y1).toBeGreaterThan(48); // a second line at least
    expect(b.y1).toBeLessThan(120); // clipped to the box
    expect(r.size).toEqual({ width: 150, height: 120 });
  });

  it('runs keep their own colours (per-character styling)', () => {
    const model: TextModel = textModel('Red', style);
    model.paragraphs[0]!.runs.push({ ...model.paragraphs[0]!.runs[0]!, text: 'Blue', color: [0, 0, 255, 1] });
    model.paragraphs[0]!.runs[0]!.color = [255, 0, 0, 1];
    const b = scan(renderText(model, { x: 0, y: 0 }).tiles);
    expect(b.colours.has('255,0,0')).toBe(true);
    expect(b.colours.has('0,0,255')).toBe(true);
  });

  it('right alignment puts lines against the right edge of the box', () => {
    const r = renderText(textModel('Hi', { ...style, align: 'right' }, 'box', { w: 400, h: 60 }), {
      x: 0,
      y: 0,
    });
    const b = scan(r.tiles);
    expect(b.x0).toBeGreaterThan(300);
    expect(b.x1).toBeGreaterThan(380);
  });

  it('shapes right-to-left text and emoji (Chromium’s text engine)', () => {
    const arabic = scan(renderText(textModel('مرحبا بالعالم', style), { x: 0, y: 0 }).tiles);
    expect(arabic.x1 - arabic.x0).toBeGreaterThan(80);
    const emoji = renderText(textModel('👍🏽 ok', style), { x: 0, y: 0 });
    expect(scan(emoji.tiles).x1).toBeGreaterThan(40);
  });

  it('underline draws under the letters', () => {
    const plain = scan(renderText(textModel('xxxx', style), { x: 0, y: 0 }).tiles);
    const under = scan(renderText(textModel('xxxx', { ...style, underline: true }), { x: 0, y: 0 }).tiles);
    expect(under.y1).toBeGreaterThan(plain.y1);
  });
});
