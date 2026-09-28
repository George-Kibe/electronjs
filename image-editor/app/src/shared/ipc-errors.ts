import type { IpcError } from './schemas';

/** Thrown by the renderer-side API wrapper; carries the structured IPC error. Zod-free on purpose. */
export class ApiError extends Error {
  constructor(public readonly error: IpcError) {
    super(error.message);
    this.name = 'ApiError';
  }
}
