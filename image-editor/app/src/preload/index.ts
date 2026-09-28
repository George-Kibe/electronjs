import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CODEC_PORT_MESSAGE } from '../shared/constants';
import type { Channel, ImageEditorBridge, IpcResult, RequestOf, ResponseOf } from '../shared/ipc-contract';

/** Returns the `{ ok, data | error }` envelope as-is (thrown errors lose their code across contextBridge). */
function call<C extends Channel>(channel: C, request?: RequestOf<C>): Promise<IpcResult<ResponseOf<C>>> {
  return ipcRenderer.invoke(channel, request) as Promise<IpcResult<ResponseOf<C>>>;
}

const api: ImageEditorBridge = {
  app: { getInfo: () => call('app.getInfo'), getLaunchFiles: () => call('app.getLaunchFiles') },
  dialog: { openImage: () => call('dialog.openImage') },
  files: {
    registerDropped: (files) =>
      call(
        'files.registerDropped',
        files.map((f) => webUtils.getPathForFile(f)),
      ),
  },
  codec: { decode: (ref) => call('codec.decode', { id: ref.id }) },
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
