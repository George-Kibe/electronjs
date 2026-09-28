import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCT_NAME } from '@shared/constants';
import { defaultOptions, ExportOptions, FORMAT_INFO } from '@shared/export-options';
import type { FileRef } from '@shared/schemas';
import type { Editor } from '../engine/editor';
import { api, errorMessage, events } from '../lib/api';
import { decodeImage } from '../lib/codec';
import { encodeExport, readProject, writeProject } from '../lib/files';
import type { UnsavedChoice } from './components/UnsavedDialog';

const LAST_EXPORT_KEY = 'export.last';

/** Per-viewer convenience only (the real settings store arrives with Preferences, FR-GEN-04). */
function loadLastExport(): ExportOptions {
  try {
    const parsed = ExportOptions.safeParse(JSON.parse(localStorage.getItem(LAST_EXPORT_KEY) ?? 'null'));
    if (parsed.success) return parsed.data;
  } catch {
    // storage unavailable or corrupt: fall back to defaults
  }
  return defaultOptions('png');
}

function saveLastExport(options: ExportOptions): void {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify(options));
  } catch {
    // ignore
  }
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'Untitled';
const isProjectFile = (ref: FileRef) => /\.iep$/i.test(ref.displayName);

export type FileActions = ReturnType<typeof useFileActions>;

/**
 * Open / save / export / revert and the unsaved-changes guard (FR-DOC-02/04/05/06/11). Pixels and project
 * bytes never pass through React state: the engine, the file worker and the codec host handle them.
 */
export function useFileActions(editor: Editor | null) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<{ name: string; resolve: (c: UnsavedChoice) => void } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<ExportOptions>(loadLastExport);
  const appVersion = useRef<string>('0.0.0');

  useEffect(() => {
    api.app.getInfo().then(
      (i) => (appVersion.current = i.version),
      () => undefined,
    );
  }, []);

  const run = useCallback(async <T>(label: string, task: () => Promise<T>): Promise<T | undefined> => {
    setError(null);
    setBusy(label);
    try {
      return await task();
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const writeTo = useCallback(
    async (ref: FileRef): Promise<boolean> => {
      if (!editor) return false;
      const token = editor.saveToken();
      const snapshot = editor.getDocSnapshot();
      if (!snapshot) return false;
      const ok = await run(`Saving ${ref.displayName}…`, async () => {
        const bytes = await writeProject(snapshot, appVersion.current);
        await api.file.writeAtomic(ref, bytes);
        editor.markSaved(ref, token);
        return true;
      });
      return ok === true;
    },
    [editor, run],
  );

  const saveAs = useCallback(async (): Promise<boolean> => {
    const doc = editor?.getSnapshot().doc;
    if (!editor || !doc) return false;
    const ref = await run('', () =>
      api.dialog.saveAs({ suggestedName: `${baseName(doc.name)}.iep`, kind: 'project' }),
    );
    return ref ? writeTo(ref) : false;
  }, [editor, run, writeTo]);

  const save = useCallback(async (): Promise<boolean> => {
    const snap = editor?.getSnapshot();
    if (!snap?.doc) return false;
    const { ref, isProject, readOnlyReason } = snap.file;
    return ref && isProject && !readOnlyReason ? writeTo(ref) : saveAs();
  }, [editor, writeTo, saveAs]);

  /** Resolves true when it is safe to discard the current document (saved, discarded or clean). */
  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    const snap = editor?.getSnapshot();
    if (!snap?.doc || !snap.file.dirty) return true;
    const choice = await new Promise<UnsavedChoice>((resolve) =>
      setUnsaved({ name: snap.doc!.name, resolve }),
    );
    setUnsaved(null);
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    return save();
  }, [editor, save]);

  const load = useCallback(
    async (ref: FileRef) => {
      if (!editor) return;
      await run(`Opening ${ref.displayName}…`, async () => {
        if (isProjectFile(ref)) {
          const { doc, readOnlyReason } = await readProject(await api.file.readBytes(ref));
          editor.openProject(doc, ref, readOnlyReason);
          setNotice(readOnlyReason ? `${readOnlyReason} Use Save As to keep your changes.` : null);
        } else {
          const { header, rgba } = await decodeImage(ref);
          editor.loadImage(
            header.width,
            header.height,
            rgba,
            { name: ref.displayName, sourceProfile: header.sourceProfile, exif: header.exif },
            ref,
          );
          setNotice(null);
        }
      });
    },
    [editor, run],
  );

  const openRef = useCallback(
    async (ref: FileRef) => {
      if (await confirmDiscard()) await load(ref);
    },
    [confirmDiscard, load],
  );

  const openDialog = useCallback(async () => {
    const ref = await run('', () => api.dialog.openImage());
    if (ref) await openRef(ref);
  }, [run, openRef]);

  const newDocument = useCallback(
    async (width: number, height: number) => {
      if (editor && (await confirmDiscard())) editor.newDocument(width, height);
    },
    [editor, confirmDiscard],
  );

  /** FR-DOC-11: reload the file the document came from, discarding changes (after confirming). */
  const revert = useCallback(async () => {
    const ref = editor?.getSnapshot().file.ref;
    if (!ref) return;
    if (await confirmDiscard()) await load(ref);
  }, [editor, confirmDiscard, load]);

  const exportWith = useCallback(
    async (options: ExportOptions) => {
      const doc = editor?.getSnapshot().doc;
      if (!editor || !doc) return;
      setLastExport(options);
      saveLastExport(options);
      setExporting(false);
      const suggestedName = `${baseName(doc.name)}.${FORMAT_INFO[options.format].extensions[0]}`;
      const ref = await run('', () => api.dialog.saveAs({ suggestedName, kind: options.format }));
      if (!ref) return;
      const snapshot = editor.getDocSnapshot()!;
      await run(`Exporting ${ref.displayName}…`, async () => {
        const bytes = await encodeExport(snapshot, editor.documentVersion, options);
        await api.file.writeAtomic(ref, bytes);
        setNotice(`Exported ${ref.displayName}`);
      });
    },
    [editor, run],
  );

  /** FR-DOC-06: PNG with the last PNG settings (or defaults). */
  const quickExport = useCallback(
    () =>
      exportWith(
        lastExport.format === 'png'
          ? lastExport
          : { ...defaultOptions('png'), metadata: lastExport.metadata },
      ),
    [exportWith, lastExport],
  );

  // Keep main informed of unsaved changes (quit guard, macOS close-button dot) and the window title.
  const snap = editor?.getSnapshot();
  const dirty = snap?.file.dirty ?? false;
  const name = snap?.doc?.name;
  useEffect(() => {
    void api.app.setDocumentEdited(dirty).catch(() => undefined);
    document.title = name ? `${name}${dirty ? ' •' : ''} — ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [dirty, name]);

  // Closing the window with unsaved changes: main asks us, we ask the user.
  useEffect(
    () =>
      events.onCloseRequested(() => {
        void confirmDiscard().then(async (ok) => {
          if (ok) await api.app.closeWindow();
        });
      }),
    [confirmDiscard],
  );

  return useMemo(
    () => ({
      busy,
      error,
      notice,
      dismissError: () => setError(null),
      dismissNotice: () => setNotice(null),
      reportError: (err: unknown) => setError(errorMessage(err)),
      unsaved,
      exporting,
      exportInitial: lastExport,
      openExport: () => editor?.getSnapshot().doc && setExporting(true),
      closeExport: () => setExporting(false),
      exportWith,
      quickExport,
      openRef,
      openDialog,
      newDocument,
      save,
      saveAs,
      revert,
    }),
    [
      busy,
      error,
      notice,
      lastExport,
      unsaved,
      exporting,
      editor,
      exportWith,
      quickExport,
      openRef,
      openDialog,
      newDocument,
      save,
      saveAs,
      revert,
    ],
  );
}
