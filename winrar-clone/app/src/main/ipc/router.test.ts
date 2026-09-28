import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '@shared/ipc-contract';
import { EngineError } from '../engine/errors';
import { HandlerError, registerIpc, type Handlers } from './router';

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function setup(overrides: Partial<Handlers> = {}, trusted = true) {
  const listeners = new Map<string, Listener>();
  const handlers = {
    'app.getInfo': vi.fn(async () => ({
      productName: 'X',
      version: '1',
      sevenZipVersion: '26.03',
      platform: 'linux',
      arch: 'x64',
    })),
    'app.getLaunchFiles': vi.fn(async () => []),
    'dialog.openArchive': vi.fn(async () => null),
    'files.registerDropped': vi.fn(async () => []),
    'archive.open': vi.fn(),
    'archive.list': vi.fn(),
    'archive.close': vi.fn(async () => undefined),
    ...overrides,
  } as unknown as Handlers;
  const onError = vi.fn();
  registerIpc({ handle: (c, l) => listeners.set(c, l) }, handlers, () => trusted, onError);
  const call = (channel: string, arg?: unknown) =>
    listeners.get(channel)!({} as IpcMainInvokeEvent, arg) as Promise<IpcResult<unknown>>;
  return { call, handlers, onError, listeners };
}

describe('registerIpc', () => {
  it('registers every contract channel', () => {
    expect([...setup().listeners.keys()].sort()).toEqual([
      'app.getInfo',
      'app.getLaunchFiles',
      'archive.close',
      'archive.list',
      'archive.open',
      'dialog.openArchive',
      'files.registerDropped',
    ]);
  });

  it('rejects untrusted senders without calling the handler', async () => {
    const { call, handlers } = setup({}, false);
    expect(await call('app.getInfo')).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Untrusted sender.' },
    });
    expect(handlers['app.getInfo']).not.toHaveBeenCalled();
  });

  it('validates requests', async () => {
    const { call, handlers, onError } = setup();
    const res = await call('archive.close', 'not-a-uuid');
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(handlers['archive.close']).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('validates responses', async () => {
    const { call } = setup({ 'dialog.openArchive': async () => ({ bogus: true }) as never });
    expect(await call('dialog.openArchive')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('returns data in an ok envelope', async () => {
    const { call } = setup();
    expect(await call('app.getInfo')).toMatchObject({ ok: true, data: { sevenZipVersion: '26.03' } });
  });

  it('maps engine errors and forwards only safe details', async () => {
    const { call } = setup({
      'archive.close': async () => {
        throw new EngineError('MISSING_VOLUME', 'missing', {
          volume: 'a.part2.rar',
          exitCode: 2,
          binary: '/secret/path',
        });
      },
    });
    expect(await call('archive.close', crypto.randomUUID())).toEqual({
      ok: false,
      error: { code: 'MISSING_VOLUME', message: 'missing', details: { volume: 'a.part2.rar' } },
    });
  });

  it('maps handler errors and hides unexpected ones', async () => {
    const id = crypto.randomUUID();
    const notFound = setup({
      'archive.close': async () => Promise.reject(new HandlerError('NOT_FOUND', 'gone')),
    });
    expect(await notFound.call('archive.close', id)).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'gone' },
    });
    const boom = setup({
      'archive.close': async () => Promise.reject(new Error('stack trace with /home/user')),
    });
    expect(await boom.call('archive.close', id)).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Something went wrong.' },
    });
    expect(boom.onError).toHaveBeenCalled();
  });
});
