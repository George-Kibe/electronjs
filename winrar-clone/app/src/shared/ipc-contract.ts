import { z } from 'zod';
import {
  AppInfo,
  FileRef,
  type IpcError,
  ListRequest,
  ListResult,
  OpenArchiveRequest,
  OpenArchiveResult,
} from './schemas';

/**
 * Single source of truth for renderer ↔ main request/response channels (docs/04 §1).
 * Every request and response is validated with these schemas on the main side.
 */
export const ipcContract = {
  'app.getInfo': { request: z.void(), response: AppInfo },
  /** Archives passed on the command line / via file association at startup (consumed once). */
  'app.getLaunchFiles': { request: z.void(), response: z.array(FileRef) },
  'dialog.openArchive': { request: z.void(), response: FileRef.nullable() },
  'files.registerDropped': {
    request: z.array(z.string().min(1).max(32_768)).max(1000),
    response: z.array(FileRef),
  },
  'archive.open': { request: OpenArchiveRequest, response: OpenArchiveResult },
  'archive.list': { request: ListRequest, response: ListResult },
  'archive.close': { request: z.uuid(), response: z.void() },
} as const;

export type IpcContract = typeof ipcContract;
export type Channel = keyof IpcContract;
export type RequestOf<C extends Channel> = z.input<IpcContract[C]['request']>;
export type ResponseOf<C extends Channel> = z.output<IpcContract[C]['response']>;

/** Envelope used on the wire so errors keep their codes (ipcMain.handle rejections lose structure). */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

/** Shape of `window.api` exposed by the preload script. */
export interface WinrarCloneApi {
  app: {
    getInfo(): Promise<ResponseOf<'app.getInfo'>>;
    getLaunchFiles(): Promise<ResponseOf<'app.getLaunchFiles'>>;
  };
  dialog: { openArchive(): Promise<ResponseOf<'dialog.openArchive'>> };
  files: { registerDropped(files: File[]): Promise<ResponseOf<'files.registerDropped'>> };
  archive: {
    open(req: RequestOf<'archive.open'>): Promise<ResponseOf<'archive.open'>>;
    list(req: RequestOf<'archive.list'>): Promise<ResponseOf<'archive.list'>>;
    close(sessionId: string): Promise<void>;
  };
}
