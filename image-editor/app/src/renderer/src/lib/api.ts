import type { ImageEditorApi, ImageEditorEvents, IpcResult } from '@shared/ipc-contract';
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
    setDocumentEdited: (edited) => unwrap(bridge.app.setDocumentEdited(edited)),
    closeWindow: () => unwrap(bridge.app.closeWindow()),
  },
  dialog: {
    openImage: () => unwrap(bridge.dialog.openImage()),
    saveAs: (req) => unwrap(bridge.dialog.saveAs(req)),
  },
  files: { registerDropped: (files) => unwrap(bridge.files.registerDropped(files)) },
  file: {
    readBytes: (ref) => unwrap(bridge.file.readBytes(ref)),
    writeAtomic: (ref, data) => unwrap(bridge.file.writeAtomic(ref, data)),
  },
  codec: {
    decode: (ref) => unwrap(bridge.codec.decode(ref)),
    encode: () => unwrap(bridge.codec.encode()),
  },
};

export const events: ImageEditorEvents = bridge.events;

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.error.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}
