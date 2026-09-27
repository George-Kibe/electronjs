import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Channel, IpcResult, RequestOf, ResponseOf, WinrarCloneApi } from '../shared/ipc-contract';
import type { IpcError } from '../shared/schemas';

/**
 * The only bridge between the sandboxed renderer and main (docs/04 §1.2). Deliberately tiny: no generic
 * `invoke(channel)` escape hatch is exposed, only named methods.
 */
async function call<C extends Channel>(channel: C, request?: RequestOf<C>): Promise<ResponseOf<C>> {
  const result = (await ipcRenderer.invoke(channel, request)) as IpcResult<ResponseOf<C>>;
  if (result.ok) return result.data;
  // Errors crossing contextBridge lose their prototype; tag them so the renderer can recognise them.
  throw Object.assign(new Error(result.error.message), { ipcError: result.error satisfies IpcError });
}

const api: WinrarCloneApi = {
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
