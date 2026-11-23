import type { SpillStore } from '../engine/history/spill';
import type { ScratchRequest, ScratchResponse } from '../workers/scratch.worker';

type Ok = Extract<ScratchResponse, { ok: true }>;
type Body = ScratchRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/**
 * The history scratch file (FR-HIS-03) as a SpillStore: requests go to the scratch worker, which keeps the
 * file in OPFS. If the worker cannot start or dies, every later request fails, and history falls back to
 * dropping its oldest steps (ADR-0005). Record ids are chosen here and never repeat, so a record can never
 * be confused with another one.
 */
export class OpfsSpillStore implements SpillStore {
  private worker: Worker | null = null;
  private broken: Error | null = null;
  private readonly pending = new Map<number, { resolve: (r: Ok) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private nextRecord = 1;
  bytesOnDisk = 0;

  /** Starts the worker, which also removes scratch files left by earlier sessions. */
  open(): Promise<void> {
    return this.call({ op: 'open' }).then(() => undefined);
  }

  async put(data: Uint8ClampedArray): Promise<number> {
    const record = this.nextRecord++;
    const copy = new Uint8Array(data); // the tile itself stays as it is
    await this.call({ op: 'put', record, data: copy }, [copy.buffer]);
    return record;
  }

  async get(record: number): Promise<Uint8ClampedArray> {
    const start = performance.now();
    const r = await this.call({ op: 'get', record });
    // One entry per tile read back (E2E checks that undo really read the disk; docs/02 §4's 100 ms).
    performance.measure('scratch:get', { start });
    const data = r.data!;
    return new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  }

  free(record: number): void {
    this.call({ op: 'free', record }).catch(() => undefined);
  }

  private call(body: Body, transfer: Transferable[] = []): Promise<Ok> {
    if (this.broken) return Promise.reject(this.broken);
    const worker = this.start();
    const id = this.nextId++;
    return new Promise<Ok>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...body, id } as ScratchRequest, transfer);
    });
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../workers/scratch.worker.ts', import.meta.url), {
      type: 'module',
      name: 'scratch',
    });
    worker.onmessage = (event: MessageEvent<ScratchResponse>) => {
      const msg = event.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        this.bytesOnDisk = msg.bytes;
        p.resolve(msg);
      } else p.reject(new Error(msg.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error(`The scratch worker stopped: ${event.message || 'unknown error'}`));
    };
    this.worker = worker;
    return worker;
  }

  private fail(err: Error): void {
    this.broken = err;
    this.worker?.terminate();
    this.bytesOnDisk = 0;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
