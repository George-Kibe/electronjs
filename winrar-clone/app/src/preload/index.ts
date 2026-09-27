import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Channel, IpcResult, RequestOf, ResponseOf, WinrarCloneBridge } from '../shared/ipc-contract';

/**
 * The only bridge between the sandboxed renderer and main (docs/04 §1.2). Deliberately tiny: no generic
 * `invoke(channel)` escape hatch is exposed, only named methods.
 */
function call<C extends Channel>(channel: C, request?: RequestOf<C>): Promise<IpcResult<ResponseOf<C>>> {
  // Return the envelope as-is: errors thrown across contextBridge lose everything but `message`.
  return ipcRenderer.invoke(channel, request) as Promise<IpcResult<ResponseOf<C>>>;
}

const api: WinrarCloneBridge = {
  app: { getInfo: () => call('app.getInfo'), getLaunchFiles: () => call('app.getLaunchFiles') },
  dialog: { openArchive: () => call('dialog.openArchive') },
  files: {
    // Paths of dropped files are only obtainable here (webUtils), never in the renderer.
    registerDropped: (files) =>
      call(
        'files.registerDropped',
        files.map((f) => webUtils.getPathForFile(f)),
      ),
  },
  archive: {
    open: (req) => call('archive.open', req),
    list: (req) => call('archive.list', req),
    close: (sessionId) => call('archive.close', sessionId),
  },
};

contextBridge.exposeInMainWorld('api', api);
