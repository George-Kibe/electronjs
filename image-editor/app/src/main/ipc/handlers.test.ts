import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FileRefRegistry } from '../services/file-refs';
import { createHandlers } from './handlers';

const dir = mkdtempSync(join(tmpdir(), 'ie-handlers-'));
const image = join(dir, 'photo.jpg');
writeFileSync(image, 'x');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function setup(launchPaths: string[] = []) {
  const refs = new FileRefRegistry();
  const codec = { decode: vi.fn(() => 'req-1') };
  const handlers = createHandlers({
    refs,
    dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [image] })) },
    window: () => null,
    codec,
    appInfo: { productName: 'ImageEditor', version: '0.1.0', platform: 'linux', arch: 'x64' },
    launchPaths,
  });
  return { refs, codec, handlers, event: { sender: { id: 1 } } as never };
}

describe('IPC handlers', () => {
  it('hands out command-line files once and skips directories', async () => {
    const { handlers, event } = setup([image, dir]);
    expect((await handlers['app.getLaunchFiles'](undefined, event)).map((r) => r.displayName)).toEqual([
      'photo.jpg',
    ]);
    expect(await handlers['app.getLaunchFiles'](undefined, event)).toEqual([]);
  });

  it('decodes only files the user chose, via their ref', async () => {
    const { handlers, codec, event } = setup();
    const ref = (await handlers['dialog.openImage'](undefined, event))!;
    expect(await handlers['codec.decode']({ id: ref.id }, event)).toEqual({ requestId: 'req-1' });
    expect(codec.decode).toHaveBeenCalledWith(image, (event as { sender: unknown }).sender);
    expect(() => handlers['codec.decode']({ id: crypto.randomUUID() }, event)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});
