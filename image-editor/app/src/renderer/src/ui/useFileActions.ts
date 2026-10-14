import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCT_NAME } from '@shared/constants';
import { defaultOptions, ExportOptions, FORMAT_INFO } from '@shared/export-options';
import type { FileRef } from '@shared/schemas';
import type { Editor } from '../engine/editor';
import { api, errorMessage, events } from '../lib/api';
import { decodeImage } from '../lib/codec';
import { encodeExport, readProject, thumbnailPng, writeProject } from '../lib/files';
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

/** New document (FR-DOC-01): size, resolution metadata and background (straight RGBA). */
export type NewDocumentSpec = {
  width: number;
  height: number;
  ppi: number;
  background: [number, number, number, number];
};

/**
 * Open / save / export / revert and the unsaved-changes guard (FR-DOC-02/04/05/06/11). Pixels and project
 * bytes never pass through React state: the engine, the file worker and the codec host handle them.
 */
export function useFileActions(
  editor: Editor | null,
  /** Runs after Save / Don't Save and before the window closes (e.g. discarding the recovery snapshot). */
  beforeClose: () => Promise<void> = async () => undefined,
) {
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

  /** Adds the file to Open Recent with a thumbnail, in the background (never fails the open or save). */
  const remember = useCallback(
    (ref: FileRef) => {
      const snapshot = editor?.getDocSnapshot();
      if (!snapshot) return;
      void thumbnailPng(snapshot)
        .catch(() => null)
        .then((png) => api.recent.add(ref, png ?? undefined))
        .catch(() => undefined);
    },
    [editor],
  );

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
      if (ok) remember(ref);
      return ok === true;
    },
    [editor, run, remember],
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

  /** Opens a file in a new tab, or (Revert) in place of the active one. */
  const load = useCallback(
    async (ref: FileRef, replace = false) => {
      if (!editor) return;
      await run(`Opening ${ref.displayName}…`, async () => {
        if (isProjectFile(ref)) {
          const { doc, readOnlyReason } = await readProject(await api.file.readBytes(ref));
          editor.openProject(doc, ref, readOnlyReason, replace);
          setNotice(readOnlyReason ? `${readOnlyReason} Use Save As to keep your changes.` : null);
        } else {
          const { header, rgba } = await decodeImage(ref);
          editor.loadImage(
            header.width,
            header.height,
            rgba,
            { name: ref.displayName, sourceProfile: header.sourceProfile, exif: header.exif },
            ref,
            replace,
          );
          setNotice(null);
        }
        remember(ref);
      });
    },
    [editor, run, remember],
  );

  /** Opens a file in a new tab (FR-DOC-03), or switches to the tab that already shows it. */
  const openRef = useCallback(
    async (ref: FileRef) => {
      const open = editor?.findDocument(ref);
      if (open) editor!.activateDocument(open);
      else await load(ref);
    },
    [editor, load],
  );

  /** File › Close (Ctrl+W) or a tab's ✕: asks about unsaved changes, then closes the tab. */
  const closeDocument = useCallback(
    async (id?: string) => {
      if (!editor) return false;
      if (id) editor.activateDocument(id);
      if (!(await confirmDiscard())) return false;
      editor.closeDocument();
      return true;
    },
    [editor, confirmDiscard],
  );

  /**
   * Window › Move Tab to New Window, or dragging a tab out of the window (FR-DOC-03): the document moves
   * with its file and save state; here the tab closes without asking (nothing is lost).
   */
  const moveToNewWindow = useCallback(
    async (id?: string, at: { x: number; y: number } | null = null) => {
      const doc = editor && editor.describeDocument(id ?? editor.getSnapshot().doc?.id ?? '');
      const snapshot = doc && editor.getDocSnapshot(doc.id);
      if (!doc || !snapshot) return;
      await run(`Moving ${doc.name} to a new window…`, async () => {
        const project = await writeProject(snapshot, appVersion.current);
        await api.window.moveDocument({ project, document: doc, at });
        editor.closeDocument(doc.id);
      });
    },
    [editor, run],
  );

  /** Before the window closes: asks about every tab with unsaved changes, in turn. Cancel stops. */
  const confirmCloseAll = useCallback(async (): Promise<boolean> => {
    for (;;) {
      const dirty = editor?.getSnapshot().tabs.find((t) => t.dirty);
      if (!editor || !dirty) return true;
      editor.activateDocument(dirty.id);
      const choice = await new Promise<UnsavedChoice>((resolve) => setUnsaved({ name: dirty.name, resolve }));
      setUnsaved(null);
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await save())) return false;
      if (choice === 'discard') editor.closeDocument(dirty.id);
    }
  }, [editor, save]);

  const openDialog = useCallback(async () => {
    const ref = await run('', () => api.dialog.openImage());
    if (ref) await openRef(ref);
  }, [run, openRef]);

  /** A new document from pixels (paste with no document open, FR-DOC-02). */
  const openPixels = useCallback(
    async (width: number, height: number, rgba: Uint8Array, name: string) => {
      // A new tab (FR-DOC-03): nothing to discard.
      editor?.loadImage(width, height, rgba, { name, sourceProfile: null, exif: null }, null);
    },
    [editor],
  );

  /** File › Open Recent (menu or Welcome screen). */
  const openRecent = useCallback(
    async (id: string) => {
      const ref = await run('', () => api.recent.open(id));
      if (ref) await openRef(ref);
    },
    [run, openRef],
  );

  const newDocument = useCallback(
    async (spec: NewDocumentSpec) => {
      editor?.newDocument(spec.width, spec.height, spec.background, spec.ppi);
    },
    [editor],
  );

  /** FR-DOC-11: reload the file the document came from, discarding changes (after confirming). */
  const revert = useCallback(async () => {
    const ref = editor?.getSnapshot().file.ref;
    if (!ref) return;
    if (await confirmDiscard()) await load(ref, true);
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
  // Any tab with unsaved changes keeps the close/quit guard on (FR-DOC-11).
  const dirty = snap?.tabs.some((t) => t.dirty) ?? false;
  const name = snap?.doc?.name;
  useEffect(() => {
    void api.app.setDocumentEdited(dirty).catch(() => undefined);
    document.title = name ? `${name}${dirty ? ' •' : ''} — ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [dirty, name]);

  // Closing the window with unsaved changes: main asks us, we ask the user.
  useEffect(
    () =>
      events.onCloseRequested(() => {
        void confirmCloseAll().then(async (ok) => {
          if (!ok) return;
          await beforeClose();
          await api.app.closeWindow();
        });
      }),
    [confirmCloseAll, beforeClose],
  );

  return useMemo(
    () => ({
      busy,
      error,
      notice,
      dismissError: () => setError(null),
      dismissNotice: () => setNotice(null),
      reportError: (err: unknown) => setError(errorMessage(err)),
      reportNotice: (message: string) => setNotice(message),
      openPixels,
      unsaved,
      exporting,
      exportInitial: lastExport,
      openExport: () => editor?.getSnapshot().doc && setExporting(true),
      closeExport: () => setExporting(false),
      exportWith,
      quickExport,
      openRef,
      openDialog,
      openRecent,
      closeDocument,
      moveToNewWindow,
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
      openRecent,
      closeDocument,
      moveToNewWindow,
      openPixels,
      newDocument,
      save,
      saveAs,
      revert,
    ],
  );
}
