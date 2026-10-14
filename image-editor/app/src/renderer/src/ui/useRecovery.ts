import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecoveryItem } from '@shared/ipc-contract';
import type { Editor, EditorSnapshot } from '../engine/editor';
import { api } from '../lib/api';
import { readProject, thumbnailPng, writeProject } from '../lib/files';

/**
 * Autosave recovery (FR-DOC-10, NFR-REL-01, T-REC-01). While the document has unsaved changes, a project
 * snapshot is written every `intervalMs` (in the file worker, so the UI never stalls). When the document is
 * saved, replaced or closed, its snapshot is discarded; only a crash leaves one behind, and the Welcome
 * screen offers it at the next launch. `intervalMs` 0 turns autosave off.
 */
export function useRecovery(
  editor: Editor | null,
  snap: EditorSnapshot | null,
  intervalMs: number,
  appVersion: string,
) {
  const [items, setItems] = useState<RecoveryItem[]>([]);
  const written = useRef<{ id: string; version: number } | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(() => void api.recovery.list().then(setItems, () => undefined), []);

  const writeNow = useCallback(async () => {
    const s = editor?.getSnapshot();
    if (!editor || !s?.doc || !s.file.dirty || busy.current) return;
    const version = editor.documentVersion;
    if (written.current?.id === s.doc.id && written.current.version === version) return; // nothing new
    const doc = editor.getDocSnapshot();
    if (!doc) return;
    busy.current = true;
    try {
      const [project, thumbnail] = await Promise.all([
        writeProject(doc, appVersion),
        thumbnailPng(doc).catch(() => null),
      ]);
      await api.recovery.write({
        id: s.doc.id,
        name: s.doc.name,
        project,
        thumbnail: thumbnail ?? undefined,
      });
      written.current = { id: s.doc.id, version };
    } catch (err) {
      console.warn('[recovery] snapshot not written', err);
    } finally {
      busy.current = false;
    }
  }, [editor, appVersion]);

  useEffect(() => {
    if (!editor || intervalMs <= 0) return;
    const timer = window.setInterval(() => void writeNow(), intervalMs);
    return () => window.clearInterval(timer);
  }, [editor, intervalMs, writeNow]);

  // A document that is saved, replaced or closed no longer needs its snapshot.
  const docId = snap?.doc?.id ?? null;
  const dirty = snap?.file.dirty ?? false;
  const previous = useRef<{ id: string | null; dirty: boolean }>({ id: null, dirty: false });
  useEffect(() => {
    const prev = previous.current;
    if (prev.id && (prev.id !== docId || (prev.dirty && !dirty))) {
      void api.recovery.discard(prev.id).catch(() => undefined);
      if (written.current?.id === prev.id) written.current = null;
    }
    previous.current = { id: docId, dirty };
    if (!docId) refresh(); // the Welcome screen lists what can be recovered
  }, [docId, dirty, refresh]);

  /** Before the window closes after Save / Don't Save: nothing left to recover. */
  const discardCurrent = useCallback(async () => {
    const id = editor?.getSnapshot().doc?.id;
    if (id) await api.recovery.discard(id).catch(() => undefined);
  }, [editor]);

  const recover = useCallback(
    async (item: RecoveryItem) => {
      if (!editor) return;
      const { doc } = await readProject(await api.recovery.read(item.id));
      editor.openRecovered(doc, item.id, item.name);
      written.current = { id: item.id, version: editor.documentVersion };
    },
    [editor],
  );

  const discard = useCallback(
    async (id: string) => {
      await api.recovery.discard(id).catch(() => undefined);
      refresh();
    },
    [refresh],
  );

  return { items, recover, discard, discardCurrent };
}
