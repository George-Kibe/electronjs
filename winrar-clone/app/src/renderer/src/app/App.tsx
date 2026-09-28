import { useEffect, useState } from 'react';
import type { ArchiveInfo, FileRef } from '@shared/schemas';
import { ArchiveBrowser } from '../features/browser/ArchiveBrowser';
import { PasswordDialog } from '../features/browser/PasswordDialog';
import { Home } from '../features/home/Home';
import { api, errorMessage } from '../lib/api';

type View =
  | { kind: 'home' }
  | { kind: 'opening'; ref: FileRef }
  | { kind: 'password'; ref: FileRef; wrongPassword: boolean; busy: boolean }
  | { kind: 'browser'; sessionId: string; archive: FileRef; info: ArchiveInfo };

export function App() {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [error, setError] = useState<string | null>(null);

  const open = async (ref: FileRef, password?: string) => {
    setError(null);
    setView(
      password === undefined
        ? { kind: 'opening', ref }
        : { kind: 'password', ref, wrongPassword: false, busy: true },
    );
    try {
      const result = await api.archive.open({ archive: ref, password });
      if (result.status === 'opened') {
        setView({ kind: 'browser', sessionId: result.sessionId, archive: result.archive, info: result.info });
      } else {
        setView({ kind: 'password', ref, wrongPassword: result.wrongPassword, busy: false });
      }
    } catch (err) {
      setError(errorMessage(err));
      setView({ kind: 'home' });
    }
  };

  // Open an archive passed on the command line or via file association (FR-BRW-01).
  useEffect(() => {
    api.app.getLaunchFiles().then(
      ([first]) => first && void open(first),
      () => undefined,
    );
  }, []);

  const close = () => {
    if (view.kind === 'browser') void api.archive.close(view.sessionId);
    setView({ kind: 'home' });
  };

  return (
    <>
      {view.kind === 'browser' ? (
        <ArchiveBrowser sessionId={view.sessionId} archive={view.archive} info={view.info} onClose={close} />
      ) : (
        <Home onOpen={(ref) => void open(ref)} />
      )}
      {view.kind === 'opening' && (
        <div
          role="status"
          className="bg-panel border-border fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border px-4 py-2 shadow"
        >
          Opening {view.ref.displayName}…
        </div>
      )}
      {view.kind === 'password' && (
        <PasswordDialog
          archiveName={view.ref.displayName}
          wrongPassword={view.wrongPassword}
          busy={view.busy}
          onSubmit={(pw) => void open(view.ref, pw)}
          onCancel={() => setView({ kind: 'home' })}
        />
      )}
      {error && (
        <div
          role="alert"
          className="bg-panel border-danger text-danger fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border px-4 py-2 shadow"
        >
          {error}
        </div>
      )}
    </>
  );
}
