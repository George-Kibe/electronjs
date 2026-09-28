import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type DragEvent } from 'react';
import type { FileRef } from '@shared/schemas';
import { Editor, type EditorSnapshot } from '../engine/editor';
import { api, errorMessage } from '../lib/api';
import { decodeImage } from '../lib/codec';
import { Button } from './components/Button';
import { HistoryPanel } from './components/HistoryPanel';
import { LayersPanel } from './components/LayersPanel';
import { OptionsBar } from './components/OptionsBar';
import { ToolBar } from './components/ToolBar';
import { Welcome } from './components/Welcome';
import { useShortcuts } from './useShortcuts';

const noSubscribe = () => () => undefined;

export function App() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [initialLabel, setInitialLabel] = useState('New');

  // Callback ref with cleanup (React 19): the engine owns the canvas for the component's lifetime.
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    try {
      const instance = new Editor(canvas);
      setEditor(instance);
      return () => {
        instance.dispose();
        setEditor(null);
      };
    } catch (err) {
      setFatal(errorMessage(err));
    }
  }, []);

  const snap: EditorSnapshot | null = useSyncExternalStore(
    editor?.subscribe ?? noSubscribe,
    editor?.getSnapshot ?? (() => null),
  );

  const openRef = useCallback(
    async (ref: FileRef) => {
      if (!editor) return;
      setError(null);
      setBusy(`Opening ${ref.displayName}…`);
      try {
        const { header, rgba } = await decodeImage(ref);
        editor.loadImage(header.width, header.height, rgba, ref.displayName, header.sourceProfile);
        setInitialLabel('Open');
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [editor],
  );

  const openDialog = useCallback(async () => {
    try {
      const ref = await api.dialog.openImage();
      if (ref) await openRef(ref);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [openRef]);

  // Files passed on the command line / via file association (FR-DOC-02).
  useEffect(() => {
    if (!editor) return;
    api.app.getLaunchFiles().then(
      ([first]) => first && void openRef(first),
      () => undefined,
    );
  }, [editor, openRef]);

  const actions = useMemo(() => ({ open: () => void openDialog() }), [openDialog]);
  useShortcuts(editor, actions);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    try {
      const [first] = await api.files.registerDropped(files);
      if (first) await openRef(first);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (fatal) {
    return (
      <main role="alert" className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <h1 className="mb-2 text-base font-semibold">Hardware acceleration is unavailable</h1>
          <p className="text-ui-muted">{fatal}</p>
        </div>
      </main>
    );
  }

  const hasDoc = Boolean(snap?.doc);
  return (
    <div className="flex h-full flex-col" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="bg-ui-panel border-ui-border flex h-9 items-center gap-1 border-b px-2">
        <Button onClick={() => void openDialog()} title="Open (Ctrl+O)">
          Open…
        </Button>
        <Button onClick={() => editor?.undo()} disabled={!snap?.history.canUndo} title="Undo (Ctrl+Z)">
          Undo
        </Button>
        <Button onClick={() => editor?.redo()} disabled={!snap?.history.canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </Button>
        <span className="text-ui-muted ml-3 truncate">{snap?.doc?.name ?? ''}</span>
      </header>
      {snap && hasDoc && (
        <OptionsBar
          tool={snap.tool}
          brush={snap.brush}
          zoom={snap.zoom}
          onBrush={(patch) => editor?.setBrush(patch)}
          onFit={() => editor?.fitToScreen()}
          onActualSize={() => editor?.zoomTo(1)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {snap && hasDoc && <ToolBar tool={snap.tool} onSelect={(t) => editor?.setTool(t)} />}
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={attachCanvas}
            aria-label={snap?.doc ? `Canvas, ${snap.doc.width} by ${snap.doc.height} pixels` : 'Canvas'}
            role="img"
            className={`block h-full w-full ${snap?.tool === 'hand' ? 'cursor-grab' : 'cursor-crosshair'}`}
            style={{ touchAction: 'none' }}
          />
          {!hasDoc && (
            <Welcome onNew={(w, h) => editor?.newDocument(w, h)} onOpen={() => void openDialog()} />
          )}
        </div>
        {snap && hasDoc && (
          <aside aria-label="Panels" className="bg-ui-panel border-ui-border flex w-60 flex-col border-l">
            <LayersPanel
              layers={snap.layers}
              activeLayerId={snap.activeLayerId}
              onSelect={(id) => editor?.setActiveLayer(id)}
              onVisible={(id, v) => editor?.setLayerVisible(id, v)}
              onOpacity={(id, o) => editor?.setLayerOpacity(id, o)}
              onOpacityDone={() => editor?.endCoalesce()}
              onAdd={() => editor?.addLayer()}
              onDelete={() => editor?.deleteActiveLayer()}
            />
            <HistoryPanel
              history={snap.history}
              initialLabel={initialLabel}
              onGoTo={(i) => editor?.goToHistory(i)}
            />
          </aside>
        )}
      </div>
      <footer
        role="status"
        className="bg-ui-panel border-ui-border text-ui-muted flex h-6 items-center gap-4 border-t px-3 tabular-nums"
      >
        {snap?.doc ? (
          <>
            <span>{Math.round(snap.zoom * 1000) / 10} %</span>
            <span>
              {snap.doc.width} × {snap.doc.height} px · sRGB
              {snap.doc.sourceProfile ? ` (converted from ${snap.doc.sourceProfile})` : ''}
            </span>
            <span>{snap.cursor ? `X ${snap.cursor.x}  Y ${snap.cursor.y}` : ''}</span>
            <span className="ml-auto truncate">{snap.gpu}</span>
          </>
        ) : (
          <span>{busy ?? 'Ready'}</span>
        )}
      </footer>
      {(busy || error) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`bg-ui-panel fixed bottom-10 left-1/2 -translate-x-1/2 rounded border px-4 py-2 shadow-lg ${error ? 'border-danger text-danger' : 'border-ui-border'}`}
        >
          {error ?? busy}
          {error && (
            <button className="text-ui-muted ml-3" aria-label="Dismiss" onClick={() => setError(null)}>
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
