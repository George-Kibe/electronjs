import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { writeAtomic } from '../services/atomic-write';
import { FileRefRegistry } from '../services/file-refs';
import { createHandlers, type HandlerDeps } from './handlers';

const dir = mkdtempSync(join(tmpdir(), 'ie-handlers-'));
const image = join(dir, 'photo.jpg');
const project = join(dir, 'art.iep');
writeFileSync(image, 'x');
writeFileSync(project, 'project-bytes');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function setup(over: Partial<HandlerDeps> = {}, launchPaths: string[] = []) {
  const refs = new FileRefRegistry();
  const codec = { decode: vi.fn(() => 'req-1'), encode: vi.fn(() => 'req-2') };
  const dialog = {
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [image] })),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: join(dir, 'out') })),
  };
  const deps: HandlerDeps = {
    refs,
    dialog,
    window: () => null,
    codec,
    writeAtomic,
    appInfo: { productName: 'ImageEditor', version: '0.1.0', platform: 'linux', arch: 'x64' },
    launchPaths,
    defaultDir: dir,
    setDocumentEdited: vi.fn(),
    closeWindow: vi.fn(),
    ...over,
  };
  return { refs, codec, dialog, deps, handlers: createHandlers(deps), event: { sender: { id: 1 } } as never };
}

describe('IPC handlers', () => {
  it('hands out command-line files once and skips directories', async () => {
    const { handlers, event } = setup({}, [image, dir]);
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

  it('adds the right extension in save dialogs and remembers the folder', async () => {
    const { handlers, dialog, event } = setup();
    const png = (await handlers['dialog.saveAs']({ suggestedName: 'Holiday.png', kind: 'png' }, event))!;
    expect(png.displayName).toBe('out.png');
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: join(dir, 'Holiday.png'),
        filters: [{ name: 'PNG', extensions: ['png'] }],
      }),
    );
    const iep = (await handlers['dialog.saveAs']({ suggestedName: 'a/b', kind: 'project' }, event))!;
    expect(iep.displayName).toBe('out.iep');
    expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: join(dir, 'a_b.iep') }),
    );
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' });
    expect(await handlers['dialog.saveAs']({ suggestedName: 'x', kind: 'jpeg' }, event)).toBeNull();
  });

  it('writes only to refs from a save dialog or an opened project (docs/06 §4)', async () => {
    const { handlers, refs, event } = setup();
    const opened = refs.register(image); // an opened JPEG is not writable
    await expect(
      handlers['file.writeAtomic']({ ref: opened, data: new Uint8Array([1]) }, event),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(readFileSync(image, 'utf8')).toBe('x');

    const target = (await handlers['dialog.saveAs']({ suggestedName: 'x', kind: 'project' }, event))!;
    await handlers['file.writeAtomic']({ ref: target, data: new TextEncoder().encode('saved') }, event);
    expect(readFileSync(join(dir, 'out.iep'), 'utf8')).toBe('saved');

    const openedProject = refs.register(project); // "Save" overwrites the project it came from
    await handlers['file.writeAtomic']({ ref: openedProject, data: new TextEncoder().encode('v2') }, event);
    expect(readFileSync(project, 'utf8')).toBe('v2');
  });

  it('reports write failures without touching the original', async () => {
    const failing = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { code: 'ENOSPC' });
    });
    const { handlers, refs, event } = setup({ writeAtomic: failing });
    const ref = refs.register(project);
    await expect(handlers['file.writeAtomic']({ ref, data: new Uint8Array(1) }, event)).rejects.toMatchObject(
      {
        code: 'WRITE_FAILED',
        message: expect.stringMatching(/disk is full/),
      },
    );
  });

  it('reads the bytes of chosen files only', async () => {
    const { handlers, refs, event } = setup();
    const ref = refs.register(project);
    expect(new TextDecoder().decode(await handlers['file.readBytes'](ref, event))).toBe(
      readFileSync(project, 'utf8'),
    );
    await expect(handlers['file.readBytes']({ id: crypto.randomUUID() }, event)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('opens encode sessions for the calling window', async () => {
    const { handlers, codec, event } = setup();
    expect(await handlers['codec.encode'](undefined, event)).toEqual({ requestId: 'req-2' });
    expect(codec.encode).toHaveBeenCalledWith((event as { sender: unknown }).sender);
  });

  it('forwards the unsaved-changes state and close confirmation to main', async () => {
    const { handlers, deps, event } = setup();
    await handlers['app.setDocumentEdited'](true, event);
    await handlers['app.closeWindow'](undefined, event);
    expect(deps.setDocumentEdited).toHaveBeenCalledWith(true);
    expect(deps.closeWindow).toHaveBeenCalled();
  });
});
