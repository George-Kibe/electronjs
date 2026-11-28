import type { RGBA, TextModel, TextParagraph, TextRun } from '../doc/document';
import { TileGrid } from '../tiles/tile';

/**
 * Text (FR-TXT-01..03). The engine keeps the model; laying it out and drawing it needs the browser's text
 * engine (shaping, bidi, emoji, wrapping), so the page injects a TextRenderer (lib/text-render.ts). Without
 * one (headless tests), text layers render nothing.
 */
export type TextRendering = {
  /** The text's pixels in document coordinates. */
  tiles: TileGrid;
  /** The laid-out block's size (point text: its widest line × its lines; box text: the box). */
  size: { width: number; height: number };
};

export type TextRenderer = (text: TextModel, origin: { x: number; y: number }) => TextRendering;

export const emptyRendering = (): TextRendering => ({ tiles: new TileGrid(), size: { width: 0, height: 0 } });

/** The style the Text tool's options bar sets (a whole layer in this version; per run later). */
export type TextStyle = {
  family: string;
  size: number;
  weight: number;
  italic: boolean;
  color: RGBA;
  align: TextParagraph['align'];
  lineHeight: number;
  letterSpacing: number;
  underline: boolean;
  strike: boolean;
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  family: 'sans-serif',
  size: 48,
  weight: 400,
  italic: false,
  color: [0, 0, 0, 1],
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  underline: false,
  strike: false,
};

function run(text: string, s: TextStyle): TextRun {
  return {
    text,
    font: { family: s.family, weight: s.weight, style: s.italic ? 'italic' : 'normal' },
    size: s.size,
    color: [s.color[0], s.color[1], s.color[2], s.color[3]],
    letterSpacing: s.letterSpacing,
    underline: s.underline,
    strike: s.strike,
  };
}

/** A model of `text` (lines are paragraphs) in one style. */
export function textModel(
  text: string,
  style: TextStyle,
  mode: TextModel['mode'] = 'point',
  box?: { w: number; h: number },
): TextModel {
  return {
    mode,
    ...(mode === 'box' && box ? { box } : {}),
    paragraphs: text.split('\n').map((line) => ({
      align: style.align,
      lineHeight: style.lineHeight,
      runs: [run(line, style)],
    })),
  };
}

/** The style of a model's first run (what the options bar shows while editing it). */
export function styleOf(model: TextModel): TextStyle {
  const p = model.paragraphs[0]!;
  const r = p.runs[0]!;
  return {
    family: r.font.family,
    size: r.size,
    weight: r.font.weight,
    italic: r.font.style === 'italic',
    color: [r.color[0], r.color[1], r.color[2], r.color[3]],
    align: p.align,
    lineHeight: p.lineHeight,
    letterSpacing: r.letterSpacing,
    underline: r.underline,
    strike: r.strike,
  };
}

/** The same text in another style (the whole layer). */
export function restyled(model: TextModel, style: TextStyle): TextModel {
  return textModel(
    model.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n'),
    style,
    model.mode,
    model.box,
  );
}

/** A text layer's name: its first line, shortened (Photoshop names type layers by their text). */
export function textLayerName(text: string): string {
  const first = text.split('\n').find((l) => l.trim()) ?? 'Text';
  const t = first.trim();
  return t.length > 30 ? `${t.slice(0, 29)}…` : t;
}

export const sameModel = (a: TextModel, b: TextModel): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A stretch of text as the in-place editor holds it (FR-TXT-02): the characters and what they change of
 * the layer's style. Per-character styling in v1 is colour, weight and size; the rest is the layer's.
 */
export type RunPatch = { text: string; color?: RGBA; weight?: number; size?: number };

/** Lines of runs (from the editor) as a model in `style`, each run keeping its own colour, weight, size. */
export function modelFromRuns(
  lines: RunPatch[][],
  style: TextStyle,
  mode: TextModel['mode'] = 'point',
  box?: { w: number; h: number },
): TextModel {
  const base = textModel('', style, mode, box);
  return {
    ...base,
    paragraphs: (lines.length ? lines : [[]]).map((line) => ({
      align: style.align,
      lineHeight: style.lineHeight,
      runs: (line.length ? line : [{ text: '' }]).map((r) => ({
        ...run(r.text, style),
        ...(r.color ? { color: [r.color[0], r.color[1], r.color[2], r.color[3]] as RGBA } : {}),
        ...(r.size !== undefined ? { size: r.size } : {}),
        font: { ...run('', style).font, ...(r.weight !== undefined ? { weight: r.weight } : {}) },
      })),
    })),
  };
}

/** A model's lines of runs, with only what differs from `style` (what the editor shows as overrides). */
export function runsOf(model: TextModel, style: TextStyle): RunPatch[][] {
  return model.paragraphs.map((p) =>
    p.runs
      .filter((r) => r.text !== '' || p.runs.length === 1)
      .map((r) => {
        const out: RunPatch = { text: r.text };
        const c = style.color;
        if (r.color.some((v, i) => v !== c[i])) out.color = [r.color[0], r.color[1], r.color[2], r.color[3]];
        if (r.font.weight !== style.weight) out.weight = r.font.weight;
        if (r.size !== style.size) out.size = r.size;
        return out;
      })
      .filter((r, _i, all) => r.text !== '' || all.length === 1),
  );
}

/** The plain text of editor lines. */
export const linesText = (lines: RunPatch[][]): string =>
  lines.map((l) => l.map((r) => r.text).join('')).join('\n');
