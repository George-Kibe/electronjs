import { describe, expect, it } from 'vitest';
import { DEFAULT_MARQUEE, dragMode, marqueeRect, type MarqueeDrag } from './marquee';

const drag = (over: Partial<MarqueeDrag>): MarqueeDrag => ({
  start: { x: 10, y: 20 },
  current: { x: 50, y: 40 },
  constrain: false,
  fromCentre: false,
  ...over,
});

describe('marquee (FR-SEL-01/04)', () => {
  it('modifiers at mouse-down pick the mode', () => {
    expect(dragMode('replace', false, false)).toBe('replace');
    expect(dragMode('replace', true, false)).toBe('add');
    expect(dragMode('add', false, true)).toBe('subtract');
    expect(dragMode('replace', true, true)).toBe('intersect');
    expect(dragMode('intersect', false, false)).toBe('intersect');
  });

  it('a normal drag spans the two points, in whole pixels, in any direction', () => {
    expect(marqueeRect(drag({}), DEFAULT_MARQUEE)).toEqual({ x0: 10, y0: 20, x1: 50, y1: 40 });
    expect(marqueeRect(drag({ current: { x: 2.4, y: 7.6 } }), DEFAULT_MARQUEE)).toEqual({
      x0: 2,
      y0: 8,
      x1: 10,
      y1: 20,
    });
  });

  it('Shift constrains to a square and Alt draws from the centre', () => {
    expect(marqueeRect(drag({ constrain: true }), DEFAULT_MARQUEE)).toEqual({
      x0: 10,
      y0: 20,
      x1: 50,
      y1: 60,
    });
    expect(marqueeRect(drag({ fromCentre: true }), DEFAULT_MARQUEE)).toEqual({
      x0: -30,
      y0: 0,
      x1: 50,
      y1: 40,
    });
    // Dragging up-left keeps the square on that side.
    expect(marqueeRect(drag({ current: { x: 0, y: 15 }, constrain: true }), DEFAULT_MARQUEE)).toEqual({
      x0: 0,
      y0: 10,
      x1: 10,
      y1: 20,
    });
  });

  it('a fixed ratio grows with the larger side of the drag', () => {
    const o = { ...DEFAULT_MARQUEE, style: 'ratio' as const, ratioW: 4, ratioH: 5 };
    expect(marqueeRect(drag({ current: { x: 50, y: 25 } }), o)).toEqual({ x0: 10, y0: 20, x1: 50, y1: 70 });
    expect(marqueeRect(drag({ current: { x: 14, y: 120 } }), o)).toEqual({ x0: 10, y0: 20, x1: 90, y1: 120 });
  });

  it('a fixed size follows the pointer', () => {
    const o = { ...DEFAULT_MARQUEE, style: 'size' as const, width: 100, height: 50 };
    expect(marqueeRect(drag({ current: { x: 30, y: 30 } }), o)).toEqual({ x0: 30, y0: 30, x1: 130, y1: 80 });
    expect(marqueeRect(drag({ current: { x: 30, y: 30 }, fromCentre: true }), o)).toEqual({
      x0: -20,
      y0: 5,
      x1: 80,
      y1: 55,
    });
  });
});
