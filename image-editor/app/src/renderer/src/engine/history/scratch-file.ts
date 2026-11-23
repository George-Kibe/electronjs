import { deflateSync, inflateSync } from 'fflate';
import { TILE_BYTES } from '../tiles/tile';

/**
 * The history scratch file (FR-HIS-03, docs/02 §4): one file per window in OPFS, written by the scratch
 * worker through a synchronous access handle. Records are tiles, each in a fixed slot of TILE_BYTES,
 * deflated (fflate level 1) unless that does not make them smaller. Freed slots are reused, and the file
 * is truncated when it holds nothing. A hash of the pixels is checked on every read, so a damaged record
 * is refused instead of coming back as wrong pixels.
 */

/** The OPFS folder of the scratch files; each window's file is locked while the window is open. */
export const SCRATCH_DIR = 'history-scratch';

/** What ScratchFile needs of a FileSystemSyncAccessHandle (a fake in tests). */
export interface SyncFile {
  read(buffer: Uint8Array, options: { at: number }): number;
  write(buffer: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
}

type Entry = { slot: number; length: number; raw: boolean; hash: number };

/** FNV-1a over 32-bit words. */
export function tileHash(data: Uint8Array): number {
  const words = new Int32Array(data.buffer, data.byteOffset, data.length >> 2);
  let h = 2166136261;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i]!, 16777619);
  return h >>> 0;
}

export class ScratchFile {
  private readonly entries = new Map<number, Entry>();
  private readonly freeSlots: number[] = [];
  private slots = 0;
  /** Bytes the records take. */
  bytes = 0;

  constructor(private readonly file: SyncFile) {}

  /** Stores one tile under `record` (ids are chosen by the caller, so they never repeat). */
  put(record: number, data: Uint8Array): void {
    if (data.length !== TILE_BYTES)
      throw new RangeError(`A scratch record is one tile (${TILE_BYTES} bytes)`);
    if (this.entries.has(record)) throw new Error(`Scratch record ${record} exists`);
    const packed = deflateSync(data, { level: 1 });
    const raw = packed.length >= TILE_BYTES;
    const body = raw ? data : packed;
    const slot = this.freeSlots.pop() ?? this.slots++;
    let written: number;
    try {
      written = this.file.write(body, { at: slot * TILE_BYTES });
    } catch (err) {
      this.freeSlots.push(slot);
      throw err;
    }
    if (written !== body.length) {
      this.freeSlots.push(slot);
      throw new Error('The scratch disk is full');
    }
    this.entries.set(record, { slot, length: body.length, raw, hash: tileHash(data) });
    this.bytes += body.length;
  }

  get(record: number): Uint8Array {
    const e = this.entries.get(record);
    if (!e) throw new Error(`No scratch record ${record}`);
    const body = new Uint8Array(e.length);
    if (this.file.read(body, { at: e.slot * TILE_BYTES }) !== e.length)
      throw new Error(`Scratch record ${record} is cut short`);
    const data = e.raw ? body : inflateSync(body);
    if (data.length !== TILE_BYTES || tileHash(data) !== e.hash)
      throw new Error(`Scratch record ${record} is damaged`);
    return data;
  }

  free(record: number): void {
    const e = this.entries.get(record);
    if (!e) return;
    this.entries.delete(record);
    this.bytes -= e.length;
    this.freeSlots.push(e.slot);
    if (this.entries.size === 0) {
      this.freeSlots.length = 0;
      this.slots = 0;
      this.file.truncate(0);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
