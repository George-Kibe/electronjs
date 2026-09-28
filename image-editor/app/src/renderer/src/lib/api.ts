import type { ImageEditorApi, IpcResult } from '@shared/ipc-contract';
import { ApiError } from '@shared/ipc-errors';

const bridge = window.api;

async function unwrap<T>(pending: Promise<IpcResult<T>>): Promise<T> {
  const result = await pending;
  if (result.ok) return result.data;
  throw new ApiError(result.error);
}

export const api: ImageEditorApi = {
  app: {
    getInfo: () => unwrap(bridge.app.getInfo()),
    getLaunchFiles: () => unwrap(bridge.app.getLaunchFiles()),
  },
  dialog: { openImage: () => unwrap(bridge.dialog.openImage()) },
  files: { registerDropped: (files) => unwrap(bridge.files.registerDropped(files)) },
  codec: { decode: (ref) => unwrap(bridge.codec.decode(ref)) },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.error.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}
