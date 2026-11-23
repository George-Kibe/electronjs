/// <reference lib="webworker" />
import { SCRATCH_DIR, ScratchFile } from '../engine/history/scratch-file';

/**
 * Scratch worker (docs/02 §2, ADR-0005): owns this window's history scratch file in OPFS through a
 * synchronous access handle, which only a dedicated worker may open. The handle also locks the file, so
 * another window's start-up clean-up leaves it alone.
 */
export type ScratchRequest =
  | { id: number; op: 'open' }
  | { id: number; op: 'put'; record: number; data: Uint8Array }
  | { id: number; op: 'get'; record: number }
  | { id: number; op: 'free'; record: number };

export type ScratchResponse =
  { id: number; ok: true; bytes: number; data?: Uint8Array } | { id: number; ok: false; message: string };

declare const self: DedicatedWorkerGlobalScope;

let file: Promise<ScratchFile> | null = null;

async function open(): Promise<ScratchFile> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(SCRATCH_DIR, { create: true });
  // Remove what earlier sessions left behind (a crash keeps its file). A file another window has open is
  // locked and refuses to go, which is what keeps it.
  const names: string[] = [];
  for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
  await Promise.all(names.map((name) => dir.removeEntry(name, { recursive: true }).catch(() => undefined)));
  const handle = await dir.getFileHandle(`${crypto.randomUUID()}.bin`, { create: true });
  return new ScratchFile(await handle.createSyncAccessHandle());
}

self.onmessage = async (event: MessageEvent<ScratchRequest>) => {
  const msg = event.data;
  try {
    file ??= open();
    const f = await file;
    if (msg.op === 'put') f.put(msg.record, msg.data);
    else if (msg.op === 'free') f.free(msg.record);
    if (msg.op === 'get') {
      const data = f.get(msg.record);
      self.postMessage({ id: msg.id, ok: true, bytes: f.bytes, data } satisfies ScratchResponse, [
        data.buffer as ArrayBuffer,
      ]);
    } else self.postMessage({ id: msg.id, ok: true, bytes: f.bytes } satisfies ScratchResponse);
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    self.postMessage({ id: msg.id, ok: false, message } satisfies ScratchResponse);
  }
};
