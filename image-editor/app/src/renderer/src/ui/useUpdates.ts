import { useCallback, useEffect, useState } from 'react';
import { UpdateStatus } from '@shared/update';
import { api, errorMessage, events } from '../lib/api';

/**
 * Auto-update state for this window (FR-GEN-05). Background checks stay silent until an update is ready;
 * a check the user asked for (Help › Check for Updates, Preferences) shows every step.
 */
export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle', checkedAt: null });
  /** The user asked for a check: show progress and "up to date", not only a ready update. */
  const [manual, setManual] = useState(false);
  /** "Later" hides the banner for this version (in this window). */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    api.update.getStatus().then(setStatus, () => undefined);
    return events.onUpdateStatus((s) => {
      const parsed = UpdateStatus.safeParse(s);
      if (parsed.success) setStatus(parsed.data);
    });
  }, []);

  // "Up to date" is confirmation enough; it goes away by itself.
  useEffect(() => {
    if (!manual || status.state !== 'idle') return;
    const timer = window.setTimeout(() => setManual(false), 6000);
    return () => window.clearTimeout(timer);
  }, [manual, status]);

  const check = useCallback(() => {
    setManual(true);
    setDismissed(null);
    setInstallError(null);
    // Show "Checking…" at once (the status from main follows) instead of the previous "up to date".
    setStatus((s) => (s.state === 'idle' || s.state === 'error' ? { state: 'checking' } : s));
    api.update.check().catch((err) => setInstallError(errorMessage(err)));
  }, []);

  const install = useCallback(() => {
    setInstallError(null);
    api.update.install().catch((err) => setInstallError(errorMessage(err)));
  }, []);

  const dismiss = useCallback(() => {
    setManual(false);
    setInstallError(null);
    if (status.state === 'ready') setDismissed(status.version);
  }, [status]);

  const visible =
    (status.state === 'ready' && status.version !== dismissed) || manual || installError !== null;
  return { status, visible, check, install, dismiss, installError };
}

export type Updates = ReturnType<typeof useUpdates>;
