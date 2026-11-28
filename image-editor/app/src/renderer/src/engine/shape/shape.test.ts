import { describe, expect, it } from 'vitest';
import { SetShapeCommand } from '../doc/commands';
import { createRasterLayer, createShapeLayer, Document, textOrigin, type ShapeLayer } from '../doc/document';
import { cropDocument, rotateCanvas } from '../doc/geometry';
import { translateLayer } from '../doc/translate';
import { History } from '../history/history';
import { TileGrid } from '../tiles/tile';
import {
  arrowPaths,
  DEFAULT_SHAPE_STYLE,
  reshaped,
  shapeBounds,
  shapeModel,
  shapePath,
  styleOfShape,
  type ShapeStyle,
} from './shape';

const style = (o: Partial<ShapeStyle> = {}): ShapeStyle => ({ ...DEFAULT_SHAPE_STYLE, ...o });

describe('shape models and outlines (FR-PNT-08)', () => {
  it('outlines each kind in its box', () => {
    expect(shapePath(shapeModel(style(), 100, 50))).toBe('M0 0H100V50H0Z');
    expect(shapePath(shapeModel(style({ kind: 'rounded-rect', radius: 10 }), 100, 50))).toMatch(
      /^M10 0H90A10 10/,
    );
    // A radius larger than half the box is limited to it.
    expect(shapePath(shapeModel(style({ kind: 'rounded-rect', radius: 999 }), 100, 50))).toMatch(
      /^M25 0H75A25 25/,
    );
    expect(shapePath(shapeModel(style({ kind: 'ellipse' }), 100, 50))).toBe(
      'M0 25A50 25 0 1 0 100 25A50 25 0 1 0 0 25Z',
    );
    const tri = shapePath(shapeModel(style({ kind: 'polygon', sides: 3 }), 100, 100));
    expect(tri.split('L')).toHaveLength(3);
    expect(tri.startsWith('M50 0')).toBe(true); // a corner at the top
    expect(shapePath(shapeModel(style({ kind: 'star', points: 5 }), 100, 100)).split('L')).toHaveLength(10);
    expect(shapePath(shapeModel(style({ kind: 'line' }), 30, -40))).toBe('M0 0L30 -40');
  });

  it('a line is all stroke, with arrowheads where asked', () => {
    const line = shapeModel(style({ kind: 'line', arrowEnd: true, strokeWidth: 2 }), 100, 0);
    expect(line.fill.type).toBe('none');
    expect(line.stroke?.align).toBe('center');
    const [end] = arrowPaths(line);
    expect(end).toMatch(/^M100 0L91/); // the tip at the end, the base back along the line
    expect(arrowPaths(shapeModel(style({ kind: 'line' }), 100, 0))).toEqual([]);
  });

  it('the options bar reads a shape layer back, and restyling keeps its kind and size', () => {
    const s = shapeModel(style({ kind: 'star', points: 7, stroke: [255, 0, 0, 1], dash: 'dashed' }), 80, 60);
    const back = styleOfShape(s, DEFAULT_SHAPE_STYLE);
    expect(back).toMatchObject({ kind: 'star', points: 7, stroke: [255, 0, 0, 1], dash: 'dashed' });
    const blue = reshaped(s, { ...back, kind: 'rect', fill: [0, 0, 255, 1] });
    expect(blue.kind).toBe('star');
    expect(blue.params).toMatchObject({ w: 80, h: 60, points: 7 });
    expect(blue.fill).toEqual({ type: 'solid', color: [0, 0, 255, 1] });
  });

  it('bounds include the stroke outside the box', () => {
    const inside = shapeBounds(shapeModel(style({ stroke: [0, 0, 0, 1], strokeWidth: 10 }), 100, 50));
    const outside = shapeBounds(
      shapeModel(style({ stroke: [0, 0, 0, 1], strokeWidth: 10, strokeAlign: 'outside' }), 100, 50),
    );
    expect(outside.x0).toBeLessThan(inside.x0 - 9);
    expect(outside.x1).toBeGreaterThan(inside.x1 + 9);
  });
});

describe('shape layers with the other tools (FR-PNT-08)', () => {
  function setup() {
    const shape = shapeModel(style(), 100, 50);
    const layer = createShapeLayer(
      'Rectangle 1',
      shape,
      { x: 40, y: 30 },
      TileGrid.filled(140, 80, [0, 0, 0, 255]),
    );
    const doc = new Document(400, 300, [
      createRasterLayer('bg', TileGrid.filled(400, 300, [255, 255, 255, 255])),
      layer,
    ]);
    return { doc, layer, shape, history: new History(doc) };
  }
  const shapeOf = (doc: Document, id: string) => doc.layer(id) as ShapeLayer;

  it('moves with its pixels; crop keeps it a shape; rotate makes it pixels', () => {
    const { doc, layer, history } = setup();
    history.execute(translateLayer(doc, layer.id, 5, 7)!);
    expect(textOrigin(shapeOf(doc, layer.id))).toEqual({ x: 45, y: 37 });
    history.execute(cropDocument(doc, { x: 10, y: 10, width: 300, height: 200 }, false)!);
    expect(shapeOf(doc, layer.id).type).toBe('shape');
    expect(textOrigin(shapeOf(doc, layer.id))).toEqual({ x: 35, y: 27 });
    history.execute(rotateCanvas(doc, 2));
    expect(doc.layer(layer.id).type).toBe('raster');
    history.undo();
    expect(doc.layer(layer.id).type).toBe('shape');
  });

  it('restyling is one step, slider drags coalesce, and undo brings the old shape and pixels back', () => {
    const { doc, layer, shape, history } = setup();
    const before = [...shapeOf(doc, layer.id).tiles.entries()];
    for (const width of [2, 3, 4]) {
      const next = shapeModel(style({ stroke: [255, 0, 0, 1], strokeWidth: width }), 100, 50);
      history.execute(
        new SetShapeCommand('Edit Shape', layer.id, {
          shape: next,
          transform: layer.transform,
          tiles: new TileGrid(),
        }),
        { coalesce: true },
      );
    }
    expect(history.entries()).toHaveLength(1);
    expect(shapeOf(doc, layer.id).shape.stroke?.width).toBe(4);
    history.undo();
    expect(shapeOf(doc, layer.id).shape).toBe(shape);
    expect([...shapeOf(doc, layer.id).tiles.entries()]).toEqual(before);
  });
});
