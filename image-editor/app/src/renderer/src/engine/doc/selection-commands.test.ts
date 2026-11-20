import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { TileGrid } from '../tiles/tile';
import { SetSelectionCommand } from './commands';
import { createRasterLayer, Document } from './document';
import { cropDocument, rotateCanvas } from './geometry';
import { ellipseMask, Mask, rectMask } from './selection';

const doc = () =>
  new Document(300, 200, [createRasterLayer('bg', TileGrid.filled(300, 200, [255, 255, 255, 255]))]);

describe('SetSelectionCommand (FR-SEL-01..05)', () => {
  it('do → undo → redo restores each selection exactly', () => {
    const d = doc();
    const history = new History(d);
    const a = rectMask({ x0: 10, y0: 10, x1: 100, y1: 80 }, 300, 200);
    const b = a.combine('add', ellipseMask({ x0: 50, y0: 50, x1: 250, y1: 190 }, 300, 200));
    history.execute(new SetSelectionCommand('Rectangular Marquee', a));
    history.execute(new SetSelectionCommand('Elliptical Marquee', b));
    history.execute(new SetSelectionCommand('Deselect', null));
    expect(d.selection).toBeNull();
    history.undo();
    expect(d.selection).toBe(b);
    history.undo();
    expect(d.selection).toBe(a);
    history.undo();
    expect(d.selection).toBeNull();
    history.redo();
    history.redo();
    expect(d.selection).toBe(b);
  });

  it('an empty mask means no selection', () => {
    const d = doc();
    new SetSelectionCommand('Subtract', Mask.empty(300, 200)).do(d);
    expect(d.selection).toBeNull();
  });

  it('counts only the tile data it owns', () => {
    expect(new SetSelectionCommand('All', Mask.all(256, 256)).sizeBytes()).toBe(64); // one shared full tile
    expect(
      new SetSelectionCommand(
        'Ellipse',
        ellipseMask({ x0: 0, y0: 0, x1: 200, y1: 100 }, 300, 200),
      ).sizeBytes(),
    ).toBe(64 + 256 * 256);
  });
});

describe('canvas changes drop the selection', () => {
  it('rotate and crop clear it, and undo brings it back', () => {
    const d = doc();
    const history = new History(d);
    const sel = rectMask({ x0: 0, y0: 0, x1: 50, y1: 50 }, 300, 200);
    history.execute(new SetSelectionCommand('Marquee', sel));
    history.execute(rotateCanvas(d, 1));
    expect([d.width, d.height, d.selection]).toEqual([200, 300, null]);
    history.undo();
    expect([d.width, d.height]).toEqual([300, 200]);
    expect(d.selection).toBe(sel);
    history.redo();
    expect(d.selection).toBeNull();
    history.undo();
    history.execute(cropDocument(d, { x: 10, y: 10, width: 100, height: 100 }, true)!);
    expect(d.selection).toBeNull();
    history.undo();
    expect(d.selection).toBe(sel);
  });
});
