import { describe, expect, it } from 'vitest';
import type { Point } from '../doc/selection';
import { addPoint, closesPolygon, lassoLabel, lassoOutline } from './lasso';

describe('lasso (FR-SEL-02)', () => {
  it('thins freehand points closer than half a pixel', () => {
    const pts: Point[] = [];
    addPoint(pts, [0, 0]);
    addPoint(pts, [0.2, 0.1]);
    addPoint(pts, [1, 0]);
    expect(pts).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it('closes a polygon near its first vertex, measured on screen', () => {
    const pts: Point[] = [
      [10, 10],
      [50, 10],
      [50, 50],
    ];
    expect(closesPolygon(pts, [12, 12], 1)).toBe(true); // 2.8 screen px
    expect(closesPolygon(pts, [12, 12], 4)).toBe(false); // 11 screen px at 400 %
    expect(closesPolygon(pts.slice(0, 2), [10, 10], 1)).toBe(false); // needs 3 vertices
  });

  it('drops the duplicate vertex a double-click adds', () => {
    expect(
      lassoOutline([
        [0, 0],
        [5, 0],
        [5, 5],
        [5, 5],
      ]),
    ).toEqual([
      [0, 0],
      [5, 0],
      [5, 5],
    ]);
    expect(lassoLabel('polygon')).toBe('Polygonal Lasso');
  });
});
