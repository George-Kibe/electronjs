/// <reference lib="webworker" />
import type { EncodeReply, RendererToCodec } from '@shared/codec-protocol';
import { CODEC_CHUNK_BYTES } from '@shared/constants';
import type { ExportOptions } from '@shared/export-options';
import { flatten, flattenPreview, type FlatLayer } from '../engine/doc/flatten';
import { IepError, readIep, writeIep } from '../engine/io/iep';
import type { DocSnapshot } from '../engine/io/snapshot';

/**
 * File worker (docs/02 §2): `.iep` zip read/write, flattening for export and previews. Keeps full-canvas
 * buffers and untrusted project parsing off the UI thread. Export pixels stream from here straight to the
 * codec host over a MessagePort the page transfers in.
 */
export type FilesRequest =
  | { op: 'readIep'; bytes: Uint8Array; maxTileBytes: number }
  | { op: 'writeIep'; doc: DocSnapshot; appVersion: string }
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
  | { id: number; ok: false; message: string; code: 'INVALID_PROJECT' | 'CODEC' | 'INTERNAL' }
  | { id: number; progress: number };

declare const self: DedicatedWorkerGlobalScope;

function layersOf(doc: DocSnapshot): FlatLayer[] {
  return doc.layers.map((l) => {
    const tiles = new Map(l.tiles);
    return { ...l, tile: (key) => tiles.get(key) };
  });
}

async function previewPng(doc: DocSnapshot): Promise<Uint8Array | undefined> {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const { width, height, rgba } = flattenPreview(layersOf(doc), doc.width, doc.height, 1024);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
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
      const transfer = result.doc.layers.flatMap((l) => l.tiles.map(([, t]) => t.buffer as ArrayBuffer));
      reply({ id, ok: true, result }, [...new Set(transfer)]);
    } else if (req.op === 'writeIep') {
      const bytes = writeIep(req.doc, { appVersion: req.appVersion, previewPng: await previewPng(req.doc) });
      reply({ id, ok: true, result: bytes }, [bytes.buffer as ArrayBuffer]);
    } else if (req.op === 'export') {
      const rgba = flattened(req.doc, req.version, progress);
      progress(0.5);
      const bytes = await encodeOverPort(req.port, rgba, req.doc, req.options);
      reply({ id, ok: true, result: bytes }, [bytes.buffer as ArrayBuffer]);
    }
  } catch (err) {
    if (err instanceof IepError) reply({ id, ok: false, code: 'INVALID_PROJECT', message: err.message });
    else if (err instanceof Error && 'codec' in err)
      reply({ id, ok: false, code: 'CODEC', message: err.message });
    else {
      console.error('[files worker]', err);
      reply({ id, ok: false, code: 'INTERNAL', message: 'Something went wrong while processing the file.' });
    }
  }
};
