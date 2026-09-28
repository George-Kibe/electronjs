import type { ExportOptions } from '@shared/export-options';
import type { DocSnapshot } from '../engine/io/snapshot';
import type { IepReadResult } from '../engine/io/iep';
import type { FilesRequest, FilesResponse } from '../workers/files.worker';
import { api } from './api';
import { codecPort } from './codec';

/** Client for the file worker (one per window, created on first use). */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  { resolve(v: unknown): void; reject(e: Error): void; onProgress?(p: number): void }
>();

function files(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/files.worker.ts', import.meta.url), {
    type: 'module',
    name: 'files',
  });
  worker.onmessage = (event: MessageEvent<FilesResponse>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if ('progress' in msg) return p.onProgress?.(msg.progress);
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.message));
  };
  worker.onerror = (e) => {
    console.error('[files worker] crashed', e.message);
    for (const p of pending.values()) p.reject(new Error('The file worker stopped unexpectedly. Try again.'));
    pending.clear();
    worker = null; // a fresh worker is created on the next request
  };
  return worker;
}

function request<T>(
  req: FilesRequest,
  transfer: Transferable[] = [],
  onProgress?: (p: number) => void,
): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    files().postMessage({ id, ...req }, transfer);
  });
}

/** Memory budget for opening projects: tile bytes after inflating (docs/05 §2.4). */
const MAX_PROJECT_TILE_BYTES = 4 * 1024 ** 3;

export function readProject(bytes: Uint8Array): Promise<IepReadResult> {
  return request({ op: 'readIep', bytes, maxTileBytes: MAX_PROJECT_TILE_BYTES }, [
    bytes.buffer as ArrayBuffer,
  ]);
}

export function writeProject(doc: DocSnapshot, appVersion: string): Promise<Uint8Array> {
  return request({ op: 'writeIep', doc, appVersion });
}

/** Flattens and encodes in the worker + codec host; returns the file bytes (not yet written). */
export async function encodeExport(
  doc: DocSnapshot,
  version: number,
  options: ExportOptions,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const { requestId } = await api.codec.encode();
  const port = await codecPort(requestId);
  return request({ op: 'export', doc, version, options, port }, [port], onProgress);
}
