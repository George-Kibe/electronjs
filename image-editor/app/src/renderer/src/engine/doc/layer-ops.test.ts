import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { TileGrid } from '../tiles/tile';
import { blendChannel, blendModeIndex, IMPLEMENTED_BLEND_MODES } from './blend';
import { AddLayerCommand, type Command } from './commands';
import { createGroupLayer, createRasterLayer, Document, type Layer } from './document';
import { compositePixel, liveLayers } from './flatten';
import {
  duplicateLayer,
  flattenImage,
  groupLayer,
  mergeDown,
  mergeDownBlocker,
  mergeVisible,
  moveLayer,
  nudgeLayer,
  ungroupLayer,
} from './layer-ops';

const W = 300;
const H = 280;
const solid = (name: string, rgba: [number, number, number, number], props = {}) =>
  createRasterLayer(name, TileGrid.filled(W, H, rgba), props);

function doc(...layers: Layer[]): Document {
  return new Document(W, H, layers.length ? layers : [solid('bg', [255, 255, 255, 255])]);
}

/** Everything observable about the tree: ids, structure, props and tile identities. */
function shape(layers: readonly Layer[]): unknown {
  return layers.map((l) =>
    l.type === 'group'
      ? {
          id: l.id,
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          pt: l.passThrough,
          children: shape(l.children),
        }
      : {
          id: l.id,
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          mode: l.blendMode,
          tiles: [...l.tiles.entries()].map(([k, t]) => `${k}#${t.id}`),
        },
  );
}

const pixel = (d: Document, x = 10, y = 10) => compositePixel(liveLayers(d.layers), x, y);

function roundTrip(d: Document, cmd: Command | null): void {
  expect(cmd).not.toBeNull();
  const before = shape(d.layers);
  const activeBefore = d.activeLayerId;
  const history = new History(d);
  history.execute(cmd!);
  const after = shape(d.layers);
  const activeAfter = d.activeLayerId;
  history.undo();
  expect(shape(d.layers)).toEqual(before);
  expect(d.activeLayerId).toBe(activeBefore);
  history.redo();
  expect(shape(d.layers)).toEqual(after);
  expect(d.activeLayerId).toBe(activeAfter);
}

describe('blend modes (W3C Compositing §10.2, CPU reference)', () => {
  it('matches the spec on reference values', () => {
    const m = (mode: (typeof IMPLEMENTED_BLEND_MODES)[number], cb: number, cs: number) =>
      blendChannel(blendModeIndex(mode), cb, cs);
    expect(m('multiply', 0.5, 0.5)).toBeCloseTo(0.25);
    expect(m('screen', 0.5, 0.5)).toBeCloseTo(0.75);
    expect(m('darken', 0.3, 0.6)).toBe(0.3);
    expect(m('lighten', 0.3, 0.6)).toBe(0.6);
    expect(m('difference', 0.2, 0.7)).toBeCloseTo(0.5);
    expect(m('overlay', 0.25, 0.5)).toBeCloseTo(0.25); // cb ≤ 0.5: multiply(cs, 2cb)
    expect(m('overlay', 0.75, 0.5)).toBeCloseTo(0.75);
    expect(m('hard-light', 0.5, 0.25)).toBeCloseTo(0.25);
    expect(m('soft-light', 0.5, 0.5)).toBeCloseTo(0.5);
    expect(m('soft-light', 0.25, 1)).toBeCloseTo(0.5); // D(0.25) = 0.25·(… ) branch
  });

  it('keeps every mode in range and treats unimplemented modes as Normal', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (cb, cs) => {
          for (let mode = 0; mode < IMPLEMENTED_BLEND_MODES.length; mode++) {
            const v = blendChannel(mode, cb, cs);
            expect(v).toBeGreaterThanOrEqual(-1e-9);
            expect(v).toBeLessThanOrEqual(1 + 1e-9);
          }
        },
      ),
    );
    expect(blendModeIndex('hue')).toBe(0);
  });

  it('composites a multiply layer onto its backdrop, and onto transparency as Normal', () => {
    const d = doc(
      solid('bg', [200, 100, 50, 255]),
      solid('top', [128, 255, 0, 255], { blendMode: 'multiply' }),
    );
    expect(pixel(d)).toEqual([100, 100, 0, 255]);
    const onEmpty = doc(solid('top', [128, 255, 0, 255], { blendMode: 'multiply' }));
    expect(pixel(onEmpty)).toEqual([128, 255, 0, 255]); // αb = 0: Cs' = Cs
  });
});

describe('groups in the CPU compositor', () => {
  it('pass-through groups are transparent to blending; isolated groups blend as a unit', () => {
    const bg = solid('bg', [200, 200, 200, 255]);
    const mult = solid('m', [128, 128, 128, 255], { blendMode: 'multiply' });
    const pass = doc(bg, createGroupLayer('g', [mult]));
    expect(pixel(pass)).toEqual([100, 100, 100, 255]); // multiplies with bg through the group
    const isolated = doc(
      solid('bg', [200, 200, 200, 255]),
      createGroupLayer('g', [solid('m', [128, 128, 128, 255], { blendMode: 'multiply' })], {
        passThrough: false,
      }),
    );
    expect(pixel(isolated)).toEqual([128, 128, 128, 255]); // multiply saw only transparency inside the group
  });

  it('applies group opacity and hides hidden groups', () => {
    const g = createGroupLayer('g', [solid('red', [255, 0, 0, 255])], { opacity: 0.5 });
    const d = doc(solid('bg', [255, 255, 255, 255]), g);
    expect(pixel(d)).toEqual([255, 128, 128, 255]);
    g.visible = false;
    expect(pixel(d)).toEqual([255, 255, 255, 255]);
  });
});

describe('layer operations (FR-LAY-02): exact undo/redo', () => {
  it('duplicate shares tiles, names the copy and selects it', () => {
    const top = solid('Paint', [1, 2, 3, 255]);
    const d = doc(solid('bg', [255, 255, 255, 255]), top);
    roundTrip(d, duplicateLayer(d, top.id)); // leaves the document in the state after the command
    const copy = d.layers[2]!;
    expect(copy.name).toBe('Paint copy');
    expect(copy.id).not.toBe(top.id);
    expect(d.activeLayerId).toBe(copy.id);
    if (copy.type === 'raster') expect(copy.tiles.get('0,0')).toBe(top.tiles.get('0,0'));
  });

  it('group and ungroup restore the original structure', () => {
    const a = solid('a', [255, 0, 0, 255]);
    const d = doc(solid('bg', [255, 255, 255, 255]), a);
    roundTrip(d, groupLayer(d, a.id));
    const group = d.layers[1]!;
    expect(group.type).toBe('group');
    roundTrip(d, ungroupLayer(d, group.id));
    expect(ungroupLayer(d, a.id)).toBeNull(); // not a group
  });

  it('moves layers between groups and refuses moving a group into itself', () => {
    const a = solid('a', [255, 0, 0, 255]);
    const inner = solid('inner', [0, 0, 255, 255]);
    const g = createGroupLayer('g', [inner]);
    const d = doc(solid('bg', [255, 255, 255, 255]), a, g);
    expect(moveLayer(d, a.id, null, 1)).toBeNull(); // already there
    expect(moveLayer(d, g.id, g.id, 0)).toBeNull();
    expect(nudgeLayer(d, g.id, 1)).toBeNull(); // already on top
    roundTrip(d, nudgeLayer(d, a.id, 1));
    roundTrip(d, moveLayer(d, a.id, g.id, 1));
    expect(d.locate(a.id).parent?.id).toBe(g.id);
  });

  it('merge down composites with the upper layer blend mode and keeps the lower layer props', () => {
    const lower = solid('Lower', [200, 100, 50, 255], { opacity: 0.8 });
    const upper = solid('Upper', [128, 255, 0, 255], { blendMode: 'multiply' });
    const d = doc(lower, upper);
    const expected = compositePixel(liveLayers([{ ...lower, opacity: 1 }, upper]), 5, 5);
    roundTrip(d, mergeDown(d, upper.id));
    expect(d.layers).toHaveLength(1);
    const merged = d.layers[0]!;
    expect(merged.name).toBe('Lower');
    expect(merged.opacity).toBe(0.8);
    if (merged.type === 'raster') expect(merged.tiles.pixel(5, 5)).toEqual(expected);
  });

  it('refuses merge down in the cases the UI disables', () => {
    const bottom = solid('b', [0, 0, 0, 255]);
    const top = solid('t', [0, 0, 0, 255]);
    const d = doc(bottom, top);
    expect(mergeDownBlocker(d, bottom.id)).toMatch(/no layer below/);
    top.visible = false;
    expect(mergeDownBlocker(d, top.id)).toMatch(/visible/);
    top.visible = true;
    bottom.locks = { ...bottom.locks, pixels: true };
    expect(mergeDownBlocker(d, top.id)).toMatch(/locked/);
    expect(mergeDown(d, top.id)).toBeNull();
  });

  it('merge visible keeps hidden layers and the composite is unchanged', () => {
    const hidden = solid('hidden', [0, 255, 0, 255], { visible: false });
    const d = doc(
      solid('bg', [255, 255, 255, 255]),
      hidden,
      solid('half', [255, 0, 0, 255], { opacity: 0.5 }),
    );
    const before = pixel(d);
    roundTrip(d, mergeVisible(d));
    expect(d.layers.map((l) => l.name)).toEqual(['bg', 'hidden']);
    expect(pixel(d)).toEqual(before);
  });

  it('flatten produces one opaque Background over white', () => {
    const d = doc(solid('half', [255, 0, 0, 128]), solid('gone', [0, 0, 0, 255], { visible: false }));
    roundTrip(d, flattenImage(d));
    expect(d.layers.map((l) => l.name)).toEqual(['Background']);
    expect(pixel(d)).toEqual([255, 127, 127, 255]);
    expect(pixel(d, W - 1, H - 1)[3]).toBe(255);
  });

  it('random sequences of operations undo back to the initial tree (T-HIS-01 style)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), fc.nat(), fc.nat()), { maxLength: 25 }),
        (ops) => {
          const d = doc(
            solid('bg', [255, 255, 255, 255]),
            solid('a', [255, 0, 0, 200]),
            createGroupLayer('g', [solid('b', [0, 0, 255, 128])]),
          );
          const initial = shape(d.layers);
          const history = new History(d, { maxSteps: 1000, maxBytes: 1024 ** 3 });
          for (const [op, i, j] of ops) {
            const all = d.allLayers();
            const target = all[i % all.length]!;
            const groups = all.filter((l) => l.type === 'group');
            const cmd =
              op === 0
                ? duplicateLayer(d, target.id)
                : op === 1
                  ? groupLayer(d, target.id)
                  : op === 2
                    ? ungroupLayer(d, target.id)
                    : op === 3
                      ? mergeDown(d, target.id)
                      : op === 4
                        ? moveLayer(d, target.id, groups.length ? groups[j % groups.length]!.id : null, j % 3)
                        : op === 5
                          ? new AddLayerCommand(`L${j}`, 0, null)
                          : mergeVisible(d);
            if (cmd) history.execute(cmd);
          }
          while (history.undo());
          expect(shape(d.layers)).toEqual(initial);
        },
      ),
      { numRuns: 60 },
    );
  });
});
