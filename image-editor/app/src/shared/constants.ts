/** Product identity. Working names only; everything user-facing must come from here (AGENTS.md). */
export const PRODUCT_NAME = 'ImageEditor';
export const APP_ID = 'com.georgekibe.imageeditor';

/** The renderer is served from this privileged origin in production (docs/02 §2). */
export const APP_SCHEME = 'app';
export const APP_HOST = 'editor';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Enables crossOriginIsolated (SharedArrayBuffer for multi-threaded WASM, secure-context OPFS). */
export const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

/** Largest document side in pixels (FR-DOC-01) and the decoder's pixel budget (docs/06 §3). */
export const MAX_DOCUMENT_SIDE = 20_000;
export const MAX_INPUT_PIXELS = 400_000_000;

/** Pixel payloads are streamed from the codec host in chunks of this size. */
export const CODEC_CHUNK_BYTES = 16 * 1024 * 1024;

/** window.postMessage type the preload uses to hand a codec MessagePort to the page. */
export const CODEC_PORT_MESSAGE = 'image-editor:codec-port';
