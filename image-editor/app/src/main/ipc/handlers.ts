import type { BrowserWindow, Dialog, WebContents } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { FORMAT_INFO } from '@shared/export-options';
import { MAX_FILE_BYTES } from '@shared/ipc-contract';
import type { FileRefRegistry } from '../services/file-refs';
import { HandlerError, type Handlers } from './router';

export type HandlerDeps = {
  refs: FileRefRegistry;
  dialog: Pick<Dialog, 'showOpenDialog' | 'showSaveDialog'>;
  window: () => BrowserWindow | null;
  codec: { decode(path: string, target: WebContents): string; encode(target: WebContents): string };
  writeAtomic(path: string, data: Uint8Array): Promise<void>;
  appInfo: { productName: string; version: string; platform: string; arch: string };
  launchPaths: string[];
  /** Folder shown by the first save dialog (Pictures); later dialogs reuse the last folder. */
  defaultDir: string;
  /** The renderer reported unsaved changes (drives the close guard and the macOS dot). */
  setDocumentEdited(edited: boolean): void;
  /** Close the window now: the renderer has already handled unsaved changes. */
  closeWindow(): void;
};

const OPEN_FILTERS = [
  {
    name: 'Images and projects',
    extensions: ['iep', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff'],
  },
  { name: 'All files', extensions: ['*'] },
];

const PROJECT = { label: 'ImageEditor project', extensions: ['iep'] };

function withExtension(path: string, extensions: string[]): string {
  const ext = extname(path).slice(1).toLowerCase();
  return extensions.includes(ext) ? path : `${path}.${extensions[0]}`;
}

export function createHandlers(deps: HandlerDeps): Handlers {
  let pendingLaunchPaths = [...deps.launchPaths];
  let lastDir = deps.defaultDir;

  const registerAll = (paths: string[]) =>
    paths.flatMap((p) => {
      try {
        return [deps.refs.register(p)];
      } catch {
        return [];
      }
    });

  const resolveOrThrow = (ref: { id: string }) => {
    const path = deps.refs.resolve(ref);
    if (!path) throw new HandlerError('NOT_FOUND', 'That file is no longer available. Open it again.');
    return path;
  };

  return {
    'app.getInfo': () => deps.appInfo,

    'app.getLaunchFiles': () => {
      const paths = pendingLaunchPaths;
      pendingLaunchPaths = [];
      return registerAll(paths);
    },

    'app.setDocumentEdited': (edited) => deps.setDocumentEdited(edited),

    'app.closeWindow': () => deps.closeWindow(),

    'dialog.openImage': async () => {
      const win = deps.window();
      const options = { title: 'Open', properties: ['openFile' as const], filters: OPEN_FILTERS };
      const result = win
        ? await deps.dialog.showOpenDialog(win, options)
        : await deps.dialog.showOpenDialog(options);
      const path = result.canceled ? undefined : result.filePaths[0];
      return path ? deps.refs.register(path) : null;
    },

    'dialog.saveAs': async ({ suggestedName, kind }) => {
      const info = kind === 'project' ? PROJECT : FORMAT_INFO[kind];
      const win = deps.window();
      const options = {
        title: kind === 'project' ? 'Save' : 'Export',
        defaultPath: join(lastDir, withExtension(suggestedName.replace(/[\\/]/g, '_'), info.extensions)),
        filters: [{ name: info.label, extensions: info.extensions }],
        properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const],
      };
      const result = win
        ? await deps.dialog.showSaveDialog(win, options)
        : await deps.dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      const ref = deps.refs.registerSaveTarget(withExtension(result.filePath, info.extensions));
      lastDir = ref.displayDir;
      return ref;
    },

    'files.registerDropped': (paths) => registerAll(paths),

    'file.readBytes': async (ref) => {
      const path = resolveOrThrow(ref);
      if ((await stat(path)).size > MAX_FILE_BYTES)
        throw new HandlerError('TOO_LARGE', 'This file is too large to open.');
      return new Uint8Array(await readFile(path));
    },

    'file.writeAtomic': async ({ ref, data }) => {
      const path = deps.refs.resolveWritable(ref);
      if (!path) throw new HandlerError('FORBIDDEN', 'Choose where to save the file first.');
      try {
        await deps.writeAtomic(path, data);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const reason =
          code === 'ENOSPC'
            ? 'the disk is full'
            : code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
              ? 'you do not have permission to write there'
              : 'the file could not be written';
        throw new HandlerError('WRITE_FAILED', `Could not save — ${reason}. Your document is unchanged.`);
      }
    },

    'codec.decode': (ref, event) => ({ requestId: deps.codec.decode(resolveOrThrow(ref), event.sender) }),

    'codec.encode': (_req, event) => ({ requestId: deps.codec.encode(event.sender) }),
  };
}
