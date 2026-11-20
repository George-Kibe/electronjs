import { describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@shared/update';
import { fakeUpdater } from './electron-updater';
import { UpdateBlockedError, UpdateService, type Updater, type UpdaterEvents } from './updater';

function setup(opts: { availability?: 'available' | 'development' | 'package-manager' } = {}) {
  let events!: UpdaterEvents;
  let unsaved = false;
  const backend = {
    setChannel: vi.fn(),
    check: vi.fn(async (): Promise<void> => undefined),
    quitAndInstall: vi.fn(),
  } satisfies Updater;
  const load = vi.fn(async (e: UpdaterEvents) => {
    events = e;
    return backend;
  });
  const statuses: UpdateStatus[] = [];
  const timers: Array<{ fn: () => void; ms: number; repeat: boolean }> = [];
  const onError = vi.fn();
  const service = new UpdateService({
    availability: opts.availability ?? 'available',
    load,
    channel: 'latest',
    hasUnsavedWork: () => unsaved,
    onStatus: (s) => statuses.push(s),
    onError,
    now: () => 1000,
    setTimeout: (fn, ms) => timers.push({ fn, ms, repeat: false }),
    setInterval: (fn, ms) => timers.push({ fn, ms, repeat: true }),
    clearTimer: () => undefined,
  });
  return {
    service,
    backend,
    load,
    statuses,
    timers,
    onError,
    events: () => events,
    setUnsaved: (v: boolean) => (unsaved = v),
  };
}

describe('UpdateService (FR-GEN-05)', () => {
  it('checks 10 s after start and every 4 hours, loading the backend only then', async () => {
    const t = setup();
    t.service.start();
    expect(t.timers.map((x) => [x.ms, x.repeat])).toEqual([
      [10_000, false],
      [4 * 3600_000, true],
    ]);
    expect(t.load).not.toHaveBeenCalled();
    t.timers[0]!.fn();
    await vi.waitFor(() => expect(t.backend.check).toHaveBeenCalledOnce());
    expect(t.backend.setChannel).toHaveBeenCalledWith('latest');
    // A backend that resolves without an event leaves "up to date", not "checking".
    expect(t.service.getStatus()).toEqual({ state: 'idle', checkedAt: 1000 });
  });

  it('development and package-manager installs never check', async () => {
    for (const reason of ['development', 'package-manager'] as const) {
      const t = setup({ availability: reason });
      t.service.start();
      await t.service.check();
      expect(t.timers).toHaveLength(0);
      expect(t.load).not.toHaveBeenCalled();
      expect(t.service.getStatus()).toEqual({ state: 'unavailable', reason });
    }
  });

  it('downloads in the background and becomes ready', async () => {
    const t = setup();
    t.backend.check.mockImplementation(async () => {
      t.events().available('0.2.0');
    });
    await t.service.check();
    t.events().progress(12.7);
    t.events().progress(12.9); // same whole percent: no new status
    t.events().progress(100);
    t.events().downloaded('0.2.0');
    expect(t.statuses).toEqual([
      { state: 'checking' },
      { state: 'downloading', version: '0.2.0', percent: 0 },
      { state: 'downloading', version: '0.2.0', percent: 12 },
      { state: 'downloading', version: '0.2.0', percent: 100 },
      { state: 'ready', version: '0.2.0', unsavedWork: false },
    ]);
    // Ready: no more checks (the download would start over).
    await t.service.check();
    expect(t.backend.check).toHaveBeenCalledOnce();
  });

  it('never installs over unsaved work; the hint follows the windows', async () => {
    const t = setup();
    await t.service.check();
    t.events().downloaded('0.2.0');
    t.setUnsaved(true);
    t.service.refreshUnsavedWork();
    expect(t.service.getStatus()).toEqual({ state: 'ready', version: '0.2.0', unsavedWork: true });
    await expect(t.service.install()).rejects.toEqual(new UpdateBlockedError('unsaved-work'));
    expect(t.backend.quitAndInstall).not.toHaveBeenCalled();

    t.setUnsaved(false);
    t.service.refreshUnsavedWork();
    expect(t.service.getStatus()).toMatchObject({ unsavedWork: false });
    await t.service.install();
    expect(t.backend.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('refuses to install when nothing is ready', async () => {
    const t = setup();
    await expect(t.service.install()).rejects.toEqual(new UpdateBlockedError('not-ready'));
  });

  it('shares one check between concurrent callers', async () => {
    const t = setup();
    let finish!: () => void;
    t.backend.check.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const a = t.service.check();
    const b = t.service.check();
    await vi.waitFor(() => expect(t.backend.check).toHaveBeenCalledOnce());
    finish();
    await Promise.all([a, b]);
    expect(t.backend.check).toHaveBeenCalledOnce();
  });

  it('reports failures without raw details and retries on the next check', async () => {
    const t = setup();
    t.backend.check.mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED at /home/alice'));
    await t.service.check();
    expect(t.service.getStatus()).toEqual({
      state: 'error',
      message: 'Could not check for updates. Check your internet connection and try again.',
    });
    expect(t.onError).toHaveBeenCalledOnce();
    // The same failure reported as an event and as a rejection is logged once.
    const err = new Error('both ways');
    t.backend.check.mockImplementationOnce(async () => {
      t.events().error(err);
      throw err;
    });
    await t.service.check();
    expect(t.onError).toHaveBeenCalledTimes(2);
    await t.service.check();
    expect(t.service.getStatus()).toEqual({ state: 'idle', checkedAt: 1000 });
  });

  it('a failure after the download keeps the ready update', async () => {
    const t = setup();
    await t.service.check();
    t.events().downloaded('0.2.0');
    t.events().error(new Error('later'));
    expect(t.service.getStatus()).toMatchObject({ state: 'ready' });
  });

  it('a backend that fails to load is loaded again on the next check', async () => {
    const t = setup();
    t.load.mockRejectedValueOnce(new Error('missing app-update.yml'));
    await t.service.check();
    expect(t.service.getStatus()).toMatchObject({ state: 'error' });
    await t.service.check();
    expect(t.load).toHaveBeenCalledTimes(2);
    expect(t.service.getStatus()).toMatchObject({ state: 'idle' });
  });

  it('a channel change applies to the backend and checks again', async () => {
    const t = setup();
    t.service.setChannel('beta'); // before the backend loads: used when it does
    await t.service.check();
    expect(t.backend.setChannel).toHaveBeenLastCalledWith('beta');
    t.service.setChannel('latest');
    await vi.waitFor(() => expect(t.backend.check).toHaveBeenCalledTimes(2));
    expect(t.backend.setChannel).toHaveBeenLastCalledWith('latest');
  });
});

describe('fakeUpdater (E2E feed)', () => {
  it('scripts a full download and an install that quits', async () => {
    const statuses: UpdateStatus[] = [];
    const quit = vi.fn();
    const markInstalled = vi.fn();
    const service = new UpdateService({
      availability: 'available',
      load: async (events) => fakeUpdater('9.9.9', events, { quit, markInstalled }),
      channel: 'latest',
      hasUnsavedWork: () => false,
      onStatus: (s) => statuses.push(s),
      onError: () => undefined,
    });
    await service.check();
    await vi.waitFor(() => expect(service.getStatus()).toMatchObject({ state: 'ready', version: '9.9.9' }));
    await service.install();
    expect(markInstalled).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("'none' is up to date and 'error' fails", async () => {
    for (const [script, state] of [
      ['none', 'idle'],
      ['error', 'error'],
    ] as const) {
      const service = new UpdateService({
        availability: 'available',
        load: async (events) => fakeUpdater(script, events, { quit: vi.fn(), markInstalled: vi.fn() }),
        channel: 'latest',
        hasUnsavedWork: () => false,
        onStatus: () => undefined,
        onError: () => undefined,
      });
      await service.check();
      expect(service.getStatus().state).toBe(state);
    }
  });
});
