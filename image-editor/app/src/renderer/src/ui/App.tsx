import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from 'react';
import type { MenuCommandId } from '@shared/menu';
import { Editor, isPaintTool, type EditorSnapshot, type EditorState, type Tool } from '../engine/editor';
import { api, errorMessage, events } from '../lib/api';
import { BrushCursor } from './components/BrushCursor';
import { Button } from './components/Button';
import { ColorPickerDialog } from './components/ColorPickerDialog';
import { ExportDialog } from './components/ExportDialog';
import { HistoryPanel } from './components/HistoryPanel';
import { LayersPanel } from './components/LayersPanel';
import { NewDocumentDialog } from './components/NewDocumentDialog';
import { OptionsBar } from './components/OptionsBar';
import { SwatchesPanel } from './components/SwatchesPanel';
import { ToolBar } from './components/ToolBar';
import { UnsavedDialog } from './components/UnsavedDialog';
import { Welcome } from './components/Welcome';
import { useFileActions } from './useFileActions';
import { useShortcuts, type ShortcutActions } from './useShortcuts';
import { useSwatches } from './useSwatches';

const noSubscribe = () => () => undefined;

const CURSORS: Partial<Record<Tool, string>> = {
  move: 'cursor-move',
  hand: 'cursor-grab',
  zoom: 'cursor-zoom-in',
  eyedropper: 'cursor-crosshair',
};

export function App() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [engineNotice, setEngineNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<'foreground' | 'background' | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const swatches = useSwatches();
  // Bumping the key replaces the <canvas> (and its WebGL context) after an unrecoverable context loss;
  // the new Editor adopts the old one's document and history.
  const [canvasKey, setCanvasKey] = useState(0);
  const carryOver = useRef<EditorState | null>(null);

  // Callback ref with cleanup (React 19): the engine owns the canvas for the component's lifetime.
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    try {
      const instance: Editor = new Editor(canvas, {
        onNotice: setEngineNotice,
        onUnrecoverableContextLoss: () => {
          carryOver.current = instance.exportState();
          setCanvasKey((k) => k + 1);
        },
      });
      if (carryOver.current) {
        instance.adopt(carryOver.current);
        carryOver.current = null;
      }
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

  useEffect(() => {
    if (!engineNotice) return;
    const timer = window.setTimeout(() => setEngineNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [engineNotice]);

  const files = useFileActions(editor);
  const { openRef } = files;

  // Files passed on the command line / via file association (FR-DOC-02).
  useEffect(() => {
    if (!editor) return;
    api.app.getLaunchFiles().then(
      ([first]) => first && void openRef(first),
      () => undefined,
    );
  }, [editor, openRef]);

  const actions: ShortcutActions = useMemo(
    () => ({
      open: () => void files.openDialog(),
      newDocument: () => setNewOpen(true),
      save: () => void files.save(),
      saveAs: () => void files.saveAs(),
      exportAs: files.openExport,
      quickExport: () => void files.quickExport(),
    }),
    [files],
  );
  useShortcuts(editor, actions);

  // Native menu (docs/04 §2.5).
  useEffect(
    () =>
      events.onMenuCommand((id: MenuCommandId) => {
        const run: Record<MenuCommandId, () => void> = {
          'file.new': actions.newDocument,
          'file.open': actions.open,
          'file.save': actions.save,
          'file.saveAs': actions.saveAs,
          'file.exportAs': actions.exportAs,
          'file.quickExport': actions.quickExport,
          'file.revert': () => void files.revert(),
          'edit.undo': () => editor?.undo(),
          'edit.redo': () => editor?.redo(),
          'layer.new': () => editor?.addLayer(),
          'layer.newGroup': () => editor?.addGroup(),
          'layer.duplicate': () => editor?.duplicateLayer(),
          'layer.delete': () => editor?.deleteLayer(),
          'layer.group': () => editor?.groupActiveLayer(),
          'layer.ungroup': () => editor?.ungroupActiveLayer(),
          'layer.bringForward': () => editor?.nudgeActiveLayer(1),
          'layer.sendBackward': () => editor?.nudgeActiveLayer(-1),
          'layer.mergeDown': () => editor?.mergeDown(),
          'layer.mergeVisible': () => editor?.mergeVisible(),
          'layer.flatten': () => editor?.flattenImage(),
          'layer.alignLeft': () => editor?.align('left'),
          'layer.alignHCenter': () => editor?.align('hcenter'),
          'layer.alignRight': () => editor?.align('right'),
          'layer.alignTop': () => editor?.align('top'),
          'layer.alignVCenter': () => editor?.align('vcenter'),
          'layer.alignBottom': () => editor?.align('bottom'),
          'view.zoomIn': () => editor?.zoomBy(2),
          'view.zoomOut': () => editor?.zoomBy(0.5),
          'view.fit': () => editor?.fitToScreen(),
          'view.actualSize': () => editor?.zoomTo(1),
        };
        run[id]();
      }),
    [actions, files, editor],
  );

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const dropped = [...e.dataTransfer.files];
    if (!dropped.length) return;
    try {
      const [first] = await api.files.registerDropped(dropped);
      if (first) await openRef(first);
    } catch (err) {
      files.reportError(err);
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
  // Painting tools show the brush outline; below 4 screen px a crosshair is clearer (docs/03 §4).
  const active = snap?.activeTool ?? 'brush';
  const brushPx = snap && isPaintTool(active) ? snap.options[active].size * snap.zoom : 0;
  const outline = brushPx >= 4 ? brushPx : 0;
  const cursorClass = CURSORS[active] ?? (outline ? 'cursor-none' : 'cursor-crosshair');
  const toast = files.error ?? files.busy ?? engineNotice ?? files.notice;
  return (
    <div className="flex h-full flex-col" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="bg-ui-panel border-ui-border flex h-9 items-center gap-1 border-b px-2">
        <Button onClick={actions.open} title="Open (Ctrl+O)">
          Open…
        </Button>
        <Button onClick={actions.save} disabled={!hasDoc || Boolean(files.busy)} title="Save (Ctrl+S)">
          Save
        </Button>
        <Button
          onClick={actions.exportAs}
          disabled={!hasDoc || Boolean(files.busy)}
          title="Export As (Ctrl+Alt+Shift+W)"
        >
          Export…
        </Button>
        <Button onClick={() => editor?.undo()} disabled={!snap?.history.canUndo} title="Undo (Ctrl+Z)">
          Undo
        </Button>
        <Button onClick={() => editor?.redo()} disabled={!snap?.history.canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </Button>
        <span className="text-ui-muted ml-3 truncate" aria-label="Document">
          {snap?.doc?.name ?? ''}
          {snap?.file.dirty ? <span aria-label="unsaved changes"> •</span> : null}
        </span>
      </header>
      {snap && hasDoc && editor && (
        <OptionsBar
          tool={snap.tool}
          options={snap.options}
          zoom={snap.zoom}
          onOptions={(tool, patch) => editor.setToolOptions(tool, patch)}
          onResetTool={(tool) => editor.resetToolOptions(tool)}
          onAlign={(edge) => editor.align(edge)}
          onFit={() => editor.fitToScreen()}
          onActualSize={() => editor.zoomTo(1)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {snap && hasDoc && editor && (
          <ToolBar
            tool={snap.tool}
            colors={snap.colors}
            onSelect={(t) => editor.setTool(t)}
            onEditColor={setPicking}
            onSwap={() => editor.swapColors()}
            onReset={() => editor.resetColors()}
          />
        )}
        <div ref={canvasHost} className="relative min-w-0 flex-1 overflow-hidden">
          <canvas
            key={canvasKey}
            ref={attachCanvas}
            aria-label={snap?.doc ? `Canvas, ${snap.doc.width} by ${snap.doc.height} pixels` : 'Canvas'}
            role="img"
            className={`block h-full w-full ${cursorClass}`}
            style={{ touchAction: 'none' }}
          />
          {hasDoc && <BrushCursor host={canvasHost} diameter={outline} />}
          {!hasDoc && <Welcome onNew={(w, h) => void files.newDocument(w, h)} onOpen={actions.open} />}
        </div>
        {snap && hasDoc && (
          <aside aria-label="Panels" className="bg-ui-panel border-ui-border flex w-60 flex-col border-l">
            {editor && <LayersPanel editor={editor} snap={snap} />}
            <SwatchesPanel
              recent={snap.colors.recent}
              saved={swatches}
              foreground={snap.colors.foreground}
              onForeground={(c) => editor?.setForeground(c)}
              onBackground={(c) => editor?.setBackground(c)}
            />
            <HistoryPanel
              history={snap.history}
              initialLabel={snap.file.ref ? 'Open' : 'New'}
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
          <span>{files.busy ?? 'Ready'}</span>
        )}
      </footer>
      {toast && (
        <div
          role={files.error ? 'alert' : 'status'}
          className={`bg-ui-panel fixed bottom-10 left-1/2 z-40 -translate-x-1/2 rounded border px-4 py-2 shadow-lg ${files.error ? 'border-danger text-danger' : 'border-ui-border'}`}
        >
          {toast}
          {!files.busy && (
            <button
              className="text-ui-muted ml-3"
              aria-label="Dismiss"
              onClick={
                files.error
                  ? files.dismissError
                  : engineNotice
                    ? () => setEngineNotice(null)
                    : files.dismissNotice
              }
            >
              ✕
            </button>
          )}
        </div>
      )}
      {files.unsaved && <UnsavedDialog name={files.unsaved.name} onChoose={files.unsaved.resolve} />}
      {files.exporting && editor && (
        <ExportDialog
          editor={editor}
          initial={files.exportInitial}
          onExport={(o) => void files.exportWith(o)}
          onCancel={files.closeExport}
        />
      )}
      {picking && snap && editor && (
        <ColorPickerDialog
          title={picking === 'foreground' ? 'Foreground colour' : 'Background colour'}
          initial={snap.colors[picking]}
          recent={snap.colors.recent}
          onAddSwatch={swatches.add}
          onCancel={() => setPicking(null)}
          onOk={(c) => {
            if (picking === 'foreground') editor.setForeground(c);
            else editor.setBackground(c);
            setPicking(null);
          }}
        />
      )}
      {newOpen && (
        <NewDocumentDialog
          onCancel={() => setNewOpen(false)}
          onCreate={(w, h) => {
            setNewOpen(false);
            void files.newDocument(w, h);
          }}
        />
      )}
    </div>
  );
}
