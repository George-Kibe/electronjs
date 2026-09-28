import type { Command, DirtySet } from '../doc/commands';
import type { Document } from '../doc/document';

export type HistoryOptions = { maxSteps: number; maxBytes: number };
export type HistoryEntry = { label: string; index: number };

/**
 * Undo/redo over Commands (FR-HIS-01/02, ADR-0005). Bounded by step count and bytes; the oldest steps are
 * dropped first. Disk spill (FR-HIS-03) arrives in M2.
 */
export class History {
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];
  private bytes = 0;
  /** Commands merge only while `coalesce` is true (e.g. during one slider drag). */
  private coalesceOpen = false;

  constructor(
    private readonly doc: Document,
    private readonly options: HistoryOptions = { maxSteps: 100, maxBytes: 1024 ** 3 },
    /** Rebound when a document moves to a new Editor after an unrecoverable context loss. */
    public onChange: (dirty: DirtySet) => void = () => undefined,
  ) {}

  execute(cmd: Command, { coalesce = false } = {}): void {
    const dirty = cmd.do(this.doc);
    const last = this.done.at(-1);
    const merged = coalesce && this.coalesceOpen && last?.mergeWith ? last.mergeWith(cmd) : null;
    if (merged) {
      this.bytes += merged.sizeBytes() - last!.sizeBytes();
      this.done[this.done.length - 1] = merged;
    } else {
      this.done.push(cmd);
      this.bytes += cmd.sizeBytes();
    }
    this.coalesceOpen = coalesce;
    this.undone.length = 0; // a new action discards the redo branch (its bytes were released on undo)
    this.trim();
    this.onChange(dirty);
  }

  /** Ends a coalescing sequence (e.g. slider released). */
  endCoalesce(): void {
    this.coalesceOpen = false;
  }

  undo(): boolean {
    const cmd = this.done.pop();
    if (!cmd) return false;
    this.coalesceOpen = false;
    this.bytes -= cmd.sizeBytes();
    this.undone.push(cmd);
    this.onChange(cmd.undo(this.doc));
    return true;
  }

  redo(): boolean {
    const cmd = this.undone.pop();
    if (!cmd) return false;
    this.done.push(cmd);
    this.bytes += cmd.sizeBytes();
    this.onChange(cmd.do(this.doc));
    return true;
  }

  /** Moves to the state after `entries[index]` (History panel click). index -1 = initial state. */
  goTo(index: number): void {
    while (this.done.length - 1 > index && this.undo());
    while (this.done.length - 1 < index && this.redo());
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

  get sizeBytes(): number {
    return this.bytes;
  }

  /** Done entries followed by undone (redoable) ones, in chronological order. */
  entries(): HistoryEntry[] {
    return [...this.done, ...[...this.undone].reverse()].map((c, index) => ({ label: c.label, index }));
  }

  private trim(): void {
    while (
      this.done.length > this.options.maxSteps ||
      (this.bytes > this.options.maxBytes && this.done.length > 1)
    ) {
      const oldest = this.done.shift()!;
      this.bytes -= oldest.sizeBytes();
    }
  }
}
