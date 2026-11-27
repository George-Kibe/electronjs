import { describe, expect, it } from 'vitest';
import { TILE_BYTES } from '../tiles/tile';
import { ScratchFile, type SyncFile } from './scratch-file';

/** A file in memory, with a size cap (quota) and a way to damage it. */
class MemoryFile implements SyncFile {
  bytes = new Uint8Array(0);
  constructor(private readonly quota = Infinity) {}
  read(buffer: Uint8Array, { at }: { at: number }): number {
    const part = this.bytes.subarray(at, at + buffer.length);
    buffer.set(part);
    return part.length;
  }
  write(buffer: Uint8Array, { at }: { at: number }): number {
    const end = at + buffer.length;
    if (end > this.quota) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    if (end > this.bytes.length) {
      const grown = new Uint8Array(end);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes.set(buffer, at);
    return buffer.length;
  }
  truncate(size: number): void {
    this.bytes = this.bytes.slice(0, size);
  }
}

const flat = (v: number) => new Uint8Array(TILE_BYTES).fill(v);
function noise(seed: number): Uint8Array {
  const out = new Uint8Array(TILE_BYTES);
  let s = seed;
  for (let i = 0; i < out.length; i++) out[i] = (s = Math.imul(s ^ (s >>> 15), 2246822507) + i) >>> 24;
  return out;
}

describe('history scratch file (FR-HIS-03)', () => {
  it('round-trips compressible and incompressible tiles exactly', () => {
    const f = new ScratchFile(new MemoryFile());
    const a = flat(200);
    const b = noise(7);
    f.put(1, a);
    f.put(2, b);
    expect(f.get(1)).toEqual(a);
    expect(f.get(2)).toEqual(b);
    // A flat tile deflates to almost nothing; noise is stored as it is.
    expect(f.bytes).toBeLessThan(TILE_BYTES + 2048);
    expect(f.bytes).toBeGreaterThanOrEqual(TILE_BYTES);
  });

  it('reuses freed slots and empties the file when nothing is left', () => {
    const file = new MemoryFile();
    const f = new ScratchFile(file);
    for (let r = 1; r <= 3; r++) f.put(r, noise(r));
    expect(file.bytes.length).toBe(3 * TILE_BYTES);
    f.free(2);
    f.put(4, noise(4));
    expect(file.bytes.length).toBe(3 * TILE_BYTES); // slot 2 again
    expect(f.get(4)).toEqual(noise(4));
    expect(f.get(3)).toEqual(noise(3));
    for (const r of [1, 3, 4]) f.free(r);
    expect(f.size).toBe(0);
    expect(f.bytes).toBe(0);
    expect(file.bytes.length).toBe(0);
  });

  it('refuses a damaged, missing or reused record instead of returning wrong pixels', () => {
    const file = new MemoryFile();
    const f = new ScratchFile(file);
    f.put(1, noise(1));
    file.bytes[1000] = file.bytes[1000]! ^ 0xff;
    expect(() => f.get(1)).toThrow(/damaged/);
    expect(() => f.get(99)).toThrow(/No scratch record/);
    expect(() => f.put(1, noise(2))).toThrow(/exists/);
    expect(() => f.put(2, new Uint8Array(10))).toThrow(RangeError);
  });

  it('a full disk fails the write and keeps the slot free for later', () => {
    const f = new ScratchFile(new MemoryFile(TILE_BYTES + 100));
    f.put(1, noise(1));
    expect(() => f.put(2, noise(2))).toThrow(/Quota/);
    f.free(1);
    f.put(3, noise(3));
    expect(f.get(3)).toEqual(noise(3));
  });
});
