import type { CrashReportInput } from '@shared/update';

/**
 * Forwards uncaught errors in this window to main for an opt-in crash report (FR-GEN-07, ADR-0009). Only
 * the error's name, message and stack leave the page, never its state. Main scrubs them and drops them
 * unless the user turned crash reports on. React 19 reports render errors through window 'error' too.
 */
export function installCrashCapture(
  report: (r: CrashReportInput) => Promise<unknown>,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  // An error in a render loop must not flood IPC; main also caps reports per session.
  let budget = 20;
  const send = (kind: CrashReportInput['kind'], value: unknown) => {
    if (budget <= 0) return;
    budget--;
    const err = value instanceof Error ? value : null;
    const message = err ? err.message : typeof value === 'string' ? value : 'A non-error value was thrown';
    void report({
      kind,
      name: (err?.name ?? 'Error').slice(0, 200),
      message: message.slice(0, 4000),
      stack: err?.stack?.slice(0, 20_000) ?? null,
    }).catch(() => undefined);
  };
  const onError = (e: Event) => send('error', (e as ErrorEvent).error ?? (e as ErrorEvent).message);
  const onRejection = (e: Event) => send('unhandledrejection', (e as PromiseRejectionEvent).reason);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
