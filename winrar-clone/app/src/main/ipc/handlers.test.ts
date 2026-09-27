import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { binary, hasBinary, rarFixtures } from '../../../test/helpers/seven-zip';
import { SessionStore } from '../archive/sessions';
import { SevenZipEngine } from '../engine/engine';
import { FileRefRegistry } from '../services/file-refs';
import { createHandlers } from './handlers';

function setup() {
  const refs = new FileRefRegistry();
  const handlers = createHandlers({
    engine: new SevenZipEngine(binary),
    refs,
    sessions: new SessionStore(),
    dialog: { showOpenDialog: vi.fn() },
    window: () => null,
    appInfo: { productName: 'WinrarClone', version: '0.1.0', platform: 'linux', arch: 'x64' },
    launchPaths: [join(rarFixtures, 'rar4-basic.rar')],
  });
  return { refs, handlers, event: {} as never };
}

describe.skipIf(!hasBinary)('IPC handlers (real engine)', () => {
  it('opens a middle volume, returns a ref to the first one and pages the listing', async () => {
    const { refs, handlers, event } = setup();
    const ref = refs.register(join(rarFixtures, 'rar5-multi-solid.part02.rar'));
    const opened = await handlers['archive.open']({ archive: ref }, event);
    if (opened.status !== 'opened') throw new Error('expected opened');
    expect(opened.archive.displayName).toBe('rar5-multi-solid.part01.rar');
    expect(opened.info).toMatchObject({ format: 'Rar5', volumes: 4, multivolume: true });
    const page = await handlers['archive.list'](
      { sessionId: opened.sessionId, folder: '', sort: { key: 'name', dir: 'asc' }, offset: 0, limit: 3 },
      event,
    );
    expect(page.total).toBe(9);
    expect(page.entries).toHaveLength(3);
    await handlers['archive.close'](opened.sessionId, event);
    await expect(
      handlers['archive.list'](
        { sessionId: opened.sessionId, folder: '', sort: { key: 'name', dir: 'asc' }, offset: 0, limit: 3 },
        event,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('hands out command-line files once', async () => {
    const { handlers, event } = setup();
    expect((await handlers['app.getLaunchFiles'](undefined, event)).map((r) => r.displayName)).toEqual([
      'rar4-basic.rar',
    ]);
    expect(await handlers['app.getLaunchFiles'](undefined, event)).toEqual([]);
  });

  it('reports unknown refs as NOT_FOUND', async () => {
    const { handlers, event } = setup();
    await expect(
      handlers['archive.open'](
        { archive: { id: crypto.randomUUID(), displayName: 'x', displayDir: '/', kind: 'file' } },
        event,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports the app and engine versions', async () => {
    const { handlers, event } = setup();
    expect(await handlers['app.getInfo'](undefined, event)).toMatchObject({
      productName: 'WinrarClone',
      sevenZipVersion: '26.03',
    });
  });

  it('ignores dropped paths that do not exist', async () => {
    const { handlers, event } = setup();
    const refs = await handlers['files.registerDropped'](
      [join(rarFixtures, 'rar4-basic.rar'), '/does/not/exist'],
      event,
    );
    expect(refs.map((r) => r.displayName)).toEqual(['rar4-basic.rar']);
  });
});
