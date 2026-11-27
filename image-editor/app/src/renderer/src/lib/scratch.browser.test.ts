import { describe, expect, it } from 'vitest';
import { SCRATCH_DIR } from '../engine/history/scratch-file';
import { TILE_BYTES } from '../engine/tiles/tile';
import { OpfsSpillStore } from './scratch';

/** The scratch store in real OPFS with the real worker (FR-HIS-03, ADR-0005), in headless Chromium. */

const flat = (v: number) => new Uint8ClampedArray(TILE_BYTES).fill(v);
function noise(seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(TILE_BYTES);
  let s = seed;
  for (let i = 0; i < out.length; i++) out[i] = (s = Math.imul(s ^ (s >>> 15), 2246822507) + i) >>> 24;
  return out;
}

async function scratchFiles(): Promise<string[]> {
  const dir = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle(SCRATCH_DIR, { create: true });
  const names: string[] = [];
  for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
  return names;
}

describe('OPFS history scratch file (FR-HIS-03)', () => {
  it('round-trips tiles exactly and leaves the caller’s data untouched', async () => {
    const store = new OpfsSpillStore();
    const a = flat(90);
    const b = noise(3);
    const ra = await store.put(a);
    const rb = await store.put(b);
    expect(a[0]).toBe(90); // a copy was sent, not the tile's own buffer
    expect(await store.get(rb)).toEqual(b);
    expect(await store.get(ra)).toEqual(a);
    expect(store.bytesOnDisk).toBeGreaterThan(TILE_BYTES); // the noise tile is stored raw
    store.free(ra);
    store.free(rb);
    await expect(store.get(ra)).rejects.toThrow(/No scratch record/);
  });

  it('a new window removes files left by a crashed session, but not those of a window still open', async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(SCRATCH_DIR, { create: true });
    await (
      await dir.getFileHandle('left-by-a-crash.bin', { create: true })
    )
      .createWritable()
      .then(async (w) => {
        await w.write(new Uint8Array(1000));
        await w.close();
      });
    const open = new OpfsSpillStore(); // another window, still running
    await open.open();
    const before = await scratchFiles();
    expect(before).not.toContain('left-by-a-crash.bin');
    const next = new OpfsSpillStore();
    const record = await open.put(noise(1));
    await next.open();
    // The open window's file survived the second window's clean-up and still reads back.
    expect(await open.get(record)).toEqual(noise(1));
    expect((await scratchFiles()).length).toBeGreaterThanOrEqual(2);
  });
});
