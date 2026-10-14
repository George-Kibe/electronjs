import { useCallback, useEffect, useMemo } from 'react';
import type { Editor } from '../engine/editor';
import { decodeClipboardImage, encodeClipboardPng } from '../lib/files';
import type { FileActions } from './useFileActions';

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** The first image in a clipboard event's data, if any. */
function imageFrom(data: DataTransfer | null): Blob | null {
  for (const item of data?.items ?? []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}

/**
 * Clipboard (FR-DOC-02, FR-DOC-12). Images are decoded by Chromium in the file worker, inside the renderer
 * sandbox (docs/06 §2); main never sees clipboard pixels.
 * - Edit › Paste / Ctrl+V (the native role, so text fields keep working): a new layer, or a new document
 *   when none is open. Edit › Paste as New Document always opens one.
 * - Edit › Copy / Ctrl+C: the active layer; Copy Merged / Ctrl+Shift+C: the visible image. PNG, so
 *   transparency survives where the OS supports it. (Cut and copying a selection arrive with selections.)
 */
export function useClipboard(editor: Editor | null, files: FileActions) {
  const pasteBlob = useCallback(
    async (blob: Blob, asNewDocument: boolean) => {
      try {
        const { width, height, rgba } = await decodeClipboardImage(blob);
        if (editor?.getSnapshot().doc && !asNewDocument) {
          editor.pasteAsLayer(width, height, rgba);
          files.reportNotice('Pasted as a new layer.');
        } else {
          await files.openPixels(width, height, rgba, 'Pasted image');
        }
      } catch (err) {
        files.reportError(err);
      }
    },
    [editor, files],
  );

  /** Edit › Paste as New Document: reads the clipboard directly (permission granted to app:// only). */
  const pasteAsNewDocument = useCallback(async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return void (await pasteBlob(await item.getType(type), true));
      }
      files.reportNotice('The clipboard has no image to paste.');
    } catch (err) {
      files.reportError(err);
    }
  }, [files, pasteBlob]);

  const copy = useCallback(
    async (merged: boolean) => {
      const snapshot = editor?.clipboardSnapshot(merged);
      if (!snapshot) return;
      try {
        const png = await encodeClipboardPng(snapshot);
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) }),
        ]);
        files.reportNotice(merged ? 'Copied the visible image.' : 'Copied the layer.');
      } catch (err) {
        files.reportError(err);
      }
    },
    [editor, files],
  );

  // The native Edit roles (and Ctrl+C / Ctrl+V) fire DOM copy/paste events; text fields keep the default.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const blob = imageFrom(e.clipboardData);
      if (!blob) return;
      e.preventDefault();
      void pasteBlob(blob, false);
    };
    const onCopy = (e: ClipboardEvent) => {
      if (typing(e.target) || !editor?.getSnapshot().doc) return;
      e.preventDefault();
      void copy(false);
    };
    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('copy', onCopy);
    };
  }, [editor, copy, pasteBlob]);

  return useMemo(
    () => ({ copy: () => copy(false), copyMerged: () => copy(true), pasteAsNewDocument }),
    [copy, pasteAsNewDocument],
  );
}
