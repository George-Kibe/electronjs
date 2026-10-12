import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { writeAtomic } from './atomic-write';
import { migrate, SettingsStore } from './settings-store';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ie-settings-'));
  dirs.push(dir);
  return join(dir, 'settings.json');
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('SettingsStore (docs/05 §3)', () => {
  it('starts with defaults, saves updates atomically and reloads them', async () => {
    const path = tmp();
    const store = new SettingsStore({ path, writeAtomic });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    const seen = vi.fn();
    store.onChange(seen);
    await store.update({ general: { theme: 'light' }, performance: { historySteps: 250 } });
    expect(seen).toHaveBeenCalledOnce();
    const again = new SettingsStore({ path, writeAtomic });
    expect(again.get().general.theme).toBe('light');
    expect(again.get().performance.historySteps).toBe(250);
    expect(JSON.parse(readFileSync(path, 'utf8')).schemaVersion).toBe(1);
  });

  it('rejects an invalid patch and keeps the previous settings', async () => {
    const store = new SettingsStore({ path: tmp(), writeAtomic });
    await expect(store.update({ general: { interfaceScale: 9 } })).rejects.toThrow();
    expect(store.get().general.interfaceScale).toBe(1);
  });

  it('sets a damaged file aside and starts with defaults', () => {
    const path = tmp();
    writeFileSync(path, '{ not json');
    const onWarning = vi.fn();
    const store = new SettingsStore({ path, writeAtomic, onWarning });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(onWarning).toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(join(path, '..')).some((f) => f.startsWith('settings.json.damaged-'))).toBe(true);
  });

  it('treats out-of-range values in the file as damage, not as a crash', () => {
    const path = tmp();
    writeFileSync(path, JSON.stringify({ general: { interfaceScale: 40 } }));
    expect(new SettingsStore({ path, writeAtomic }).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps unknown fields from newer versions when saving', async () => {
    const path = tmp();
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, general: { theme: 'light', future: 'x' }, later: { a: 1 } }),
    );
    const store = new SettingsStore({ path, writeAtomic });
    await store.update({ files: { autosaveMinutes: 5 } });
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    expect(saved.general.future).toBe('x');
    expect(saved.later).toEqual({ a: 1 });
  });

  it('migrate stamps the current version on files without one', () => {
    expect(migrate({}).schemaVersion).toBe(1);
  });
});
