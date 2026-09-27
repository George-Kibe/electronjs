import { useState, type DragEvent } from 'react';
import { PRODUCT_NAME } from '@shared/constants';
import type { FileRef } from '@shared/schemas';
import { Button } from '../../components/ui/Button';
import { api, errorMessage } from '../../lib/api';

type Props = { onOpen: (ref: FileRef) => void };

export function Home({ onOpen }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = async () => {
    setError(null);
    try {
      const ref = await api.dialog.openArchive();
      if (ref) onOpen(ref);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    setError(null);
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    try {
      const [first] = await api.files.registerDropped(files);
      if (first) onOpen(first);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <main className="flex h-full items-center justify-center p-8">
      <section
        aria-label="Drop an archive to open it"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
          dragging ? 'border-brand bg-brand/10' : 'border-border bg-panel'
        }`}
      >
        <h1 className="text-lg font-semibold">{PRODUCT_NAME}</h1>
        <p className="text-muted">Drop an archive here, or open one to browse its contents.</p>
        <p className="text-muted text-xs">RAR · ZIP · 7z · TAR · GZ · XZ · ISO · CAB and more</p>
        <Button variant="primary" onClick={openDialog}>
          Open archive…
        </Button>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
