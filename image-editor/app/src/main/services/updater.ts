import type { UpdateChannel } from '@shared/settings';
import type { UpdateStatus } from '@shared/update';

/** What the update backend reports (electron-updater's events, narrowed to what we use). */
export type UpdaterEvents = {
  available(version: string): void;
  notAvailable(): void;
  progress(percent: number): void;
  downloaded(version: string): void;
  error(err: unknown): void;
};

/** The update backend: electron-updater in production, a scripted fake in E2E (electron-updater.ts). */
export interface Updater {
  setChannel(channel: UpdateChannel): void;
  /** Resolves when the check is done; a found update keeps downloading in the background. */
  check(): Promise<void>;
  /** Quits the app and runs the installer (the app restarts on the new version). */
  quitAndInstall(): void;
}

export type UpdateServiceOptions = {
  /** Whether this installation can update itself (development builds and deb/rpm cannot). */
  availability: 'available' | 'development' | 'package-manager';
  /** Loads the backend lazily, on the first check, so startup never pays for it. */
  load(events: UpdaterEvents): Promise<Updater>;
  channel: UpdateChannel;
  /** Any window has unsaved changes (the close guards): installing now would interrupt that work. */
  hasUnsavedWork(): boolean;
  onStatus(status: UpdateStatus): void;
  onError(message: string, err: unknown): void;
  firstCheckDelayMs?: number;
  intervalMs?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export class UpdateBlockedError extends Error {
  constructor(public readonly reason: 'not-ready' | 'unsaved-work') {
    super(
      reason === 'unsaved-work'
        ? 'Save your work to restart. The update will install when you quit.'
        : 'No update is ready to install.',
    );
    this.name = 'UpdateBlockedError';
  }
}

const CHECK_FAILED = 'Could not check for updates. Check your internet connection and try again.';

/**
 * Auto-update (FR-GEN-05, docs/08 §3): checks shortly after startup and every 4 hours, downloads in the
 * background, and installs only when nothing is unsaved: "Restart Now" is refused while any window has
 * unsaved changes, and otherwise the update installs on the next normal quit (after the close prompts).
 */
export class UpdateService {
  private status: UpdateStatus;
  private updater: Promise<Updater> | null = null;
  private inFlight: Promise<void> | null = null;
  private channel: UpdateChannel;
  private readonly timers: unknown[] = [];
  private lastError: unknown = null;

  constructor(private readonly opts: UpdateServiceOptions) {
    this.channel = opts.channel;
    this.status =
      opts.availability === 'available'
        ? { state: 'idle', checkedAt: null }
        : { state: 'unavailable', reason: opts.availability };
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  /** Schedules the first check and the periodic ones. */
  start(): void {
    if (this.status.state === 'unavailable') return;
    const setT = this.opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms).unref());
    const setI = this.opts.setInterval ?? ((fn, ms) => setInterval(fn, ms).unref());
    this.timers.push(setT(() => void this.check(), this.opts.firstCheckDelayMs ?? 10_000));
    this.timers.push(setI(() => void this.check(), this.opts.intervalMs ?? 4 * 3600_000));
  }

  stop(): void {
    const clear = this.opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    this.timers.splice(0).forEach(clear);
  }

  /** Checks now. Concurrent calls share one check; nothing is checked once an update is ready. */
  check(): Promise<void> {
    if (this.status.state === 'unavailable' || this.status.state === 'ready') return Promise.resolve();
    // While a found update downloads, the check is over but the download is not: don't start another.
    if (this.status.state === 'downloading') return Promise.resolve();
    this.inFlight ??= this.runCheck().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  /** The user changed Preferences › Updates › Channel: use it from the next check (and check now). */
  setChannel(channel: UpdateChannel): void {
    if (channel === this.channel) return;
    this.channel = channel;
    if (!this.updater) return;
    void this.updater
      .then((u) => u.setChannel(channel))
      .then(
        () => this.check(),
        () => undefined,
      );
  }

  /** Quits and installs the downloaded update; refused while there is unsaved work. */
  async install(): Promise<void> {
    if (this.status.state !== 'ready' || !this.updater) throw new UpdateBlockedError('not-ready');
    if (this.opts.hasUnsavedWork()) {
      this.refreshUnsavedWork();
      throw new UpdateBlockedError('unsaved-work');
    }
    (await this.updater).quitAndInstall();
  }

  /** A window's unsaved state changed or a window closed: updates the "Save your work" hint. */
  refreshUnsavedWork(): void {
    if (this.status.state !== 'ready') return;
    const unsavedWork = this.opts.hasUnsavedWork();
    if (unsavedWork !== this.status.unsavedWork) this.set({ ...this.status, unsavedWork });
  }

  private async runCheck(): Promise<void> {
    this.set({ state: 'checking' });
    try {
      const updater = await this.backend();
      await updater.check();
      // electron-updater reports "nothing new" through an event; a backend that resolves without any
      // event (no update feed) must not leave the status at "checking".
      if (this.status.state === 'checking') this.set({ state: 'idle', checkedAt: this.now() });
    } catch (err) {
      this.fail(err);
    }
  }

  private backend(): Promise<Updater> {
    this.updater ??= this.opts
      .load({
        available: (version) => this.set({ state: 'downloading', version, percent: 0 }),
        notAvailable: () => this.set({ state: 'idle', checkedAt: this.now() }),
        progress: (percent) => {
          if (this.status.state !== 'downloading') return;
          const rounded = Math.max(0, Math.min(100, Math.floor(percent)));
          if (rounded !== this.status.percent) this.set({ ...this.status, percent: rounded });
        },
        downloaded: (version) =>
          this.set({ state: 'ready', version, unsavedWork: this.opts.hasUnsavedWork() }),
        error: (err) => this.fail(err),
      })
      .then((u) => {
        u.setChannel(this.channel);
        return u;
      });
    // A backend that fails to load is retried on the next check.
    this.updater.catch(() => (this.updater = null));
    return this.updater;
  }

  private fail(err: unknown): void {
    // electron-updater both emits 'error' and rejects with the same error: log it once.
    if (err === this.lastError) return;
    this.lastError = err;
    this.opts.onError('Update check or download failed', err);
    // A ready update stays ready: a later failed check does not undo a finished download.
    if (this.status.state !== 'ready') this.set({ state: 'error', message: CHECK_FAILED });
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.opts.onStatus(status);
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }
}
