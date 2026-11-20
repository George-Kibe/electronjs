import { PRODUCT_NAME } from '@shared/constants';
import { describeUpdate } from '../update-text';
import type { Updates } from '../useUpdates';
import { Button } from './Button';

/**
 * Non-modal update notice (FR-GEN-05, docs/08 §3). It never interrupts: "Restart Now" is disabled while
 * any window has unsaved changes, and "Later" leaves the update to install at the next quit.
 */
export function UpdateBanner({ updates, version }: { updates: Updates; version: string }) {
  const { status, visible, installError } = updates;
  if (!visible) return null;
  const { title, detail } = describeUpdate(status, PRODUCT_NAME, version);
  const ready = status.state === 'ready';
  return (
    <section
      role="status"
      aria-label="Software update"
      className="bg-ui-panel border-ui-border fixed right-4 bottom-10 z-40 w-80 rounded border p-3 shadow-lg"
    >
      <p className="font-medium">{title}</p>
      {status.state === 'downloading' && (
        <div className="bg-ui-raised mt-2 h-1 overflow-hidden rounded" aria-hidden>
          <div className="bg-brand h-full" style={{ width: `${status.percent}%` }} />
        </div>
      )}
      {detail && <p className="text-ui-muted mt-1 text-[11px]">{detail}</p>}
      {installError && (
        <p role="alert" className="text-danger mt-1 text-[11px]">
          {installError}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button onClick={updates.dismiss}>{ready ? 'Later' : 'Dismiss'}</Button>
        {ready && (
          <Button
            variant="primary"
            onClick={updates.install}
            disabled={status.unsavedWork}
            title={status.unsavedWork ? 'Save or close documents with unsaved changes first' : undefined}
          >
            Restart Now
          </Button>
        )}
      </div>
    </section>
  );
}
