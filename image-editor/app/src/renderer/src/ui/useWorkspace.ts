import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings, SettingsPatch } from '@shared/settings';
import type { Workspace } from './workspace';

/**
 * The panel layout (FR-GEN-01): local state so dragging a splitter is smooth, saved to the settings
 * 300 ms after the last change. Changes made elsewhere (settings loaded at startup, another window) win.
 */
export function useWorkspace(settings: Settings, update: (patch: SettingsPatch) => Promise<void>) {
  const saved = settings.workspace;
  const [ws, setWs] = useState<Workspace>(saved);
  const lastSent = useRef<string>(JSON.stringify(saved));
  const timer = useRef(0);

  useEffect(() => {
    const json = JSON.stringify(saved);
    if (json !== lastSent.current) {
      lastSent.current = json;
      setWs(saved);
    }
  }, [saved]);

  const change = useCallback(
    (next: Workspace) => {
      setWs(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        lastSent.current = JSON.stringify(next);
        void update({ workspace: { preset: next.preset, panels: next.panels, width: next.width } });
      }, 300);
    },
    [update],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [ws, change] as const;
}
