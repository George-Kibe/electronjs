import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { SetGuidesCommand } from '../doc/commands';
import { createRasterLayer, Document } from '../doc/document';
import { TileGrid } from '../tiles/tile';
import { snapOffset, snapTargets } from './snap';

describe('snapping and guides (FR-NAV-04)', () => {
  it('snaps the nearest value within the threshold, else nothing', () => {
    expect(snapOffset([10, 52], [0, 50, 100], 4)).toEqual({ offset: -2, target: 50 });
    expect(snapOffset([10, 30], [0, 50, 100], 4)).toEqual({ offset: 0, target: null });
    expect(snapOffset([97.5], [100], 4)).toEqual({ offset: 2.5, target: 100 });
  });

  it('targets: guides, the canvas edges and centre, and other visible layers’ edges', () => {
    const rgba = new Uint8ClampedArray(200 * 100 * 4);
    for (let y = 20; y < 40; y++) for (let x = 30; x < 70; x++) rgba.set([1, 2, 3, 255], (y * 200 + x) * 4);
    const box = createRasterLayer('box', TileGrid.fromRgba(200, 100, rgba));
    const hidden = createRasterLayer('hidden', TileGrid.fromRgba(200, 100, rgba), { visible: false });
    const doc = new Document(200, 100, [box, hidden]);
    doc.meta.guides = { horizontal: [60], vertical: [150] };
    const t = snapTargets(doc);
    expect(t.x).toEqual(expect.arrayContaining([0, 100, 200, 150, 30, 70]));
    expect(t.y).toEqual(expect.arrayContaining([0, 50, 100, 60, 20, 40]));
    expect(snapTargets(doc, new Set([box.id])).x).not.toContain(30); // the moving layer is left out
  });

  it('guide changes are undo steps', () => {
    const doc = new Document(100, 100, createRasterLayer('bg', new TileGrid()));
    const history = new History(doc, { maxSteps: 10, maxBytes: 1e9 }, () => undefined);
    history.execute(new SetGuidesCommand('New Guide', { horizontal: [], vertical: [40] }));
    history.execute(new SetGuidesCommand('Move Guide', { horizontal: [], vertical: [55] }));
    expect(doc.meta.guides.vertical).toEqual([55]);
    history.undo();
    expect(doc.meta.guides.vertical).toEqual([40]);
    history.undo();
    expect(doc.meta.guides.vertical).toEqual([]);
  });
});
