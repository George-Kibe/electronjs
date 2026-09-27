import type { IpcError } from './schemas';

/**
 * Errors thrown by `window.api` carry the structured IPC error in `ipcError` (set by the preload).
 * Kept free of runtime zod imports so the renderer bundle stays small.
 */
export function ipcErrorOf(err: unknown): IpcError | null {
  if (typeof err === 'object' && err !== null && 'ipcError' in err)
    return (err as { ipcError: IpcError }).ipcError;
  return null;
}
