import { useEffect } from 'react';
import type { Editor } from '../engine/editor';

/**
 * Photoshop-compatible defaults (docs/03 §6). Ignored while typing in form fields.
 */
export function useShortcuts(editor: Editor | null, actions: { open: () => void }): void {
  useEffect(() => {
    if (!editor) return;
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const brush = editor.getSnapshot().brush;
      const run = (action: () => void) => {
        action();
        return true;
      };
      const handled = (() => {
        if (mod && key === 'z') return run(() => (e.shiftKey ? editor.redo() : editor.undo()));
        if (mod && key === 'y') return run(() => editor.redo());
        if (mod && key === 'o') return run(() => actions.open());
        if (mod && e.shiftKey && key === 'n') return run(() => editor.addLayer());
        if (mod && key === '0') return run(() => editor.fitToScreen());
        if (mod && key === '1') return run(() => editor.zoomTo(1));
        if (mod && (key === '=' || key === '+')) return run(() => editor.zoomBy(2));
        if (mod && key === '-') return run(() => editor.zoomBy(0.5));
        if (mod || e.altKey) return false;
        if (key === ' ') return run(() => editor.setSpaceHeld(true));
        if (key === 'b') return run(() => editor.setTool('brush'));
        if (key === 'e') return run(() => editor.setTool('eraser'));
        if (key === 'h') return run(() => editor.setTool('hand'));
        if (key === 'z') return run(() => editor.setTool('zoom'));
        if (key === '[') return run(() => editor.setBrush({ size: Math.round(brush.size / 1.2) }));
        if (key === ']') return run(() => editor.setBrush({ size: Math.round(brush.size * 1.2) + 1 }));
        return false;
      })();
      if (handled) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') editor.setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [editor, actions]);
}
