import { describe, expect, it } from 'vitest';
import { SetTextCommand } from '../doc/commands';
import {
  createRasterLayer,
  createTextLayer,
  Document,
  plainText,
  rasterize,
  textOrigin,
  translation,
  type TextLayer,
} from '../doc/document';
import { cropDocument, flipCanvas, replacePixels, resizeCanvas, rotateCanvas } from '../doc/geometry';
import { duplicateLayer, mergeDownBlocker } from '../doc/layer-ops';
import { translateLayer } from '../doc/translate';
import { History } from '../history/history';
import { TileGrid } from '../tiles/tile';
import {
  DEFAULT_TEXT_STYLE,
  linesText,
  modelFromRuns,
  restyled,
  runsOf,
  styleOf,
  textLayerName,
  textModel,
  type RunPatch,
} from './text';

/** A document with a white background and a text layer whose "rendering" is a 100×40 block at (50, 60). */
function setup() {
  const model = textModel('Hello\nWorld', { ...DEFAULT_TEXT_STYLE, size: 30 });
  const pixels = new TileGrid();
  for (const [k, t] of TileGrid.filled(150, 100, [0, 0, 0, 255]).entries()) pixels.set(k, t);
  const text = createTextLayer('Hello', model, { x: 50, y: 60 }, pixels);
  const doc = new Document(400, 300, [
    createRasterLayer('bg', TileGrid.filled(400, 300, [255, 255, 255, 255])),
    text,
  ]);
  return { doc, text, model, history: new History(doc) };
}

const layer = (doc: Document, id: string) => doc.layer(id) as TextLayer;

describe('text layers with the other tools (FR-TXT-01)', () => {
  it('the model: plain text, style, names', () => {
    const { model } = setup();
    expect(plainText(model)).toBe('Hello\nWorld');
    expect(model.paragraphs).toHaveLength(2);
    expect(styleOf(model).size).toBe(30);
    expect(plainText(restyled(model, { ...DEFAULT_TEXT_STYLE, size: 12 }))).toBe('Hello\nWorld');
    expect(textLayerName('\n  A very long first line that goes on and on\nsecond')).toBe(
      'A very long first line that g…',
    );
  });

  it('moves with its rendering, and undo moves it back; nudges coalesce', () => {
    const { doc, text, history } = setup();
    history.execute(translateLayer(doc, text.id, 10, -5)!);
    expect(textOrigin(layer(doc, text.id))).toEqual({ x: 60, y: 55 });
    expect(layer(doc, text.id).tiles.pixel(10, 0)[3]).toBe(255); // the block moved right by 10
    history.undo();
    expect(textOrigin(layer(doc, text.id))).toEqual({ x: 50, y: 60 });
    history.execute(translateLayer(doc, text.id, 1, 0, 'Nudge')!, { coalesce: true });
    history.execute(translateLayer(doc, text.id, 1, 0, 'Nudge')!, { coalesce: true });
    expect(history.entries()).toHaveLength(1);
    history.undo();
    expect(textOrigin(layer(doc, text.id))).toEqual({ x: 50, y: 60 });
  });

  it('crop and Canvas Size keep it text and move it; rotate and flip make it pixels', () => {
    const { doc, text, history } = setup();
    history.execute(cropDocument(doc, { x: 20, y: 10, width: 300, height: 200 }, false)!);
    expect(layer(doc, text.id).type).toBe('text');
    expect(textOrigin(layer(doc, text.id))).toEqual({ x: 30, y: 50 });
    history.execute(resizeCanvas(doc, 400, 300, { x: 0.5, y: 0.5 })!);
    expect(textOrigin(layer(doc, text.id))).toEqual({ x: 80, y: 100 });
    history.execute(rotateCanvas(doc, 1));
    expect(doc.layer(text.id).type).toBe('raster');
    history.undo();
    expect(doc.layer(text.id).type).toBe('text');
    history.execute(flipCanvas(doc, 'horizontal'));
    expect(doc.layer(text.id).type).toBe('raster');
  });

  it('Image Size (pixels computed elsewhere) keeps its pixels as a raster layer', () => {
    const { doc, text, history } = setup();
    const resampled = TileGrid.filled(80, 50, [0, 0, 0, 255]);
    history.execute(
      replacePixels('Image Size', new Map([[text.id, resampled]]), {
        width: 200,
        height: 150,
        guides: { horizontal: [], vertical: [] },
      }),
    );
    const l = doc.layer(text.id);
    expect(l.type).toBe('raster');
    expect(l.type === 'raster' && l.tiles.pixel(10, 10)[3]).toBe(255);
  });

  it('duplicates as text; Merge Down into it asks to rasterize first', () => {
    const { doc, text, history } = setup();
    history.execute(duplicateLayer(doc, text.id)!);
    const copy = doc.activeLayer;
    expect(copy.type).toBe('text');
    expect(copy.type === 'text' && plainText(copy.text)).toBe('Hello\nWorld');
    expect(mergeDownBlocker(doc, copy.id)).toMatch(/rasterize it first/);
  });

  it('editing the text replaces model, position and rendering in one step, exactly undone', () => {
    const { doc, text, model, history } = setup();
    const before = [...layer(doc, text.id).tiles.entries()];
    const next = textModel('Bye', DEFAULT_TEXT_STYLE);
    history.execute(
      new SetTextCommand('Edit Type Layer', text.id, {
        text: next,
        transform: translation(70, 80),
        tiles: TileGrid.filled(20, 20, [1, 2, 3, 255]),
      }),
    );
    expect(plainText(layer(doc, text.id).text)).toBe('Bye');
    expect(textOrigin(layer(doc, text.id))).toEqual({ x: 70, y: 80 });
    expect([...layer(doc, text.id).tiles.keys()]).toEqual(['0,0']);
    history.undo();
    expect(layer(doc, text.id).text).toBe(model);
    expect(textOrigin(layer(doc, text.id))).toEqual({ x: 50, y: 60 });
    expect([...layer(doc, text.id).tiles.entries()]).toEqual(before);
    history.redo();
    expect(plainText(layer(doc, text.id).text)).toBe('Bye');
  });

  it('Rasterize Type keeps id, props, pixels and mask', () => {
    const { text } = setup();
    const r = rasterize({ ...text, opacity: 0.5 });
    expect(r.type).toBe('raster');
    expect(r.id).toBe(text.id);
    expect(r.opacity).toBe(0.5);
    expect(r.tiles).toBe(text.tiles);
    expect('text' in r).toBe(false);
  });
});

describe('per-character styling (FR-TXT-02)', () => {
  const base = { ...DEFAULT_TEXT_STYLE, size: 40, color: [0, 0, 0, 1] as [number, number, number, number] };

  it('runs keep their own colour, weight and size over the layer’s style, and read back unchanged', () => {
    const lines: RunPatch[][] = [
      [{ text: 'Hello ' }, { text: 'World', color: [255, 0, 0, 1], weight: 700 }],
      [],
      [{ text: 'big', size: 80 }],
    ];
    const model = modelFromRuns(lines, base);
    expect(model.paragraphs).toHaveLength(3);
    const world = model.paragraphs[0]!.runs[1]!;
    expect(world.color).toEqual([255, 0, 0, 1]);
    expect(world.font.weight).toBe(700);
    expect(world.size).toBe(40);
    expect(model.paragraphs[2]!.runs[0]!.size).toBe(80);
    expect(plainText(model)).toBe('Hello World\n\nbig');
    // What the editor shows is only what differs from the layer, and it rebuilds the same model.
    expect(runsOf(model, base)).toEqual([
      [{ text: 'Hello ' }, { text: 'World', color: [255, 0, 0, 1], weight: 700 }],
      [{ text: '' }],
      [{ text: 'big', size: 80 }],
    ]);
    expect(modelFromRuns(runsOf(model, base), base)).toEqual(model);
    expect(linesText(lines)).toBe('Hello World\n\nbig');
  });

  it('a whole-layer change of the base leaves per-character overrides as they are', () => {
    const model = modelFromRuns([[{ text: 'a' }, { text: 'b', color: [0, 0, 255, 1] }]], base);
    const bigger = modelFromRuns(runsOf(model, base), { ...base, size: 60, color: [0, 128, 0, 1] });
    expect(bigger.paragraphs[0]!.runs[0]!.color).toEqual([0, 128, 0, 1]);
    expect(bigger.paragraphs[0]!.runs[1]!.color).toEqual([0, 0, 255, 1]);
    expect(bigger.paragraphs[0]!.runs.every((r) => r.size === 60)).toBe(true);
  });
});
