import { ipcErrorOf } from '@shared/ipc-errors';

export const api = window.api;

/** User-facing message for any error thrown by window.api. */
export function errorMessage(err: unknown): string {
  const ipc = ipcErrorOf(err);
  if (!ipc) return 'Something went wrong.';
  if (ipc.code === 'MISSING_VOLUME' && typeof ipc.details?.['volume'] === 'string') {
    return `Can't find ${ipc.details['volume']}. Put all parts in the same folder and try again.`;
  }
  return ipc.message;
}
