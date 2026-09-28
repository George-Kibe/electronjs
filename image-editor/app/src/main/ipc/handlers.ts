import type { BrowserWindow, Dialog, WebContents } from 'electron';
import type { FileRefRegistry } from '../services/file-refs';
import { HandlerError, type Handlers } from './router';

export type HandlerDeps = {
  refs: FileRefRegistry;
  dialog: Pick<Dialog, 'showOpenDialog'>;
  window: () => BrowserWindow | null;
  codec: { decode(path: string, target: WebContents): string };
  appInfo: { productName: string; version: string; platform: string; arch: string };
  launchPaths: string[];
};

const IMAGE_FILTER = {
  name: 'Images',
  extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff'],
};

export function createHandlers(deps: HandlerDeps): Handlers {
  let pendingLaunchPaths = [...deps.launchPaths];

  const registerAll = (paths: string[]) =>
    paths.flatMap((p) => {
      try {
        return [deps.refs.register(p)];
      } catch {
        return [];
      }
    });

  return {
    'app.getInfo': () => deps.appInfo,

    'app.getLaunchFiles': () => {
      const paths = pendingLaunchPaths;
      pendingLaunchPaths = [];
      return registerAll(paths);
    },

    'dialog.openImage': async () => {
      const win = deps.window();
      const options = {
        title: 'Open image',
        properties: ['openFile' as const],
        filters: [IMAGE_FILTER, { name: 'All files', extensions: ['*'] }],
      };
      const result = win
        ? await deps.dialog.showOpenDialog(win, options)
        : await deps.dialog.showOpenDialog(options);
      const path = result.canceled ? undefined : result.filePaths[0];
      return path ? deps.refs.register(path) : null;
    },

    'files.registerDropped': (paths) => registerAll(paths),

    'codec.decode': (ref, event) => {
      const path = deps.refs.resolve(ref);
      if (!path) throw new HandlerError('NOT_FOUND', 'That file is no longer available. Open it again.');
      return { requestId: deps.codec.decode(path, event.sender) };
    },
  };
}
