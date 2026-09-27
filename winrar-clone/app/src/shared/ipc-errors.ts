import type { IpcError } from './schemas';

/** Error thrown by the renderer-side API wrapper; carries the structured IPC error. Zod-free on purpose. */
export class ApiError extends Error {
  constructor(public readonly error: IpcError) {
    super(error.message);
    this.name = 'ApiError';
  }
}

export function ipcErrorOf(err: unknown): IpcError | null {
  return err instanceof ApiError ? err.error : null;
}
