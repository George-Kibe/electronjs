/// <reference lib="webworker" />
import { runOpsJob, type LayerTiles, type OpsJob } from '../engine/ops/jobs';

/**
 * CPU ops worker (docs/02 §2): resampling for Image Size and arbitrary rotation, off the UI thread. Results
 * are transferred back, not copied.
 */
export type OpsResponse =
  | { id: number; ok: true; result: LayerTiles[] }
  | { id: number; ok: false; message: string }
  | { id: number; progress: number };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<{ id: number; job: OpsJob }>) => {
  const { id, job } = event.data;
  try {
    let last = 0;
    const result = runOpsJob(job, (p) => {
      // At most ~50 progress messages per job.
      if (p - last >= 0.02 || p >= 1) {
        last = p;
        self.postMessage({ id, progress: p } satisfies OpsResponse);
      }
    });
    const buffers = new Set(result.flatMap((l) => l.tiles.map(([, b]) => b.buffer as ArrayBuffer)));
    self.postMessage({ id, ok: true, result } satisfies OpsResponse, [...buffers]);
  } catch (err) {
    console.error('[ops worker]', err);
    self.postMessage({
      id,
      ok: false,
      message: 'Something went wrong while processing the image.',
    } satisfies OpsResponse);
  }
};
