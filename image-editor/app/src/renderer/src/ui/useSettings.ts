import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, memoryBudgetBytes, Settings, type SettingsPatch } from '@shared/settings';
import type { Editor } from '../engine/editor';
import { api, errorMessage, events } from '../lib/api';

/** Neutral greys around the canvas per theme (FR-GEN-02). */
const SURROUND = { dark: [0x3a, 0x3a, 0x3a], light: [0xc8, 0xc8, 0xca] } as const;

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * User settings (FR-GEN-02/04): loaded from main, kept in sync with 'settings.changed', and applied to the
 * page (theme) and the editor (history limits, memory budget, canvas colour).
 */
export function useSettings(editor: Editor | null, totalMemoryBytes: number) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [systemDark, setSystemDark] = useState(prefersDark);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.settings.get().then(setSettings, (err) => setError(errorMessage(err)));
    return events.onSettingsChanged((s) => {
      const parsed = Settings.safeParse(s);
      if (parsed.success) setSettings(parsed.data);
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme =
    settings.general.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.general.theme;

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(() => {
    if (!editor) return;
    editor.setHistoryLimit(settings.performance.historySteps);
    editor.setMemoryBudget(memoryBudgetBytes(settings, totalMemoryBytes));
    const custom = settings.general.canvasColor;
    editor.setCanvasColor(
      custom
        ? ([1, 3, 5].map((i) => parseInt(custom.slice(i, i + 2), 16)) as [number, number, number])
        : [...SURROUND[theme]],
    );
  }, [editor, settings, theme, totalMemoryBytes]);

  const update = useCallback(async (patch: SettingsPatch) => {
    try {
      setSettings(await api.settings.update(patch));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  return { settings, theme, update, error, dismissError: () => setError(null) };
}
