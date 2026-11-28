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
import { runOps } from '../lib/ops';
import { HANDLE_CURSORS } from '../engine/tools/crop';
import { BrushCursor } from './components/BrushCursor';
import { Button } from './components/Button';
import { ColorPickerDialog } from './components/ColorPickerDialog';
import { CropOverlay } from './components/CropOverlay';
import { CanvasSizeDialog, ImageSizeDialog, RotateDialog } from './components/ImageDialogs';
import { ExportDialog } from './components/ExportDialog';
import { HistoryPanel } from './components/HistoryPanel';
import { LayersPanel } from './components/LayersPanel';
import { NewDocumentDialog } from './components/NewDocumentDialog';
import { OptionsBar } from './components/OptionsBar';
import { PreferencesDialog } from './components/PreferencesDialog';
import { Scrollbars } from './components/Scrollbars';
import { StatusBar } from './components/StatusBar';
import { SwatchesPanel } from './components/SwatchesPanel';
import { TabBar } from './components/TabBar';
import { ToolBar } from './components/ToolBar';
import { UnsavedDialog } from './components/UnsavedDialog';
import { Welcome } from './components/Welcome';
import { useFileActions, type NewDocumentSpec } from './useFileActions';
import { useShortcuts, type ShortcutActions } from './useShortcuts';
import { useClipboard } from './useClipboard';
import { useRecent } from './useRecent';
import { useRecovery } from './useRecovery';
import { useSettings } from './useSettings';
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
  const [imageDialog, setImageDialog] = useState<'imageSize' | 'canvasSize' | 'rotate' | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const swatches = useSwatches();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [totalMemoryBytes, setTotalMemoryBytes] = useState(8 * 1024 ** 3);
  const [appInfo, setAppInfo] = useState<{ version: string; autosaveSecondsOverride: number | null }>({
    version: '0.0.0',
    autosaveSecondsOverride: null,
  });
  useEffect(() => {
    api.app.getInfo().then(
      (info) => {
        setTotalMemoryBytes(info.totalMemoryBytes);
        setAppInfo(info);
      },
      () => undefined,
    );
  }, []);
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
        runOps,
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

  const prefs = useSettings(editor, totalMemoryBytes);
  const autosaveMs =
    appInfo.autosaveSecondsOverride !== null
      ? appInfo.autosaveSecondsOverride * 1000
      : prefs.settings.files.autosaveMinutes * 60_000;
  const recovery = useRecovery(editor, snap, autosaveMs, appInfo.version);
  const files = useFileActions(editor, recovery.discardAll);
  const recent = useRecent();
  const clipboard = useClipboard(editor, files);
  // New document form (FR-DOC-01), shared by the Welcome screen and File › New.
  const presets = prefs.settings.files.documentPresets;
  const newDocumentForm = {
    onCreate: (spec: NewDocumentSpec) => {
      setNewOpen(false);
      void files.newDocument(spec);
    },
    saved: presets,
    onSavePreset: (p: (typeof presets)[number]) =>
      void prefs.update({
        files: { documentPresets: [...presets.filter((x) => x.name !== p.name), p].slice(-30) },
      }),
    onDeletePreset: (name: string) =>
      void prefs.update({ files: { documentPresets: presets.filter((x) => x.name !== name) } }),
    backgroundColor: snap?.colors.background ?? ([255, 255, 255] as [number, number, number]),
  };
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
      preferences: () => setPreferencesOpen(true),
      closeDocument: () => void files.closeDocument(),
      copyMerged: () => void clipboard.copyMerged(),
      imageSize: () => setImageDialog('imageSize'),
      canvasSize: () => setImageDialog('canvasSize'),
    }),
    [files, clipboard],
  );
  useShortcuts(editor, actions);

  useEffect(() => events.onOpenRecent((id) => void files.openRecent(id)), [files]);

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
          'file.close': () => void files.closeDocument(),
          'app.preferences': () => setPreferencesOpen(true),
          'edit.copyMerged': () => void clipboard.copyMerged(),
          'edit.pasteNewDocument': () => void clipboard.pasteAsNewDocument(),
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
          'image.imageSize': () => setImageDialog('imageSize'),
          'image.canvasSize': () => setImageDialog('canvasSize'),
          'image.rotate180': () => editor?.rotateCanvas(2),
          'image.rotate90cw': () => editor?.rotateCanvas(1),
          'image.rotate90ccw': () => editor?.rotateCanvas(3),
          'image.rotateArbitrary': () => setImageDialog('rotate'),
          'image.flipHorizontal': () => editor?.flipCanvas('horizontal'),
          'image.flipVertical': () => editor?.flipCanvas('vertical'),
          'view.zoomIn': () => editor?.zoomStep(1),
          'view.zoomOut': () => editor?.zoomStep(-1),
          'view.pixelGrid': () => editor?.togglePixelGrid(),
          'view.fit': () => editor?.fitToScreen(),
          'view.actualSize': () => editor?.zoomTo(1),
        };
        run[id]();
      }),
    [actions, files, editor, clipboard],
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
  // Preferences › Painting cursor: "precise" always shows the crosshair.
  const outline = brushPx >= 4 && prefs.settings.general.brushCursor === 'outline' ? brushPx : 0;
  const cursorClass = CURSORS[active] ?? (outline ? 'cursor-none' : 'cursor-crosshair');
  // The crop tool shows the handle under the pointer (resize arrows, move).
  const cropCursor = active === 'crop' && snap?.crop?.hover ? HANDLE_CURSORS[snap.crop.hover] : undefined;
  const toast = files.error ?? prefs.error ?? files.busy ?? engineNotice ?? files.notice;
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
          crop={snap.crop}
          onCrop={{
            rect: (r) => editor.setCropRect(r),
            ratio: (r) => editor.setCropRatio(r),
            commit: () => editor.commitCrop(),
            reset: () => editor.resetCrop(),
          }}
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
        <div className="flex min-w-0 flex-1 flex-col">
          {snap && snap.tabs.length > 0 && editor && (
            <TabBar
              tabs={snap.tabs}
              onActivate={(id) => editor.activateDocument(id)}
              onClose={(id) => void files.closeDocument(id)}
            />
          )}
          <div ref={canvasHost} className="relative min-h-0 flex-1 overflow-hidden">
            <canvas
              key={canvasKey}
              ref={attachCanvas}
              aria-label={snap?.doc ? `Canvas, ${snap.doc.width} by ${snap.doc.height} pixels` : 'Canvas'}
              role="img"
              // Absolutely positioned: the canvas's own pixel size (CSS size × DPR) must never feed back into layout.
              className={`absolute inset-0 block h-full w-full ${cursorClass}`}
              style={{ touchAction: 'none', cursor: cropCursor }}
            />
            {hasDoc && <BrushCursor host={canvasHost} diameter={outline} />}
            {snap?.crop && editor && <CropOverlay crop={snap.crop} editor={editor} />}
            {snap?.doc && editor && (
              <Scrollbars editor={editor} docWidth={snap.doc.width} docHeight={snap.doc.height} />
            )}
            {!hasDoc && (
              <Welcome
                onOpen={actions.open}
                recent={recent}
                onOpenRecent={(id) => void files.openRecent(id)}
                onRemoveRecent={(id) => void api.recent.remove(id).catch(files.reportError)}
                onClearRecent={() => void api.recent.clear().catch(files.reportError)}
                newDocument={newDocumentForm}
                recovery={recovery.items}
                onRecover={(item) => void recovery.recover(item).catch(files.reportError)}
                onDiscardRecovery={(id) => void recovery.discard(id)}
              />
            )}
          </div>
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
              onSnapshot={() => editor?.takeSnapshot()}
              onRestore={(id) => editor?.restoreSnapshot(id)}
              onDeleteSnapshot={(id) => editor?.deleteSnapshot(id)}
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
            <StatusBar snap={snap} onZoom={(z) => editor?.zoomTo(z)} />
          </>
        ) : (
          <span>{files.busy ?? 'Ready'}</span>
        )}
      </footer>
      {toast && (
        <div
          role={files.error || prefs.error ? 'alert' : 'status'}
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
                  : prefs.error
                    ? prefs.dismissError
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
      {imageDialog === 'imageSize' && snap?.doc && editor && (
        <ImageSizeDialog
          current={snap.doc}
          onCancel={() => setImageDialog(null)}
          onApply={(size, filter) => {
            setImageDialog(null);
            void editor.resizeImage(size.width, size.height, filter);
          }}
        />
      )}
      {imageDialog === 'canvasSize' && snap?.doc && editor && (
        <CanvasSizeDialog
          current={snap.doc}
          onCancel={() => setImageDialog(null)}
          onApply={(size, anchor) => {
            setImageDialog(null);
            editor.resizeCanvas(size.width, size.height, anchor);
          }}
        />
      )}
      {imageDialog === 'rotate' && editor && (
        <RotateDialog
          onCancel={() => setImageDialog(null)}
          onApply={(degrees) => {
            setImageDialog(null);
            void editor.rotateArbitrary(degrees);
          }}
        />
      )}
      {preferencesOpen && (
        <PreferencesDialog
          settings={prefs.settings}
          totalMemoryBytes={totalMemoryBytes}
          onChange={(patch) => void prefs.update(patch)}
          onClose={() => setPreferencesOpen(false)}
        />
      )}
      {newOpen && <NewDocumentDialog onCancel={() => setNewOpen(false)} {...newDocumentForm} />}
    </div>
  );
}
