import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { RGBA } from '../../engine/doc/document';
import type { Editor, TextEditState } from '../../engine/editor';
import { textModel, type RunPatch } from '../../engine/text/text';
import { blockCss, runCss } from '../../lib/text-render';

/**
 * Typing text in place on the canvas (FR-TXT-01/02, docs/03 §5.6). A contenteditable sits on the text's
 * position, scaled by the zoom, with the CSS the renderer lays the layer out with, so what you type is what
 * the layer becomes. It holds one span per run with its own colour, weight and size; the editor reads it
 * back by each character's computed style. Esc or Ctrl/⌘+Enter commits, as does a click outside.
 */

type StylePatch = { color?: RGBA; weight?: number; size?: number };

/**
 * The open editor's selection styler: the options bar applies colour, weight or size to the selected
 * characters through it (true), or to the whole layer when nothing is selected (false).
 */
export const textSelection: { apply: ((patch: StylePatch) => boolean) | null } = { apply: null };

const css = (c: RGBA) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

function styleSpan(span: HTMLElement, patch: StylePatch): void {
  if (patch.color) span.style.color = css(patch.color);
  if (patch.weight !== undefined) span.style.fontWeight = String(patch.weight);
  if (patch.size !== undefined) span.style.fontSize = `${patch.size}px`;
}

/** The editor's DOM for lines of runs: a block per line, a span per run that differs from the layer. */
function fill(root: HTMLElement, lines: RunPatch[][]): void {
  root.replaceChildren(
    ...(lines.length ? lines : [[]]).map((line) => {
      const div = document.createElement('div');
      const runs = line.filter((r) => r.text !== '');
      if (runs.length === 0) div.append(document.createElement('br'));
      for (const r of runs) {
        if (!r.color && r.weight === undefined && r.size === undefined) div.append(r.text);
        else {
          const span = document.createElement('span');
          span.textContent = r.text;
          styleSpan(span, r);
          div.append(span);
        }
      }
      return div;
    }),
  );
}

function parseColour(c: string): RGBA {
  const m = c.match(/rgba?\(([^)]+)\)/);
  const v = m ? m[1]!.split(',').map((x) => Number(x.trim())) : [0, 0, 0, 1];
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1];
}

/**
 * The editor's lines of runs, whatever markup typing produced: blocks and <br> end lines; each text node is
 * a run with what its computed colour, weight and size change from the layer's.
 */
function read(root: HTMLElement, base: { color: RGBA; weight: number; size: number }): RunPatch[][] {
  const lines: RunPatch[][] = [];
  let line: RunPatch[] | null = null;
  const visit = (node: Node) => {
    for (const child of node.childNodes) {
      if (child instanceof Text) {
        if (!child.data) continue;
        if (!line) lines.push((line = []));
        const cs = getComputedStyle(child.parentElement ?? root);
        const r: RunPatch = { text: child.data };
        const color = parseColour(cs.color);
        if (color.some((v, i) => Math.abs(v - base.color[i]!) > (i === 3 ? 0.01 : 0.5))) r.color = color;
        const weight = Number(cs.fontWeight);
        if (weight !== base.weight) r.weight = weight;
        const size = parseFloat(cs.fontSize);
        if (Math.abs(size - base.size) > 0.01) r.size = size;
        const last = line.at(-1);
        const same = (a: RunPatch, b: RunPatch) =>
          JSON.stringify([a.color, a.weight, a.size]) === JSON.stringify([b.color, b.weight, b.size]);
        if (last && same(last, r)) last.text += r.text;
        else line.push(r);
      } else if (child instanceof HTMLBRElement) {
        if (!line) lines.push([]);
        line = null;
      } else if (child instanceof HTMLElement) {
        const block = getComputedStyle(child).display !== 'inline';
        if (block) line = null;
        const before = lines.length;
        visit(child);
        if (block) {
          if (lines.length === before) lines.push([]); // an empty block is an empty line
          line = null;
        }
      }
    }
  };
  visit(root);
  return lines;
}

/** Wraps the selected characters of `root` in spans of `patch` and keeps them selected. */
function styleRange(root: HTMLElement, range: Range, patch: StylePatch): void {
  const texts: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (range.intersectsNode(n)) texts.push(n as Text);
  const wrapped: HTMLElement[] = [];
  for (let t of texts) {
    const start = t === range.startContainer ? range.startOffset : 0;
    const end = t === range.endContainer ? range.endOffset : t.data.length;
    if (end <= start) continue;
    if (end < t.data.length) t.splitText(end);
    if (start > 0) t = t.splitText(start);
    const span = document.createElement('span');
    styleSpan(span, patch);
    t.replaceWith(span);
    span.append(t);
    wrapped.push(span);
  }
  if (wrapped.length === 0) return;
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStartBefore(wrapped[0]!);
  r.setEndAfter(wrapped.at(-1)!);
  sel?.removeAllRanges();
  sel?.addRange(r);
}

export function TextEditor({ editor, edit }: { editor: Editor; edit: TextEditState }) {
  const { zoom, panX, panY } = useSyncExternalStore(editor.subscribeView, editor.getView);
  const ref = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const base = { color: edit.style.color, weight: edit.style.weight, size: edit.style.size };
  const baseRef = useRef(base);
  // Handlers read the layer's current style (it changes with the options bar while typing).
  useLayoutEffect(() => {
    baseRef.current = base;
  });
  // The DOM holds the text while typing: it is built once per edit, then only read.
  const session = `${edit.layerId ?? 'new'}@${edit.origin.x},${edit.origin.y}`;
  useLayoutEffect(() => {
    const el = ref.current!;
    fill(el, edit.lines);
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      if (edit.layerId === null) sel.collapseToEnd(); // a new text starts empty; an existing one is selected
    }
    // The last selection inside the editor, so the options bar can style it after taking the focus.
    const track = () => {
      const s = window.getSelection();
      if (s && s.rangeCount && el.contains(s.getRangeAt(0).commonAncestorContainer))
        saved.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', track);
    textSelection.apply = (patch) => {
      const r = saved.current;
      if (!r || r.collapsed || !el.isConnected) return false;
      styleRange(el, r, patch);
      editor.setTextRuns(read(el, baseRef.current));
      // Back to typing, after a dialog (the colour picker) has closed and handed the focus back to its button.
      setTimeout(() => el.isConnected && el.focus(), 0);
      return true;
    };
    return () => {
      document.removeEventListener('selectionchange', track);
      textSelection.apply = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when another text starts being edited
  }, [session]);

  const model = textModel(' ', edit.style, edit.mode, edit.box);
  const run = model.paragraphs[0]!.runs[0]!;
  const p = model.paragraphs[0]!;
  return (
    <div
      ref={ref}
      role="textbox"
      aria-label="Text"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className="absolute outline-dashed outline-1"
      style={{
        left: panX + edit.origin.x * zoom,
        top: panY + edit.origin.y * zoom,
        transform: `scale(${zoom})`,
        transformOrigin: '0 0',
        minWidth: '1px',
        minHeight: `${run.size * p.lineHeight}px`,
        ...(edit.mode === 'box' && edit.box ? { height: `${edit.box.h}px`, overflow: 'hidden' } : {}),
        outlineColor: 'rgba(0, 120, 255, 0.8)',
        caretColor: 'rgba(0, 120, 255, 1)',
        ...blockCss(model),
        ...runCss(run),
        textAlign: p.align,
        lineHeight: String(p.lineHeight),
      }}
      onInput={(e) => editor.setTextRuns(read(e.currentTarget, baseRef.current))}
      onPaste={(e) => {
        // Plain text only: styled markup from elsewhere never enters the layer.
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          editor.commitText();
        }
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
