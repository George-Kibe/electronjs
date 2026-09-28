import { z } from 'zod';
import { ExportFormat } from './export-options';
import type { MenuCommandId } from './menu';
import { AppInfo, FileRef, type IpcError } from './schemas';

/** Largest project or export the app reads or writes in one piece (bytes). */
export const MAX_FILE_BYTES = 2 * 1024 ** 3;

const Bytes = z.custom<Uint8Array>(
  (b) => b instanceof Uint8Array && b.byteLength <= MAX_FILE_BYTES,
  'Expected file bytes',
);

const RefId = FileRef.pick({ id: true });

/** Renderer ↔ main request/response channels (docs/04 §1). Validated on the main side. */
export const ipcContract = {
  'app.getInfo': { request: z.void(), response: AppInfo },
  'app.getLaunchFiles': { request: z.void(), response: z.array(FileRef) },
  /** Unsaved-changes state: macOS close-button dot and the close/quit guard (FR-DOC-11). */
  'app.setDocumentEdited': { request: z.boolean(), response: z.void() },
  /** Closes the window after the renderer has dealt with unsaved changes. */
  'app.closeWindow': { request: z.void(), response: z.void() },
  /** Images and `.iep` projects. */
  'dialog.openImage': { request: z.void(), response: FileRef.nullable() },
  /** Returns a writable ref for a new file; the extension is added if the user left it out. */
  'dialog.saveAs': {
    request: z.object({
      suggestedName: z.string().min(1).max(255),
      kind: z.union([z.literal('project'), ExportFormat]),
    }),
    response: FileRef.nullable(),
  },
  'files.registerDropped': {
    request: z.array(z.string().min(1).max(32_768)).max(100),
    response: z.array(FileRef),
  },
  /** Raw bytes of a user-chosen file, parsed in a worker (projects). Main never parses them. */
  'file.readBytes': { request: RefId, response: Bytes },
  /** Temp file + fsync + rename (NFR-REL-01). Only refs from a save dialog or an opened project. */
  'file.writeAtomic': { request: z.object({ ref: RefId, data: Bytes }), response: z.void() },
  /** Starts decoding; the pixel stream arrives on a MessagePort delivered via the 'codec.port' event. */
  'codec.decode': { request: RefId, response: z.object({ requestId: z.uuid() }) },
  /** Opens an encode session; pixels go to the codec host over the MessagePort from 'codec.port'. */
  'codec.encode': { request: z.void(), response: z.object({ requestId: z.uuid() }) },
} as const;

export type IpcContract = typeof ipcContract;
export type Channel = keyof IpcContract;
export type RequestOf<C extends Channel> = z.input<IpcContract[C]['request']>;
export type ResponseOf<C extends Channel> = z.output<IpcContract[C]['response']>;
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

/** main → renderer notifications (ipcRenderer.on), exposed by the preload as subscriptions. */
export interface ImageEditorEvents {
  /** The user tried to close the window with unsaved changes. Call app.closeWindow() to proceed. */
  onCloseRequested(cb: () => void): () => void;
  onMenuCommand(cb: (id: MenuCommandId) => void): () => void;
}

/** Unwrapped API used by renderer code (renderer/src/lib/api.ts). */
export interface ImageEditorApi {
  app: {
    getInfo(): Promise<ResponseOf<'app.getInfo'>>;
    getLaunchFiles(): Promise<ResponseOf<'app.getLaunchFiles'>>;
    setDocumentEdited(edited: boolean): Promise<void>;
    closeWindow(): Promise<void>;
  };
  dialog: {
    openImage(): Promise<ResponseOf<'dialog.openImage'>>;
    saveAs(req: RequestOf<'dialog.saveAs'>): Promise<ResponseOf<'dialog.saveAs'>>;
  };
  files: { registerDropped(files: File[]): Promise<ResponseOf<'files.registerDropped'>> };
  file: {
    readBytes(ref: Pick<FileRef, 'id'>): Promise<Uint8Array>;
    writeAtomic(ref: Pick<FileRef, 'id'>, data: Uint8Array): Promise<void>;
  };
  codec: {
    decode(ref: Pick<FileRef, 'id'>): Promise<ResponseOf<'codec.decode'>>;
    encode(): Promise<ResponseOf<'codec.encode'>>;
  };
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
} & { events: ImageEditorEvents };
