import type { TextModel, TextRun } from '../engine/doc/document';
import type { TextRendering } from '../engine/text/text';
import { createTile, parseTileKey, TILE_SIZE, TileGrid, tileKeysInRect } from '../engine/tiles/tile';

/**
 * The page's text engine for text layers (FR-TXT-01..03). Chromium lays the text out in a hidden element
 * (shaping, bidi, emoji, wrapping: what the in-place editor shows, with the same CSS), and each word it
 * placed is painted with the same font onto 256 px tile canvases, so nothing canvas-sized is allocated.
 */

const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
]);

const family = (f: string) => (GENERIC.has(f) ? f : `"${f.replace(/["\\]/g, '')}"`);

export const cssFont = (r: TextRun) =>
  `${r.font.style} ${r.font.weight} ${r.size}px ${family(r.font.family)}`;

const rgba = (c: TextRun['color']) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

/** CSS of a run (a span here; the whole editor while a layer has one style). */
export function runCss(r: TextRun): Record<string, string> {
  const decoration = [r.underline ? 'underline' : '', r.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ');
  return {
    font: cssFont(r),
    color: rgba(r.color),
    letterSpacing: `${r.letterSpacing}px`,
    textDecoration: decoration || 'none',
  };
}

/** CSS of the text block: point text keeps its lines, box text wraps at the box's width. */
export function blockCss(model: TextModel): Record<string, string> {
  return {
    whiteSpace: model.mode === 'box' ? 'pre-wrap' : 'pre',
    overflowWrap: 'break-word',
    width: model.mode === 'box' && model.box ? `${model.box.w}px` : 'max-content',
    margin: '0',
    padding: '0',
    textRendering: 'geometricPrecision',
  };
}

function textDom(model: TextModel): { root: HTMLDivElement; spans: Array<[HTMLSpanElement, TextRun]> } {
  const root = document.createElement('div');
  Object.assign(root.style, blockCss(model));
  const spans: Array<[HTMLSpanElement, TextRun]> = [];
  for (const p of model.paragraphs) {
    const line = document.createElement('div');
    line.style.textAlign = p.align;
    line.style.lineHeight = String(p.lineHeight);
    for (const r of p.runs) {
      const span = document.createElement('span');
      Object.assign(span.style, runCss(r));
      // An empty line still takes its height.
      span.textContent = r.text || (p.runs.length === 1 ? '\u200b' : '');
      line.append(span);
      spans.push([span, r]);
    }
    root.append(line);
  }
  return { root, spans };
}

let host: HTMLDivElement | null = null;

function layoutHost(): HTMLDivElement {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    contain: 'layout style',
  });
  document.body.append(host);
  return host;
}

type Fragment = {
  run: TextRun;
  text: string;
  left: number;
  right: number;
  top: number;
  rtl: boolean;
  /** Graphemes so far (one alone has no direction yet). */
  count: number;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The words the layout placed, each with its box (in px from the block's top-left), in drawing order. */
function fragments(spans: Array<[HTMLSpanElement, TextRun]>, base: DOMRect): Fragment[] {
  const out: Fragment[] = [];
  const range = document.createRange();
  for (const [span, run] of spans) {
    const node = span.firstChild;
    if (!(node instanceof Text)) continue;
    let cur: Fragment | null = null;
    for (const seg of segmenter.segment(node.data)) {
      if (/^\s+$/u.test(seg.segment) || seg.segment === '\u200b') {
        cur = null; // words are placed one by one (wrapping and justified spaces come from the layout)
        continue;
      }
      range.setStart(node, seg.index);
      range.setEnd(node, seg.index + seg.segment.length);
      const r = range.getClientRects()[0];
      if (!r || r.width === 0) continue;
      const left = r.left - base.left;
      const right = r.right - base.left;
      const top = r.top - base.top;
      // In logical order a word goes on to the right (left-to-right script) or to the left (right-to-left).
      const sameLine = cur !== null && Math.abs(cur.top - top) < 0.5;
      if (cur && sameLine && !cur.rtl && left >= cur.right - 0.75) {
        cur.text += seg.segment;
        cur.right = right;
        cur.count++;
      } else if (cur && sameLine && (cur.rtl || cur.count === 1) && right <= cur.left + 0.75) {
        cur.text += seg.segment;
        cur.left = left;
        cur.rtl = true;
        cur.count++;
      } else {
        cur = { run, text: seg.segment, left, right, top, rtl: false, count: 1 };
        out.push(cur);
      }
    }
  }
  return out;
}

type Decoration = { run: TextRun; left: number; right: number; top: number; height: number };

function decorations(spans: Array<[HTMLSpanElement, TextRun]>, base: DOMRect): Decoration[] {
  const out: Decoration[] = [];
  for (const [span, run] of spans) {
    if (!run.underline && !run.strike) continue;
    for (const r of span.getClientRects())
      out.push({
        run,
        left: r.left - base.left,
        right: r.right - base.left,
        top: r.top - base.top,
        height: r.height,
      });
  }
  return out;
}

let tileCanvas: OffscreenCanvas | null = null;

/** Lays out and draws `model` with its top-left corner at `origin` (document px). */
export function renderText(model: TextModel, origin: { x: number; y: number }): TextRendering {
  const { root, spans } = textDom(model);
  layoutHost().replaceChildren(root);
  const base = root.getBoundingClientRect();
  const frags = fragments(spans, base);
  const decos = decorations(spans, base);
  layoutHost().replaceChildren();
  const width = model.mode === 'box' && model.box ? model.box.w : Math.ceil(base.width);
  const height = model.mode === 'box' && model.box ? model.box.h : Math.ceil(base.height);
  const tiles = new TileGrid();
  if (frags.length === 0) return { tiles, size: { width, height } };

  // Glyphs overhang their boxes (italics, accents, large sizes): paint a margin of one em around them.
  const pad = Math.max(...frags.map((f) => f.run.size));
  const x0 = Math.min(...frags.map((f) => f.left)) - pad;
  const x1 = Math.max(...frags.map((f) => f.right)) + pad;
  const y0 = Math.min(...frags.map((f) => f.top)) - pad;
  const y1 = Math.max(...frags.map((f) => f.top + f.run.size * 2)) + pad;
  tileCanvas ??= new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = tileCanvas.getContext('2d', { willReadFrequently: true })!;
  for (const key of tileKeysInRect(origin.x + x0, origin.y + y0, origin.x + x1, origin.y + y1)) {
    const [tx, ty] = parseTileKey(key);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    // The clip of a text box must not carry over to the next tile (the canvas is reused).
    ctx.save();
    ctx.translate(origin.x - tx * TILE_SIZE, origin.y - ty * TILE_SIZE);
    if (model.mode === 'box' && model.box) {
      // A text box shows only what fits in it.
      ctx.beginPath();
      ctx.rect(0, 0, model.box.w, model.box.h);
      ctx.clip();
    }
    for (const f of frags) {
      ctx.font = cssFont(f.run);
      ctx.letterSpacing = `${f.run.letterSpacing}px`;
      ctx.fillStyle = rgba(f.run.color);
      ctx.textBaseline = 'alphabetic';
      ctx.direction = f.rtl ? 'rtl' : 'ltr';
      ctx.textAlign = f.rtl ? 'right' : 'left';
      const ascent = ctx.measureText(f.text).fontBoundingBoxAscent;
      ctx.fillText(f.text, f.rtl ? f.right : f.left, f.top + ascent);
    }
    for (const d of decos) {
      ctx.font = cssFont(d.run);
      const m = ctx.measureText('x');
      const thickness = Math.max(1, d.run.size / 16);
      ctx.fillStyle = rgba(d.run.color);
      const baseline = d.top + m.fontBoundingBoxAscent;
      if (d.run.underline) ctx.fillRect(d.left, baseline + thickness * 1.5, d.right - d.left, thickness);
      if (d.run.strike)
        ctx.fillRect(d.left, baseline - m.fontBoundingBoxAscent * 0.3, d.right - d.left, thickness);
    }
    ctx.restore();
    const image = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    let any = false;
    for (let i = 3; i < image.data.length; i += 4)
      if (image.data[i] !== 0) {
        any = true;
        break;
      }
    if (any) tiles.set(key, createTile(new Uint8ClampedArray(image.data.buffer)));
  }
  return { tiles, size: { width, height } };
}
