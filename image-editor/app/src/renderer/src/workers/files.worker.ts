/// <reference lib="webworker" />
import type { EncodeReply, RendererToCodec } from '@shared/codec-protocol';
import { CODEC_CHUNK_BYTES, MAX_DOCUMENT_SIDE } from '@shared/constants';
import type { ExportOptions } from '@shared/export-options';
import { flatten, flattenPreview } from '../engine/doc/flatten';
import { IepError, readIep, writeIep } from '../engine/io/iep';
import { snapshotLayers, type DocSnapshot, type LayerSnapshot } from '../engine/io/snapshot';

/**
 * File worker (docs/02 §2): `.iep` zip read/write, flattening for export and previews. Keeps full-canvas
 * buffers and untrusted project parsing off the UI thread. Export pixels stream from here straight to the
 * codec host over a MessagePort the page transfers in.
 */
export type FilesRequest =
  | { op: 'readIep'; bytes: Uint8Array; maxTileBytes: number }
  | { op: 'writeIep'; doc: DocSnapshot; appVersion: string }
  /** Recent-files thumbnail (FR-GEN-08): a small PNG of the composite. */
  | { op: 'thumbnail'; doc: DocSnapshot; maxSide: number }
  /** Clipboard paste (FR-DOC-02/12): decoded by Chromium inside the sandbox (docs/06 §2). */
  | { op: 'decodeClipboard'; blob: Blob }
  /** Clipboard copy (FR-DOC-12): the snapshot's composite as PNG, transparency kept. */
  | { op: 'encodePng'; doc: DocSnapshot }
  | {
      op: 'export';
      doc: DocSnapshot;
      /** Documents with the same version flatten to the same pixels; the last flatten is reused. */
      version: number;
      options: ExportOptions;
      port: MessagePort;
    };

export type FilesResponse =
  | { id: number; ok: true; result: unknown }
  | {
      id: number;
      ok: false;
      message: string;
      code: 'INVALID_PROJECT' | 'CODEC' | 'INTERNAL' | 'CLIPBOARD';
    }
  | { id: number; progress: number };

declare const self: DedicatedWorkerGlobalScope;

const layersOf = (doc: DocSnapshot) => snapshotLayers(doc.layers);

/** Every tile buffer in the tree (transferred back to the page instead of copied). */
function tileBuffers(layers: LayerSnapshot[], out: ArrayBuffer[] = []): ArrayBuffer[] {
  for (const l of layers) {
    if (l.type === 'group') tileBuffers(l.children, out);
    else for (const [, t] of l.tiles) out.push(t.buffer as ArrayBuffer);
  }
  return out;
}

async function previewPng(doc: DocSnapshot, maxSide = 1024): Promise<Uint8Array | undefined> {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const { width, height, rgba } = flattenPreview(layersOf(doc), doc.width, doc.height, maxSide);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

class ClipboardError extends Error {}

/** Straight RGBA8 of a clipboard image (sRGB, as Chromium decodes it). */
async function decodeClipboard(blob: Blob): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  } catch {
    throw new ClipboardError('The clipboard holds an image in a format that cannot be pasted.');
  }
  const { width, height } = bitmap;
  if (width > MAX_DOCUMENT_SIDE || height > MAX_DOCUMENT_SIDE) {
    bitmap.close();
    throw new ClipboardError(`The clipboard image is too large (${width} × ${height} px).`);
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data;
  return { width, height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

async function encodePng(doc: DocSnapshot): Promise<Uint8Array> {
  // flatten() allocates a plain ArrayBuffer (never shared), so the cast is safe.
  const rgba = flatten(layersOf(doc), doc.width, doc.height) as Uint8ClampedArray<ArrayBuffer>;
  const canvas = new OffscreenCanvas(doc.width, doc.height);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, doc.width, doc.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

let cache: { version: number; width: number; height: number; rgba: Uint8ClampedArray } | null = null;

function flattened(doc: DocSnapshot, version: number, progress: (p: number) => void): Uint8ClampedArray {
  if (cache && cache.version === version && cache.width === doc.width && cache.height === doc.height)
    return cache.rgba;
  cache = null; // release the old buffer before allocating a new one
  const rgba = flatten(layersOf(doc), doc.width, doc.height, (done, total) => progress((done / total) * 0.5));
  cache = { version, width: doc.width, height: doc.height, rgba };
  return rgba;
}

/** Streams pixels to the codec host and waits for the encoded file bytes. */
function encodeOverPort(
  port: MessagePort,
  rgba: Uint8ClampedArray,
  doc: DocSnapshot,
  options: ExportOptions,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    port.onmessage = (event: MessageEvent<EncodeReply>) => {
      port.close();
      if (event.data.type === 'encoded') resolve(event.data.bytes);
      else reject(Object.assign(new Error(event.data.message), { codec: true }));
    };
    const send = (m: RendererToCodec) => port.postMessage(m);
    send({ type: 'encode-start', width: doc.width, height: doc.height, options, exif: doc.exif });
    for (let offset = 0; offset < rgba.byteLength; offset += CODEC_CHUNK_BYTES) {
      // Structured-cloned, not transferred: Electron's MessagePortMain (the codec host's end) cannot
      // receive transferred ArrayBuffers. The copy also keeps the cached flatten intact.
      send({
        type: 'chunk',
        offset,
        data: new Uint8Array(
          rgba.buffer,
          rgba.byteOffset + offset,
          Math.min(CODEC_CHUNK_BYTES, rgba.byteLength - offset),
        ),
      });
    }
    send({ type: 'encode-end' });
    port.start();
  });
}

self.onmessage = async (event: MessageEvent<{ id: number } & FilesRequest>) => {
  const { id, ...req } = event.data;
  const reply = (m: FilesResponse, transfer: Transferable[] = []) => self.postMessage(m, transfer);
  const progress = (p: number) => reply({ id, progress: p });
  try {
    if (req.op === 'readIep') {
      const result = readIep(req.bytes, { maxTileBytes: req.maxTileBytes });
      reply({ id, ok: true, result }, [...new Set(tileBuffers(result.doc.layers))]);
    } else if (req.op === 'writeIep') {
      const bytes = writeIep(req.doc, { appVersion: req.appVersion, previewPng: await previewPng(req.doc) });
      reply({ id, ok: true, result: bytes }, [bytes.buffer as ArrayBuffer]);
    } else if (req.op === 'decodeClipboard') {
      const decoded = await decodeClipboard(req.blob);
      reply({ id, ok: true, result: decoded }, [decoded.rgba.buffer as ArrayBuffer]);
    } else if (req.op === 'encodePng') {
      const png = await encodePng(req.doc);
      reply({ id, ok: true, result: png }, [png.buffer as ArrayBuffer]);
    } else if (req.op === 'thumbnail') {
      const png = await previewPng(req.doc, req.maxSide);
      reply({ id, ok: true, result: png ?? null }, png ? [png.buffer as ArrayBuffer] : []);
    } else if (req.op === 'export') {
      const rgba = flattened(req.doc, req.version, progress);
      progress(0.5);
      const bytes = await encodeOverPort(req.port, rgba, req.doc, req.options);
      reply({ id, ok: true, result: bytes }, [bytes.buffer as ArrayBuffer]);
    }
  } catch (err) {
    if (err instanceof IepError) reply({ id, ok: false, code: 'INVALID_PROJECT', message: err.message });
    else if (err instanceof ClipboardError) reply({ id, ok: false, code: 'CLIPBOARD', message: err.message });
    else if (err instanceof Error && 'codec' in err)
      reply({ id, ok: false, code: 'CODEC', message: err.message });
    else {
      console.error('[files worker]', err);
      reply({ id, ok: false, code: 'INTERNAL', message: 'Something went wrong while processing the file.' });
    }
  }
};
