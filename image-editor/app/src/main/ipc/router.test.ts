import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '@shared/ipc-contract';
import { HandlerError, registerIpc, type Handlers } from './router';

function setup(overrides: Partial<Handlers> = {}, trusted = true) {
  const listeners = new Map<string, (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown>();
  const handlers = {
    'app.getInfo': vi.fn(() => ({ productName: 'X', version: '1', platform: 'linux', arch: 'x64' })),
    'app.getLaunchFiles': vi.fn(() => []),
    'dialog.openImage': vi.fn(() => null),
    'files.registerDropped': vi.fn(() => []),
    'codec.decode': vi.fn(() => ({ requestId: crypto.randomUUID() })),
    ...overrides,
  } as unknown as Handlers;
  const onError = vi.fn();
  registerIpc({ handle: (c, l) => listeners.set(c, l) }, handlers, () => trusted, onError);
  const call = (channel: string, arg?: unknown) =>
    listeners.get(channel)!({} as IpcMainInvokeEvent, arg) as Promise<IpcResult<unknown>>;
  return { call, handlers, onError, listeners };
}

describe('registerIpc', () => {
  it('registers every channel', () => {
    expect([...setup().listeners.keys()].sort()).toEqual([
      'app.closeWindow',
      'app.getInfo',
      'app.getLaunchFiles',
      'app.setDocumentEdited',
      'codec.decode',
      'codec.encode',
      'dialog.openImage',
      'dialog.saveAs',
      'file.readBytes',
      'file.writeAtomic',
      'files.registerDropped',
    ]);
  });

  it('rejects untrusted senders', async () => {
    const { call, handlers } = setup({}, false);
    expect(await call('app.getInfo')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(handlers['app.getInfo']).not.toHaveBeenCalled();
  });

  it('validates requests and responses', async () => {
    const { call, handlers } = setup({ 'dialog.openImage': (() => ({ bogus: 1 })) as never });
    expect(await call('codec.decode', { id: 'not-a-uuid' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(handlers['codec.decode']).not.toHaveBeenCalled();
    expect(await call('dialog.openImage')).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('passes handler errors through and hides unexpected ones', async () => {
    const notFound = setup({
      'codec.decode': () => {
        throw new HandlerError('NOT_FOUND', 'gone');
      },
    });
    expect(await notFound.call('codec.decode', { id: crypto.randomUUID() })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'gone' },
    });
    const boom = setup({
      'app.getInfo': () => {
        throw new Error('/home/user/secret stack');
      },
    });
    expect(await boom.call('app.getInfo')).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Something went wrong.' },
    });
    expect(boom.onError).toHaveBeenCalled();
  });
});
