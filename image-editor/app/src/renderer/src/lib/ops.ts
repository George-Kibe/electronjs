import { filterReach } from '../engine/ops/filters';
import type { LayerTiles, OpsJob } from '../engine/ops/jobs';
import { parseTileKey, TILE_SIZE, tileKeysInRect, type TileKey } from '../engine/tiles/tile';
import type { OpsResponse } from '../workers/ops.worker';

/** Client for the ops worker (one per window, created on first use). */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  { resolve(v: LayerTiles[]): void; reject(e: Error): void; onProgress?(p: number): void }
>();

function ops(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/ops.worker.ts', import.meta.url), { type: 'module', name: 'ops' });
  worker.onmessage = (event: MessageEvent<OpsResponse>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if ('progress' in msg) return p.onProgress?.(msg.progress);
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.message));
  };
  worker.onerror = (e) => {
    console.error('[ops worker] crashed', e.message);
    for (const p of pending.values())
      p.reject(new Error('The image worker stopped unexpectedly. Try again.'));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** Runs a pixel job in the ops worker (the editor's `runOps`). Large filter jobs are shared out. */
export function runOps(job: OpsJob, onProgress?: (p: number) => void): Promise<LayerTiles[]> {
  if (job.op === 'filter') return runFilter(job, onProgress);
  return post(ops(), job, onProgress);
}

function post(
  target: Worker,
  job: OpsJob,
  onProgress?: (p: number) => void,
  transfer: Transferable[] = [],
): Promise<LayerTiles[]> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    target.postMessage({ id, job }, transfer);
  });
}

/**
 * The tiles copied into one buffer, as views on it: one memcpy and a transfer instead of cloning many small
 * arrays (the live tiles themselves must never be transferred away).
 */
function packed(tiles: LayerTiles['tiles']): { tiles: LayerTiles['tiles']; buffer: ArrayBuffer } {
  const buffer = new ArrayBuffer(tiles.reduce((n, [, t]) => n + t.byteLength, 0));
  let at = 0;
  const out = tiles.map(([k, t]): [TileKey, Uint8Array] => {
    const view = new Uint8Array(buffer, at, t.byteLength);
    view.set(t);
    at += t.byteLength;
    return [k, view];
  });
  return { tiles: out, buffer };
}

/** Extra workers for filters, which split well into bands of tile rows (NFR-PERF-05). */
const pool: Worker[] = [];
// Four: more workers than physical cores did not help on a 4-core / 8-thread laptop.
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

function poolWorker(i: number): Worker {
  if (i === 0) return ops();
  let w = pool[i - 1];
  if (!w) {
    w = new Worker(new URL('../workers/ops.worker.ts', import.meta.url), {
      type: 'module',
      name: `ops-${i}`,
    });
    w.onmessage = ops().onmessage;
    w.onerror = (e) => {
      console.error('[ops pool worker] crashed', e.message);
      pool.splice(i - 1, 1);
    };
    pool[i - 1] = w;
  }
  return w;
}

/** Starts the filter workers ahead of use (module load and start-up take a while), when the page is idle. */
export function warmUpOps(): void {
  for (let i = 0; i < POOL_SIZE; i++) poolWorker(i);
}

/**
 * A filter job in bands of tile rows, one per worker. Each band gets only the tiles it reads: its own rows
 * and the filter's reach above and below.
 */
async function runFilter(
  job: Extract<OpsJob, { op: 'filter' }>,
  onProgress?: (p: number) => void,
): Promise<LayerTiles[]> {
  const keys = job.keys ?? tileKeysInRect(0, 0, job.size.width, job.size.height);
  const rows = [...new Set(keys.map((k) => parseTileKey(k)[1]))].sort((a, b) => a - b);
  const bands = Math.min(POOL_SIZE, rows.length);
  if (bands <= 1) return post(ops(), job, onProgress);
  const margin = Math.ceil(filterReach(job.filter) / TILE_SIZE);
  const per = Math.ceil(rows.length / bands);
  const progress = new Array<number>(bands).fill(0);
  const parts = await Promise.all(
    Array.from({ length: bands }, (_, b) => {
      const mine = new Set(rows.slice(b * per, (b + 1) * per));
      if (mine.size === 0) return Promise.resolve<LayerTiles[]>([]);
      const lo = Math.min(...mine) - margin;
      const hi = Math.max(...mine) + margin;
      const near = (k: TileKey) => {
        const ty = parseTileKey(k)[1];
        return ty >= lo && ty <= hi;
      };
      const layer = packed(job.layer.tiles.filter(([k]) => near(k)));
      const selection = job.selection
        ? packed(job.selection.filter(([k]) => mine.has(parseTileKey(k)[1])))
        : null;
      const band: OpsJob = {
        ...job,
        layer: { id: job.layer.id, tiles: layer.tiles },
        selection: selection?.tiles ?? null,
        keys: keys.filter((k) => mine.has(parseTileKey(k)[1])),
      };
      const transfer = selection ? [layer.buffer, selection.buffer] : [layer.buffer];
      return post(
        poolWorker(b),
        band,
        (p) => {
          progress[b] = p;
          onProgress?.(progress.reduce((x, y) => x + y, 0) / bands);
        },
        transfer,
      );
    }),
  );
  return [{ id: job.layer.id, tiles: parts.flatMap((p) => p[0]?.tiles ?? []) }];
}
