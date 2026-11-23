import { describe, expect, it } from 'vitest';
import { createTile, TILE_BYTES, TileGrid, type Tile } from '../tiles/tile';
import { isSpilled, residentSlots, spilledSlots, SpilledTile, TileVault, type SpillStore } from './spill';

class CountingStore implements SpillStore {
  readonly records = new Map<number, Uint8ClampedArray>();
  puts = 0;
  gets = 0;
  private next = 1;
  get bytesOnDisk(): number {
    return this.records.size * TILE_BYTES;
  }
  async put(data: Uint8ClampedArray): Promise<number> {
    this.puts++;
    await Promise.resolve();
    this.records.set(this.next, data.slice());
    return this.next++;
  }
  async get(record: number): Promise<Uint8ClampedArray> {
    this.gets++;
    await Promise.resolve();
    return this.records.get(record)!.slice();
  }
  free(record: number): void {
    this.records.delete(record);
  }
}

const tile = (v: number): Tile => createTile(new Uint8ClampedArray(TILE_BYTES).fill(v));

describe('TileVault (FR-HIS-03)', () => {
  it('writes a tile once, however often and however concurrently it is stashed', async () => {
    const store = new CountingStore();
    const vault = new TileVault(store);
    const t = tile(7);
    const [a, b] = await Promise.all([vault.stash(t), vault.stash(t)]);
    const c = await vault.stash(t);
    expect(store.puts).toBe(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(a.id).toBe(t.id);
  });

  it('gives back the original while it is in memory, without reading the store', async () => {
    const store = new CountingStore();
    const vault = new TileVault(store);
    const t = tile(3);
    const s = await vault.stash(t);
    expect(await vault.revive(s)).toBe(t);
    expect(store.gets).toBe(0);
  });

  it('reads a tile back with the same pixels once the original is gone, one read for concurrent revives', async () => {
    const store = new CountingStore();
    const vault = new TileVault(store, { weakRefs: false });
    const t = tile(9);
    const s = await vault.stash(t);
    const [a, b] = await Promise.all([vault.revive(s), vault.revive(s)]);
    expect(store.gets).toBe(1);
    expect(a).toBe(b);
    expect(a).not.toBe(t);
    expect(a.data).toEqual(t.data);
    // The revived tile is already in the store: spilling it again writes nothing.
    expect(await vault.stash(a)).toBe(s);
    expect(store.puts).toBe(1);
  });

  it('a placeholder refuses to be read as pixels', () => {
    const s = new SpilledTile(1, 1, { deref: () => undefined });
    expect(isSpilled(s)).toBe(true);
    expect(isSpilled(tile(1))).toBe(false);
    expect(() => s.data).toThrow(/scratch file/);
  });

  it('finds resident tiles outside live holders, and placeholders anywhere', async () => {
    const vault = new TileVault(new CountingStore());
    const live = new TileGrid();
    live.set('0,0', tile(1));
    const old = new TileGrid();
    old.set('0,0', tile(2));
    old.set('1,0', await vault.stash(tile(3)));
    const own = new Map<string, Tile | undefined>([
      ['0,0', tile(4)],
      ['1,0', undefined],
    ]);
    expect(residentSlots([live, old, own], new Set([live])).map(([h, k]) => [h === old, k])).toEqual([
      [true, '0,0'],
      [false, '0,0'],
    ]);
    expect(spilledSlots([live, old, own]).map(([, k]) => k)).toEqual(['1,0']);
  });
});
