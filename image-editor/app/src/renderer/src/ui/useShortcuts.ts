import { useEffect } from 'react';
import { isPaintTool, type Editor } from '../engine/editor';

export type ShortcutActions = {
  open(): void;
  newDocument(): void;
  save(): void;
  saveAs(): void;
  exportAs(): void;
  quickExport(): void;
  preferences(): void;
  closeDocument(): void;
  copyMerged(): void;
  imageSize(): void;
  canvasSize(): void;
};

/**
 * Photoshop-compatible defaults (docs/03 §6). Ignored while typing in form fields.
 */
export function useShortcuts(editor: Editor | null, actions: ShortcutActions): void {
  useEffect(() => {
    if (!editor) return;
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const tool = editor.getSnapshot().tool;
      const brush = editor.brushOptions;
      const run = (action: () => void) => {
        action();
        return true;
      };
      const handled = (() => {
        // Ctrl+Alt+Z / Ctrl+Shift+Alt+Z: step backward / forward (docs/03 §6). e.code: Alt changes e.key on macOS.
        if (mod && e.altKey && e.code === 'KeyZ')
          return run(() => (e.shiftKey ? editor.redo() : editor.undo()));
        if (mod && key === 'z') return run(() => (e.shiftKey ? editor.redo() : editor.undo()));
        if (mod && key === 'y') return run(() => editor.redo());
        // e.code for the Alt combinations: on macOS, Alt changes e.key to another character.
        if (mod && e.altKey && e.shiftKey && e.code === 'KeyW') return run(() => actions.exportAs());
        if (mod && e.altKey && e.shiftKey && e.code === 'Quote') return run(() => actions.quickExport());
        // Image Size / Canvas Size: Ctrl+Alt+I / Ctrl+Alt+C (e.code: Alt changes e.key on macOS).
        if (mod && e.altKey && !e.shiftKey && e.code === 'KeyI') return run(() => actions.imageSize());
        if (mod && e.altKey && !e.shiftKey && e.code === 'KeyC') return run(() => actions.canvasSize());
        if (mod && e.key === ',') return run(() => actions.preferences());
        if (mod && !e.shiftKey && key === 'w') return run(() => actions.closeDocument());
        if (e.ctrlKey && e.key === 'Tab') return run(() => editor.cycleDocument(e.shiftKey ? -1 : 1));
        if (mod && e.shiftKey && key === 'c') return run(() => actions.copyMerged());
        if (mod && key === 'o') return run(() => actions.open());
        if (mod && key === 's') return run(() => (e.shiftKey ? actions.saveAs() : actions.save()));
        if (mod && !e.shiftKey && key === 'n') return run(() => actions.newDocument());
        if (mod && e.shiftKey && key === 'n') return run(() => editor.addLayer());
        if (mod && !e.shiftKey && key === 'j') return run(() => editor.duplicateLayer());
        if (mod && key === 'g')
          return run(() => (e.shiftKey ? editor.ungroupActiveLayer() : editor.groupActiveLayer()));
        if (mod && key === 'e') return run(() => (e.shiftKey ? editor.mergeVisible() : editor.mergeDown()));
        if (mod && e.code === 'BracketRight') return run(() => editor.nudgeActiveLayer(1));
        if (mod && e.code === 'BracketLeft') return run(() => editor.nudgeActiveLayer(-1));
        if (mod && key === '0') return run(() => editor.fitToScreen());
        if (mod && key === '1') return run(() => editor.zoomTo(1));
        if (mod && (key === '=' || key === '+')) return run(() => editor.zoomStep(1));
        if (mod && key === '-') return run(() => editor.zoomStep(-1));
        if (mod || e.altKey) return false;
        // Move tool: arrows nudge the layer, Shift = 10 px (FR-TRF-07).
        const arrows: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const arrow = arrows[e.key];
        if (arrow && tool === 'move') {
          const step = e.shiftKey ? 10 : 1;
          return run(() => editor.nudge(arrow[0] * step, arrow[1] * step));
        }
        // e.code for brackets: Shift turns them into braces on most layouts.
        if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
          const up = e.code === 'BracketRight';
          if (e.shiftKey) {
            const hardness = Math.round(brush.hardness * 4 + (up ? 1 : -1)) / 4; // 25 % steps
            return run(() => editor.setBrush({ hardness: Math.min(1, Math.max(0, hardness)) }));
          }
          return run(() =>
            editor.setBrush({ size: up ? Math.round(brush.size * 1.2) + 1 : Math.round(brush.size / 1.2) }),
          );
        }
        if (key === ' ') return run(() => editor.setSpaceHeld(true));
        if (e.shiftKey && key === 'b') return run(() => editor.selectBrushTool(true));
        if (e.shiftKey) return false;
        if (key === 'v') return run(() => editor.setTool('move'));
        if (key === 'c') return run(() => editor.setTool('crop'));
        if (tool === 'crop' && e.key === 'Enter') return run(() => editor.commitCrop());
        if (tool === 'crop' && e.key === 'Escape') return run(() => editor.resetCrop());
        if (key === 'b') return run(() => editor.selectBrushTool());
        if (key === 'e') return run(() => editor.setTool('eraser'));
        if (key === 'i') return run(() => editor.setTool('eyedropper'));
        if (key === 'h') return run(() => editor.setTool('hand'));
        if (key === 'z') return run(() => editor.setTool('zoom'));
        if (key === 'x') return run(() => editor.swapColors());
        if (key === 'd') return run(() => editor.resetColors());
        // 1…9, 0: opacity 10 %…90 %, 100 % for painting tools (docs/03 §6).
        if (/^[0-9]$/.test(key) && isPaintTool(tool))
          return run(() => editor.setBrush({ opacity: key === '0' ? 1 : Number(key) / 10 }));
        return false;
      })();
      if (handled) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') editor.setSpaceHeld(false);
    };
    // Alt / Ctrl switch tools temporarily; the editor shows that in the cursor (docs/03 §4).
    const onModifiers = (e: KeyboardEvent) =>
      editor.setModifiers({ alt: e.altKey, ctrl: e.ctrlKey || e.metaKey });
    const onBlur = () => {
      editor.setModifiers({ alt: false, ctrl: false });
      editor.setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onModifiers, true);
    window.addEventListener('keyup', onModifiers, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('keydown', onModifiers, true);
      window.removeEventListener('keyup', onModifiers, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [editor, actions]);
}
