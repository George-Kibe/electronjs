import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { MENU_COMMANDS } from '@shared/menu';
import { CloseGuard } from './close-guard';
import { menuTemplate } from './menu';
import { writeAtomic } from './services/atomic-write';
import { FileRefRegistry } from './services/file-refs';

const dir = mkdtempSync(join(tmpdir(), 'ie-main-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('writeAtomic (NFR-REL-01)', () => {
  it('replaces the file and leaves no temp files behind', async () => {
    const target = join(dir, 'a.iep');
    writeFileSync(target, 'old');
    await writeAtomic(target, new TextEncoder().encode('new'));
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the original when the write cannot complete', async () => {
    const target = join(dir, 'missing-folder', 'b.iep');
    await expect(writeAtomic(target, new Uint8Array(1))).rejects.toThrow();
  });
});

describe('FileRefRegistry', () => {
  it('only lets save targets be created in existing folders', () => {
    const refs = new FileRefRegistry();
    expect(refs.registerSaveTarget(join(dir, 'new.png')).displayName).toBe('new.png');
    expect(() => refs.registerSaveTarget(join(dir, 'nope', 'x.png'))).toThrow();
    expect(() => refs.registerSaveTarget(dir)).toThrow(); // a folder is not a file
  });
});

describe('CloseGuard (FR-DOC-11)', () => {
  const setup = () => {
    const ask = vi.fn();
    const actions = { close: vi.fn(), quit: vi.fn() };
    return { guard: new CloseGuard(ask, actions), ask, actions, event: { preventDefault: vi.fn() } };
  };

  it('lets a clean window close', () => {
    const { guard, ask, event } = setup();
    guard.onClose(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('stops closing with unsaved changes, asks the renderer, then closes when allowed', () => {
    const { guard, ask, actions, event } = setup();
    guard.setEdited(true);
    guard.onClose(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(ask).toHaveBeenCalledOnce();
    guard.allowClose();
    expect(actions.close).toHaveBeenCalled();
    expect(actions.quit).not.toHaveBeenCalled();
    const again = { preventDefault: vi.fn() };
    guard.onClose(again); // the real close after allowClose() goes through
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it('resumes quitting after the prompt when the close came from Quit', () => {
    const { guard, actions, event } = setup();
    guard.setEdited(true);
    guard.onBeforeQuit();
    guard.onClose(event);
    guard.allowClose();
    expect(actions.quit).toHaveBeenCalled();
  });
});

describe('menu', () => {
  it('sends every command, shows accelerators without registering them', () => {
    const sent: string[] = [];
    const items = menuTemplate('linux', (id) => sent.push(id)).flatMap((m) =>
      Array.isArray(m.submenu) ? m.submenu : [],
    );
    for (const item of items) (item.click as (() => void) | undefined)?.();
    expect(new Set(sent)).toEqual(new Set(MENU_COMMANDS));
    for (const item of items.filter((i) => i.accelerator && !i.role))
      expect(item.registerAccelerator).toBe(false);
  });

  it('adds the app menu on macOS', () => {
    expect(menuTemplate('darwin', () => undefined)[0]!.label).toBe('ImageEditor');
  });
});
