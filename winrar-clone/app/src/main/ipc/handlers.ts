import type { BrowserWindow, Dialog } from 'electron';
import { ArchiveIndex } from '../archive/archive-index';
import type { SessionStore } from '../archive/sessions';
import type { SevenZipEngine } from '../engine/engine';
import { EngineError } from '../engine/errors';
import type { FileRefRegistry } from '../services/file-refs';
import { HandlerError, type Handlers } from './router';

export type HandlerDeps = {
  engine: SevenZipEngine;
  refs: FileRefRegistry;
  sessions: SessionStore;
  dialog: Pick<Dialog, 'showOpenDialog'>;
  window: () => BrowserWindow | null;
  appInfo: { productName: string; version: string; platform: string; arch: string };
};

export function createHandlers(deps: HandlerDeps): Handlers {
  let sevenZipVersion: Promise<string | null> | undefined;

  return {
    'app.getInfo': async () => {
      sevenZipVersion ??= deps.engine.version().catch(() => null);
      return { ...deps.appInfo, sevenZipVersion: await sevenZipVersion };
    },

    'dialog.openArchive': async () => {
      const win = deps.window();
      const options = { properties: ['openFile' as const], title: 'Open archive' };
      const result = win
        ? await deps.dialog.showOpenDialog(win, options)
        : await deps.dialog.showOpenDialog(options);
      const path = result.canceled ? undefined : result.filePaths[0];
      return path ? deps.refs.register(path) : null;
    },

    'files.registerDropped': async (paths) => {
      return paths.flatMap((p) => {
        try {
          return [deps.refs.register(p)];
        } catch {
          return []; // vanished or unreadable; ignore silently
        }
      });
    },

    'archive.open': async ({ archive, password }) => {
      const path = deps.refs.resolve(archive);
      if (!path) throw new HandlerError('NOT_FOUND', 'That file is no longer available. Open it again.');
      try {
        const listing = await deps.engine.list(path, { password });
        const index = new ArchiveIndex(listing);
        const opened = listing.archivePath === path ? archive : deps.refs.register(listing.archivePath);
        const sessionId = deps.sessions.add({ archivePath: listing.archivePath, index });
        return { status: 'opened', sessionId, archive: opened, info: index.info };
      } catch (err) {
        if (err instanceof EngineError && err.code === 'PASSWORD_REQUIRED') {
          return { status: 'passwordRequired', wrongPassword: false };
        }
        if (err instanceof EngineError && err.code === 'WRONG_PASSWORD' && password !== undefined) {
          return { status: 'passwordRequired', wrongPassword: true };
        }
        throw err;
      }
    },

    'archive.list': async ({ sessionId, ...query }) => {
      const session = deps.sessions.get(sessionId);
      if (!session) throw new HandlerError('NOT_FOUND', 'This archive is no longer open.');
      if (!session.index.hasFolder(query.folder))
        throw new HandlerError('NOT_FOUND', 'Folder not found in archive.');
      return session.index.list(query);
    },

    'archive.close': async (sessionId) => {
      deps.sessions.close(sessionId);
    },
  };
}
