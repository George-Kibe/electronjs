import type { CodecErrorCode } from './schemas';

/**
 * Messages on the MessagePort between the codec host (sharp) and the renderer (docs/04 §1.1).
 * Main binds the file path when it creates the port pair; the renderer never sends paths.
 */
export type DecodedHeader = {
  type: 'decoded-header';
  width: number;
  height: number;
  /** Bytes that will follow in 'chunk' messages: width * height * 4 (straight RGBA8, sRGB). */
  byteLength: number;
  format: string;
  /** Name/description of the source ICC profile converted to sRGB, if any. */
  sourceProfile: string | null;
  /** EXIF orientation that was applied (1 = none). */
  orientation: number;
};

export type CodecToRenderer =
  | DecodedHeader
  | { type: 'chunk'; offset: number; data: Uint8Array }
  | { type: 'done' }
  | { type: 'error'; code: CodecErrorCode; message: string };

/** main → codec host (over process.parentPort), with one MessagePort attached. */
export type CodecJob = { type: 'decode'; requestId: string; path: string; limitInputPixels: number };
