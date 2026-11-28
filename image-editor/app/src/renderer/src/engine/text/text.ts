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
