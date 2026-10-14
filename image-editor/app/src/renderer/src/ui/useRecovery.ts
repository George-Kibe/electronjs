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
  /** Version last written per document id (nothing is rewritten until it changes). */
  const written = useRef(new Map<string, number>());
  const busy = useRef(false);

  const refresh = useCallback(() => void api.recovery.list().then(setItems, () => undefined), []);

  /** Writes a snapshot of every open document with unsaved changes that changed since its last one. */
  const writeNow = useCallback(async () => {
    if (!editor || busy.current) return;
    busy.current = true;
    try {
      for (const tab of editor.getSnapshot().tabs) {
        const version = editor.documentVersionOf(tab.id);
        if (!tab.dirty || written.current.get(tab.id) === version) continue;
        const doc = editor.getDocSnapshot(tab.id);
        if (!doc) continue;
        try {
          const [project, thumbnail] = await Promise.all([
            writeProject(doc, appVersion),
            thumbnailPng(doc).catch(() => null),
          ]);
          await api.recovery.write({
            id: tab.id,
            name: tab.name,
            project,
            thumbnail: thumbnail ?? undefined,
          });
          written.current.set(tab.id, version);
        } catch (err) {
          console.warn('[recovery] snapshot not written', err);
        }
      }
    } finally {
      busy.current = false;
    }
  }, [editor, appVersion]);

  useEffect(() => {
    if (!editor || intervalMs <= 0) return;
    const timer = window.setInterval(() => void writeNow(), intervalMs);
    return () => window.clearInterval(timer);
  }, [editor, intervalMs, writeNow]);

  // A document that is saved or closed no longer needs its snapshot.
  const tabsKey = JSON.stringify(snap?.tabs.map((t) => [t.id, t.dirty]) ?? []);
  const previous = useRef(new Map<string, boolean>());
  useEffect(() => {
    const now = new Map<string, boolean>(JSON.parse(tabsKey) as Array<[string, boolean]>);
    for (const [id, wasDirty] of previous.current) {
      if (!now.has(id) || (wasDirty && !now.get(id))) {
        void api.recovery.discard(id).catch(() => undefined);
        written.current.delete(id);
      }
    }
    previous.current = now;
    if (now.size === 0) refresh(); // the Welcome screen lists what can be recovered
  }, [tabsKey, refresh]);

  /** Before the window closes (every tab saved or discarded): nothing left to recover. */
  const discardAll = useCallback(async () => {
    const ids = editor?.getSnapshot().tabs.map((t) => t.id) ?? [];
    await Promise.all(ids.map((id) => api.recovery.discard(id).catch(() => undefined)));
  }, [editor]);

  const recover = useCallback(
    async (item: RecoveryItem) => {
      if (!editor) return;
      const { doc } = await readProject(await api.recovery.read(item.id));
      editor.openRecovered(doc, item.id, item.name);
      written.current.set(item.id, editor.documentVersion);
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

  return { items, recover, discard, discardAll };
}
