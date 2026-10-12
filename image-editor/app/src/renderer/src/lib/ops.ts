import type { LayerTiles, OpsJob } from '../engine/ops/jobs';
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

/** Runs a pixel job in the ops worker (the editor's `runOps`). */
export function runOps(job: OpsJob, onProgress?: (p: number) => void): Promise<LayerTiles[]> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    ops().postMessage({ id, job });
  });
}
