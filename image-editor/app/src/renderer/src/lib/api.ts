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
    takeHandover: () => unwrap(bridge.app.takeHandover()),
  },
  window: {
    moveDocument: (req) => unwrap(bridge.window.moveDocument(req)),
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
  recent: {
    list: () => unwrap(bridge.recent.list()),
    add: (ref, thumbnail) => unwrap(bridge.recent.add(ref, thumbnail)),
    open: (id) => unwrap(bridge.recent.open(id)),
    remove: (id) => unwrap(bridge.recent.remove(id)),
    clear: () => unwrap(bridge.recent.clear()),
  },
  recovery: {
    write: (req) => unwrap(bridge.recovery.write(req)),
    list: () => unwrap(bridge.recovery.list()),
    read: (id) => unwrap(bridge.recovery.read(id)),
    discard: (id) => unwrap(bridge.recovery.discard(id)),
  },
  settings: {
    get: () => unwrap(bridge.settings.get()),
    update: (patch) => unwrap(bridge.settings.update(patch)),
  },
};

export const events: ImageEditorEvents = bridge.events;

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.error.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}
