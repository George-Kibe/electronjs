import { z } from 'zod';
import { AppInfo, FileRef, type IpcError } from './schemas';

/** Renderer ↔ main request/response channels (docs/04 §1). Validated on the main side. */
export const ipcContract = {
  'app.getInfo': { request: z.void(), response: AppInfo },
  'app.getLaunchFiles': { request: z.void(), response: z.array(FileRef) },
  'dialog.openImage': { request: z.void(), response: FileRef.nullable() },
  'files.registerDropped': {
    request: z.array(z.string().min(1).max(32_768)).max(100),
    response: z.array(FileRef),
  },
  /** Starts decoding; the pixel stream arrives on a MessagePort delivered via the 'codec.port' event. */
  'codec.decode': { request: FileRef.pick({ id: true }), response: z.object({ requestId: z.uuid() }) },
} as const;

export type IpcContract = typeof ipcContract;
export type Channel = keyof IpcContract;
export type RequestOf<C extends Channel> = z.input<IpcContract[C]['request']>;
export type ResponseOf<C extends Channel> = z.output<IpcContract[C]['response']>;
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

/** Unwrapped API used by renderer code (renderer/src/lib/api.ts). */
export interface ImageEditorApi {
  app: {
    getInfo(): Promise<ResponseOf<'app.getInfo'>>;
    getLaunchFiles(): Promise<ResponseOf<'app.getLaunchFiles'>>;
  };
  dialog: { openImage(): Promise<ResponseOf<'dialog.openImage'>> };
  files: { registerDropped(files: File[]): Promise<ResponseOf<'files.registerDropped'>> };
  codec: { decode(ref: Pick<FileRef, 'id'>): Promise<ResponseOf<'codec.decode'>> };
}

/**
 * `window.api` as exposed by the preload: methods resolve with the `{ ok, data | error }` envelope,
 * because contextBridge only copies `message` from thrown errors (lesson from WinrarClone M0).
 */
export type ImageEditorBridge = {
  [G in keyof ImageEditorApi]: {
    [M in keyof ImageEditorApi[G]]: ImageEditorApi[G][M] extends (...args: infer A) => Promise<infer R>
      ? (...args: A) => Promise<IpcResult<R>>
      : never;
  };
};
