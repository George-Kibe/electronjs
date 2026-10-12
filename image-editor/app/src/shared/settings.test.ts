import { describe, expect, it } from 'vitest';
import { applyPatch, DEFAULT_SETTINGS, memoryBudgetBytes, Settings } from './settings';

describe('settings schema (docs/05 §3)', () => {
  it('fills every default from an empty or partial file', () => {
    expect(Settings.parse({})).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.general.theme).toBe('dark');
    expect(DEFAULT_SETTINGS.performance.historySteps).toBe(100);
    expect(DEFAULT_SETTINGS.files.autosaveMinutes).toBe(2);
    expect(DEFAULT_SETTINGS.privacy.crashReports).toBe(false);
    expect(Settings.parse({ general: { theme: 'light' } }).general.interfaceScale).toBe(1);
  });

  it('a patch changes only the fields it names', () => {
    const custom = applyPatch(DEFAULT_SETTINGS, {
      general: { interfaceScale: 1.25, brushCursor: 'precise' },
    });
    const next = applyPatch(custom, { general: { theme: 'light' } });
    expect(next.general).toMatchObject({ theme: 'light', interfaceScale: 1.25, brushCursor: 'precise' });
    expect(next.performance).toEqual(DEFAULT_SETTINGS.performance);
  });

  it('rejects out-of-range values and unknown sections in patches', () => {
    expect(() => applyPatch(DEFAULT_SETTINGS, { performance: { historySteps: 5 } })).toThrow();
    expect(() => applyPatch(DEFAULT_SETTINGS, { general: { canvasColor: 'red' } })).toThrow();
    expect(() => applyPatch(DEFAULT_SETTINGS, { evil: {} } as never)).toThrow();
  });

  it('keeps fields written by a newer version', () => {
    const s = Settings.parse({ general: { theme: 'light', futureThing: 3 }, futureSection: { a: 1 } });
    expect(s).toMatchObject({ general: { futureThing: 3 }, futureSection: { a: 1 } });
    expect(applyPatch(s, { general: { theme: 'dark' } }).general).toMatchObject({ futureThing: 3 });
  });

  it('memory budget: the setting, or a quarter of RAM within 1–8 GB', () => {
    const GB = 1024 ** 3;
    expect(memoryBudgetBytes(DEFAULT_SETTINGS, 16 * GB)).toBe(4 * GB);
    expect(memoryBudgetBytes(DEFAULT_SETTINGS, 2 * GB)).toBe(GB);
    expect(memoryBudgetBytes(DEFAULT_SETTINGS, 64 * GB)).toBe(8 * GB);
    expect(
      memoryBudgetBytes(applyPatch(DEFAULT_SETTINGS, { performance: { memoryBudgetMB: 1024 } }), 16 * GB),
    ).toBe(GB);
  });
});
