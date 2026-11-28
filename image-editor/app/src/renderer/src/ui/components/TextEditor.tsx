import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { Editor, TextEditState } from '../../engine/editor';
import { textModel } from '../../engine/text/text';
import { blockCss, runCss } from '../../lib/text-render';

/**
 * Typing text in place on the canvas (FR-TXT-01, docs/03 §5.6). A plain-text contenteditable sits on the
 * text's position, scaled by the zoom, with the CSS the renderer lays the layer out with, so what you type
 * is what the layer becomes. Esc or Ctrl/⌘+Enter commits, as does a click outside (the editor handles that).
 */
export function TextEditor({ editor, edit }: { editor: Editor; edit: TextEditState }) {
  const { zoom, panX, panY } = useSyncExternalStore(editor.subscribeView, editor.getView);
  const ref = useRef<HTMLDivElement>(null);
  // The DOM holds the text while typing: it is set once per edit, then only read.
  const session = `${edit.layerId ?? 'new'}@${edit.origin.x},${edit.origin.y}`;
  useLayoutEffect(() => {
    const el = ref.current!;
    el.textContent = edit.text;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      if (edit.layerId === null) sel.collapseToEnd(); // a new text starts empty; an existing one is selected
    }
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
      contentEditable="plaintext-only"
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
      onInput={(e) => editor.setTextContent(e.currentTarget.innerText.replace(/\n$/, ''))}
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
