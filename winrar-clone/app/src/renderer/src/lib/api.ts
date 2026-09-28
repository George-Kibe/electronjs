import type { IpcResult, WinrarCloneApi } from '@shared/ipc-contract';
import { ApiError, ipcErrorOf } from '@shared/ipc-errors';

const bridge = window.api;

async function unwrap<T>(pending: Promise<IpcResult<T>>): Promise<T> {
  const result = await pending;
  if (result.ok) return result.data;
  throw new ApiError(result.error);
}

/** Renderer-facing API: resolves with data or throws ApiError (with the structured error code). */
export const api: WinrarCloneApi = {
  app: {
    getInfo: () => unwrap(bridge.app.getInfo()),
    getLaunchFiles: () => unwrap(bridge.app.getLaunchFiles()),
  },
  dialog: { openArchive: () => unwrap(bridge.dialog.openArchive()) },
  files: { registerDropped: (files) => unwrap(bridge.files.registerDropped(files)) },
  archive: {
    open: (req) => unwrap(bridge.archive.open(req)),
    list: (req) => unwrap(bridge.archive.list(req)),
    close: (sessionId) => unwrap(bridge.archive.close(sessionId)),
  },
};

/** User-facing message for any error thrown by `api`. */
export function errorMessage(err: unknown): string {
  const ipc = ipcErrorOf(err);
  if (!ipc) return 'Something went wrong.';
  if (ipc.code === 'MISSING_VOLUME' && typeof ipc.details?.['volume'] === 'string') {
    return `Can't find ${ipc.details['volume']}. Put all parts in the same folder and try again.`;
  }
  return ipc.message;
}
