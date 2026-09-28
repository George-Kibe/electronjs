import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { CODEC_PORT_MESSAGE } from '../shared/constants';
import type { Channel, ImageEditorBridge, IpcResult, RequestOf, ResponseOf } from '../shared/ipc-contract';
import { isMenuCommand, type MenuCommandId } from '../shared/menu';

/** Returns the `{ ok, data | error }` envelope as-is (thrown errors lose their code across contextBridge). */
function call<C extends Channel>(channel: C, request?: RequestOf<C>): Promise<IpcResult<ResponseOf<C>>> {
  return ipcRenderer.invoke(channel, request) as Promise<IpcResult<ResponseOf<C>>>;
}

/** Subscribes to a main → renderer event; returns the unsubscribe function. */
function on(channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void): () => void {
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ImageEditorBridge = {
  app: {
    getInfo: () => call('app.getInfo'),
    getLaunchFiles: () => call('app.getLaunchFiles'),
    setDocumentEdited: (edited) => call('app.setDocumentEdited', edited),
    closeWindow: () => call('app.closeWindow'),
  },
  dialog: {
    openImage: () => call('dialog.openImage'),
    saveAs: (req) => call('dialog.saveAs', req),
  },
  files: {
    registerDropped: (files) =>
      call(
        'files.registerDropped',
        files.map((f) => webUtils.getPathForFile(f)),
      ),
  },
  file: {
    readBytes: (ref) => call('file.readBytes', { id: ref.id }),
    writeAtomic: (ref, data) => call('file.writeAtomic', { ref: { id: ref.id }, data }),
  },
  codec: {
    decode: (ref) => call('codec.decode', { id: ref.id }),
    encode: () => call('codec.encode'),
  },
  events: {
    onCloseRequested: (cb) => on('app.closeRequested', () => cb()),
    onMenuCommand: (cb) =>
      on('menu.command', (_e, id) => {
        if (isMenuCommand(id)) cb(id as MenuCommandId);
      }),
  },
};

contextBridge.exposeInMainWorld('api', api);

// MessagePorts cannot cross contextBridge; hand them to the page with a same-origin postMessage.
ipcRenderer.on('codec.port', (event, message: { requestId: string }) => {
  window.postMessage(
    { type: CODEC_PORT_MESSAGE, requestId: message.requestId },
    window.location.origin,
    event.ports,
  );
});
