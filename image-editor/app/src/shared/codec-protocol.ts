import type { ExportOptions } from './export-options';
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
  /** Raw EXIF block, carried opaquely so export can apply the metadata policy (FR-DOC-09). */
  exif: Uint8Array | null;
};

export type CodecToRenderer =
  | DecodedHeader
  | { type: 'chunk'; offset: number; data: Uint8Array }
  | { type: 'done' }
  | { type: 'error'; code: CodecErrorCode; message: string };

/**
 * Encode requests travel renderer → codec host over the brokered port: one 'encode-start', then 'chunk'
 * messages with straight RGBA8 rows (transferred), then 'encode-end'. The reply is 'encoded' or 'error'.
 */
export type RendererToCodec =
  | { type: 'encode-start'; width: number; height: number; options: ExportOptions; exif: Uint8Array | null }
  | { type: 'chunk'; offset: number; data: Uint8Array }
  | { type: 'encode-end' };

export type EncodeReply =
  { type: 'encoded'; bytes: Uint8Array } | { type: 'error'; code: CodecErrorCode; message: string };

/** main → codec host (over process.parentPort), with one MessagePort attached. */
export type CodecJob =
  | { type: 'decode'; requestId: string; path: string; limitInputPixels: number }
  | { type: 'encode'; requestId: string };
