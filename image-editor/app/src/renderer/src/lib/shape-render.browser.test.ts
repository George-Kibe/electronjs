import { describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE_STYLE, shapeModel, type ShapeStyle } from '../engine/shape/shape';
import { TILE_SIZE, type TileGrid } from '../engine/tiles/tile';
import { renderShape } from './shape-render';

/** The shape renderer in Chromium (FR-PNT-08). */

const style = (o: Partial<ShapeStyle> = {}): ShapeStyle => ({ ...DEFAULT_SHAPE_STYLE, ...o });

function at(tiles: TileGrid, x: number, y: number): number[] {
  const t = tiles.get(`${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`);
  if (!t) return [0, 0, 0, 0];
  const i = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4;
  return [...t.data.subarray(i, i + 4)];
}

describe('shape rendering (FR-PNT-08)', () => {
  it('fills a rectangle exactly over its box, at its origin, across tiles', () => {
    const tiles = renderShape(shapeModel(style({ fill: [255, 0, 0, 1] }), 300, 100), { x: 100, y: 50 });
    expect(at(tiles, 100, 50)).toEqual([255, 0, 0, 255]);
    expect(at(tiles, 399, 149)).toEqual([255, 0, 0, 255]); // in the next tile over
    expect(at(tiles, 99, 50)[3]).toBe(0);
    expect(at(tiles, 400, 149)[3]).toBe(0);
  });

  it('strokes inside, centred on, or outside the outline', () => {
    const stroked = (strokeAlign: ShapeStyle['strokeAlign']) =>
      renderShape(
        shapeModel(style({ fill: null, stroke: [0, 0, 255, 1], strokeWidth: 10, strokeAlign }), 100, 100),
        { x: 50, y: 50 },
      );
    const inside = stroked('inside');
    expect(at(inside, 55, 100)).toEqual([0, 0, 255, 255]);
    expect(at(inside, 45, 100)[3]).toBe(0);
    const outside = stroked('outside');
    expect(at(outside, 45, 100)).toEqual([0, 0, 255, 255]);
    expect(at(outside, 55, 100)[3]).toBe(0);
    const centre = stroked('center');
    expect(at(centre, 47, 100)[3]).toBe(255);
    expect(at(centre, 53, 100)[3]).toBe(255);
    expect(at(centre, 100, 100)[3]).toBe(0); // no fill
  });

  it('an ellipse leaves its box corners empty', () => {
    const tiles = renderShape(shapeModel(style({ kind: 'ellipse' }), 100, 60), { x: 0, y: 0 });
    expect(at(tiles, 50, 30)[3]).toBe(255);
    expect(at(tiles, 2, 2)[3]).toBe(0);
    expect(at(tiles, 97, 57)[3]).toBe(0);
  });

  it('dashes leave gaps along the stroke', () => {
    const tiles = renderShape(
      shapeModel(style({ kind: 'line', stroke: [0, 0, 0, 1], strokeWidth: 4, dash: 'dashed' }), 200, 0),
      { x: 10, y: 20 },
    );
    let on = 0;
    let off = 0;
    for (let x = 15; x < 205; x++) {
      if (at(tiles, x, 20)[3]! > 128) on++;
      else off++;
    }
    expect(on).toBeGreaterThan(50);
    expect(off).toBeGreaterThan(30);
  });

  it('a line with an arrowhead is wider at its end', () => {
    const tiles = renderShape(
      shapeModel(style({ kind: 'line', stroke: [0, 0, 0, 1], strokeWidth: 2, arrowEnd: true }), 200, 0),
      { x: 10, y: 50 },
    );
    expect(at(tiles, 203, 53)[3]).toBeGreaterThan(0); // inside the arrowhead (6 px each side at its base), off the line
    expect(at(tiles, 50, 54)[3]).toBe(0);
  });
});
