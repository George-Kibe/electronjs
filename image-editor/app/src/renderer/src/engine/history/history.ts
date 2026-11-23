import type { Command, DirtySet, TileHolder } from '../doc/commands';
import type { Document } from '../doc/document';
import type { Tile } from '../tiles/tile';
import { liveGrids, residentSlots, spilledSlots, type SpilledTile, type TileVault } from './spill';

export type HistoryOptions = { maxSteps: number; maxBytes: number };
export type HistoryEntry = { label: string; index: number };

export type SpillOptions = {
  vault: TileVault;
  /** Spilling or restoring failed (the document itself is never affected): tell the user. */
  onError?: (message: string) => void;
  /**
   * History's memory or its entries changed while the document did not (a spill finished, steps were
   * dropped): refresh the memory meter and the History panel, but nothing that depends on the pixels.
   */
  onStatus?: () => void;
};

/** What a spilled entry still costs in memory (its structure, not its tiles). */
const SPILLED_BYTES = 256;
/** Tiles written per round trip to the store (bounds the copies in flight). */
const SPILL_BATCH = 16;

export const SPILL_WRITE_FAILED =
  'History could not be written to the scratch disk. The oldest steps are removed when memory fills.';
export const SPILL_READ_FAILED =
  'Part of the history could not be read back from the scratch disk, so the steps beyond it were removed. Your image is unchanged.';

/**
 * Undo/redo over Commands (FR-HIS-01/02, ADR-0005). Bounded by a step count and a memory budget. With a
 * vault (FR-HIS-03), steps beyond the budget keep their place in history and spill their tiles to disk,
 * oldest first; undo and redo restore them first (async, `loading` meanwhile). Without one, or if the disk
 * fails, the oldest steps are dropped instead.
 */
export class History {
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];
  /** Entries whose tiles are in the store: they cost SPILLED_BYTES against the budget. */
  private readonly spilled = new WeakSet<Command>();
  /** Commands merge only while `coalesce` is true (e.g. during one slider drag). */
  private coalesceOpen = false;
  /** Changes with every push, pop or drop: work started before a change re-checks before it applies. */
  private generation = 0;
  private bytesCache: { generation: number; bytes: number } | null = null;
  private spilling: Promise<void> | null = null;
  /** Asked to spill while a spill was finishing: go again once it has. */
  private spillRequested = false;
  private spillBroken = false;
  private restoring: Promise<void> | null = null;

  /** SpillOptions' callbacks; rebound with onChange when a new Editor adopts this history. */
  onError: (message: string) => void;
  onStatus: () => void;

  constructor(
    private readonly doc: Document,
    private readonly options: HistoryOptions = { maxSteps: 100, maxBytes: 1024 ** 3 },
    /** Rebound when a document moves to a new Editor after an unrecoverable context loss. */
    public onChange: (dirty: DirtySet) => void = () => undefined,
    private readonly spill: SpillOptions | null = null,
  ) {
    this.onError = spill?.onError ?? (() => undefined);
    this.onStatus = spill?.onStatus ?? (() => undefined);
  }

  execute(cmd: Command, { coalesce = false } = {}): void {
    const dirty = cmd.do(this.doc);
    const last = this.done.at(-1);
    const merged = coalesce && this.coalesceOpen && last?.mergeWith ? last.mergeWith(cmd) : null;
    if (merged) this.done[this.done.length - 1] = merged;
    else this.done.push(cmd);
    this.coalesceOpen = coalesce;
    this.undone.length = 0; // a new action discards the redo branch
    this.changed();
    this.trim();
    this.onChange(dirty);
  }

  /** Changes the limits (Preferences › History steps); drops the oldest steps if they no longer fit. */
  setLimits(options: Partial<HistoryOptions>): void {
    Object.assign(this.options, options);
    this.trim();
    this.onChange({ layerIds: [], tiles: [] });
  }

  get limits(): Readonly<HistoryOptions> {
    return this.options;
  }

  /** Ends a coalescing sequence (e.g. slider released). */
  endCoalesce(): void {
    this.coalesceOpen = false;
  }

  /** Spilled tiles are being read back for an undo or redo; other changes wait. */
  get loading(): boolean {
    return this.restoring !== null;
  }

  /** Settles once no spill or restore is running (tests; the editor never needs to wait). */
  async idle(): Promise<void> {
    while (this.restoring || this.spilling) await (this.restoring ?? this.spilling);
  }

  undo(): boolean {
    const cmd = this.done.at(-1);
    if (!cmd || this.restoring) return false;
    this.run([cmd], () => this.undoNow());
    return true;
  }

  redo(): boolean {
    const cmd = this.undone.at(-1);
    if (!cmd || this.restoring) return false;
    this.run([cmd], () => this.redoNow());
    return true;
  }

  /** Moves to the state after `entries[index]` (History panel click). index -1 = initial state. */
  goTo(index: number): void {
    if (this.restoring) return;
    const back = this.done.slice(Math.max(0, index + 1)).reverse();
    const ahead = Math.min(index - this.position, this.undone.length);
    const forward = ahead > 0 ? this.undone.slice(this.undone.length - ahead).reverse() : [];
    const cmds = index < this.position ? back : index > this.position ? forward : [];
    if (cmds.length === 0) return;
    this.run(cmds, () => {
      while (this.done.length - 1 > index && this.undoNow());
      while (this.done.length - 1 < index && this.redoNow());
    });
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  get position(): number {
    return this.done.length - 1;
  }

  /** Memory the done entries hold (spilled ones count only their structure). */
  get sizeBytes(): number {
    if (this.bytesCache?.generation !== this.generation) {
      let bytes = 0;
      for (const c of this.done) bytes += this.spilled.has(c) ? SPILLED_BYTES : c.sizeBytes();
      this.bytesCache = { generation: this.generation, bytes };
    }
    return this.bytesCache.bytes;
  }

  /**
   * Identity of the current state: the last applied command (or null at the initial state). Compared with
   * the value recorded at save time to know whether the document has unsaved changes (FR-DOC-11).
   * A coalesced edit replaces the last command, so it changes the identity too.
   */
  get top(): Command | null {
    return this.done.at(-1) ?? null;
  }

  /** Done entries followed by undone (redoable) ones, in chronological order. */
  entries(): HistoryEntry[] {
    return [...this.done, ...[...this.undone].reverse()].map((c, index) => ({ label: c.label, index }));
  }

  // ---- applying ----------------------------------------------------------------------------------

  private undoNow(): boolean {
    const cmd = this.done.pop();
    if (!cmd) return false;
    this.coalesceOpen = false;
    this.undone.push(cmd);
    this.changed();
    this.onChange(cmd.undo(this.doc));
    return true;
  }

  private redoNow(): boolean {
    const cmd = this.undone.pop();
    if (!cmd) return false;
    this.done.push(cmd);
    this.changed();
    this.onChange(cmd.do(this.doc));
    return true;
  }

  /**
   * Runs `apply` once every tile `cmds` refer to is in memory: at once if none is spilled, else after
   * reading them back. The last check for placeholders and `apply` happen in one synchronous step, so no
   * spill can slip in between.
   */
  private run(cmds: Command[], apply: () => void): void {
    if (spilledSlots(holdersOf(cmds)).length === 0) {
      for (const c of cmds) this.markResident(c);
      apply();
      this.trim();
      return;
    }
    const generation = this.generation;
    let settle!: () => void;
    this.restoring = new Promise<void>((resolve) => (settle = resolve));
    // Spills skip their swap while `restoring` is set, so nothing new is spilled until `run` re-checks.
    this.readBack(cmds)
      .then(
        () => {
          this.restoring = null;
          // Something else changed history meanwhile (not possible through the editor, which waits).
          if (generation === this.generation) this.run(cmds, apply);
        },
        (err: unknown) => {
          console.error('[history] restore failed', err);
          this.restoring = null;
          this.dropUnreachable(cmds);
        },
      )
      .finally(settle);
  }

  private async readBack(cmds: Command[]): Promise<void> {
    for (;;) {
      const missing = spilledSlots(holdersOf(cmds));
      if (missing.length === 0) return;
      const tiles = await Promise.all(missing.map(([, , s]) => this.spill!.vault.revive(s)));
      missing.forEach(([h, k, s], i) => putBack(h, k, s, tiles[i]!));
    }
  }

  private markResident(cmd: Command): void {
    if (this.spilled.delete(cmd)) this.changed();
  }

  /**
   * A restore failed: the steps that needed the unreadable tiles, and those beyond them, can no longer be
   * reached. They are removed; the document was not touched.
   */
  private dropUnreachable(cmds: Command[]): void {
    this.spillBroken = true;
    const blocked = cmds.find((c) => spilledSlots(holdersOf([c])).length > 0) ?? cmds[0]!;
    const d = this.done.indexOf(blocked);
    if (d >= 0) this.done.splice(0, d + 1);
    const u = this.undone.indexOf(blocked);
    if (u >= 0) this.undone.splice(0, u + 1);
    this.changed();
    this.onError(SPILL_READ_FAILED);
    this.status();
  }

  // ---- budget ------------------------------------------------------------------------------------

  private changed(): void {
    this.generation++;
  }

  private status(): void {
    this.onStatus();
  }

  private trim(): void {
    let dropped = false;
    while (this.done.length > this.options.maxSteps) {
      this.done.shift();
      dropped = true;
    }
    if (dropped) this.changed();
    if (this.spill && !this.spillBroken) return this.spillSoon();
    this.dropOverBudget();
  }

  /**
   * Drops the oldest steps while history is over budget and nothing more can be spilled (no disk, or steps
   * without tiles such as selections). History can only lose its oldest end, so spilled steps go only as far
   * as needed to reach the resident ones that free the memory; never just spilled ones, which free nothing.
   * Without spilled steps this is the plain "drop the oldest" rule.
   */
  private dropOverBudget(): void {
    const excess = this.sizeBytes - this.options.maxBytes;
    let freed = 0;
    let n = 0;
    for (let i = 0; i < this.done.length - 1 && freed < excess; i++) {
      const c = this.done[i]!;
      if (this.spilled.has(c)) continue;
      freed += c.sizeBytes();
      n = i + 1;
    }
    if (n === 0) return;
    this.done.splice(0, n);
    this.changed();
    this.status();
  }

  /** Spills the oldest resident entries (never the newest, which may still coalesce) until under budget. */
  private spillSoon(): void {
    if (this.spilling) {
      this.spillRequested = true;
      return;
    }
    if (this.sizeBytes <= this.options.maxBytes) return;
    this.spilling = this.spillLoop()
      .catch((err: unknown) => console.error('[history] spill stopped', err))
      .finally(() => {
        this.spilling = null;
        if (this.spillRequested) {
          this.spillRequested = false;
          this.spillSoon();
        }
      });
  }

  private async spillLoop(): Promise<void> {
    const tried = new WeakSet<Command>();
    while (this.sizeBytes > this.options.maxBytes && !this.spillBroken) {
      if (this.restoring) await this.restoring;
      const cmd = this.done.slice(0, -1).find((c) => !this.spilled.has(c) && !tried.has(c) && c.tileHolders);
      if (!cmd) return this.dropOverBudget();
      tried.add(cmd);
      try {
        await this.spillOne(cmd);
      } catch (err) {
        console.error('[history] spill failed', err);
        this.spillBroken = true;
        this.onError(SPILL_WRITE_FAILED);
        this.trim();
        this.status();
        return;
      }
    }
  }

  private async spillOne(cmd: Command): Promise<void> {
    const vault = this.spill!.vault;
    const slots = residentSlots(holdersOf([cmd]), liveGrids(this.doc));
    for (let i = 0; i < slots.length; i += SPILL_BATCH) {
      const batch = slots.slice(i, i + SPILL_BATCH);
      const placeholders = await Promise.all(batch.map(([, , t]) => vault.stash(t)));
      // Swap now, synchronously: unless a restore is running, a grid became live again, or the entry
      // changed while the tiles were being written (then it stays in memory).
      if (this.restoring) return;
      const live = liveGrids(this.doc);
      batch.forEach(([h, k, t], j) => {
        if (!live.has(h) && h.get(k) === t) h.set(k, placeholders[j]!);
      });
    }
    if (!this.done.includes(cmd) && !this.undone.includes(cmd)) return;
    this.spilled.add(cmd);
    this.changed();
    this.status();
  }
}

/** The tile holders of `cmds`, each once. */
function holdersOf(cmds: readonly Command[]): Set<TileHolder> {
  const out = new Set<TileHolder>();
  for (const c of cmds) for (const h of c.tileHolders?.() ?? []) out.add(h);
  return out;
}

/** Puts a restored tile back where its placeholder is (unless the entry changed meanwhile). */
function putBack(holder: TileHolder, key: string, placeholder: SpilledTile, tile: Tile): void {
  if (holder.get(key) === placeholder) holder.set(key, tile);
}
