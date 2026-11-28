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
import { readProject } from '../lib/files';
import { runOps, warmUpOps } from '../lib/ops';
import { OpfsSpillStore } from '../lib/scratch';
import { renderText } from '../lib/text-render';
import { TextEditor } from './components/TextEditor';
import { HANDLE_CURSORS } from '../engine/tools/crop';
import { transformCursor } from '../engine/tools/transform';
import { ADJUSTMENT_KINDS, type AdjustmentKind } from '../engine/ops/adjust';
import { BrushCursor } from './components/BrushCursor';
import { Button } from './components/Button';
import { ColorPickerDialog } from './components/ColorPickerDialog';
import { CropOverlay } from './components/CropOverlay';
import {
  CanvasSizeDialog,
  ImageSizeDialog,
  NewGuideDialog,
  RotateDialog,
  TrimDialog,
} from './components/ImageDialogs';
import { GuidesOverlay } from './components/GuidesOverlay';
import { GridOverlay } from './components/GridOverlay';
import { NavigatorPanel } from './components/NavigatorPanel';
import { Rulers } from './components/Rulers';
import { ExportDialog } from './components/ExportDialog';
import { HistoryPanel } from './components/HistoryPanel';
import { LayersPanel } from './components/LayersPanel';
import { NewDocumentDialog } from './components/NewDocumentDialog';
import { OptionsBar } from './components/OptionsBar';
import { PanelDock } from './components/PanelDock';
import { AdjustmentDialog, PropertiesPanel } from './components/PropertiesPanel';
import { HistogramPanel } from './components/HistogramPanel';
import { FilterDialog } from './components/FilterDialog';
import { PreferencesDialog } from './components/PreferencesDialog';
import { Scrollbars } from './components/Scrollbars';
import { SelectionOverlay } from './components/SelectionOverlay';
import { TransformOverlay } from './components/TransformOverlay';
import { ColorRangeDialog, ModifyDialog, type ModifyKind } from './components/SelectionDialogs';
import { StatusBar } from './components/StatusBar';
import { SwatchesPanel } from './components/SwatchesPanel';
import { TabBar } from './components/TabBar';
import { ToolBar } from './components/ToolBar';
import { UnsavedDialog } from './components/UnsavedDialog';
import { UpdateBanner } from './components/UpdateBanner';
import { Welcome } from './components/Welcome';
import { useFileActions, type NewDocumentSpec } from './useFileActions';
import { useShortcuts, type ShortcutActions } from './useShortcuts';
import { useClipboard } from './useClipboard';
import { useRecent } from './useRecent';
import { useRecovery } from './useRecovery';
import { useSettings } from './useSettings';
import { useUpdates } from './useUpdates';
import { useWorkspace } from './useWorkspace';
import { applyPreset, toggleVisible } from './workspace';
import { useSwatches } from './useSwatches';

const noSubscribe = () => () => undefined;

const CURSORS: Partial<Record<Tool, string>> = {
  move: 'cursor-move',
  hand: 'cursor-grab',
  zoom: 'cursor-zoom-in',
  eyedropper: 'cursor-crosshair',
  bucket: 'cursor-crosshair',
  gradient: 'cursor-crosshair',
  text: 'cursor-text',
};

/** One history scratch file per window, shared by its documents and by an Editor rebuilt after a GPU reset. */
const scratchStore = new OpfsSpillStore();

export function App() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [engineNotice, setEngineNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<'foreground' | 'background' | 'text' | null>(null);
  const [imageDialog, setImageDialog] = useState<
    'imageSize' | 'canvasSize' | 'rotate' | 'trim' | 'newGuide' | null
  >(null);
  /** Select › Modify › … or Select › Color Range (FR-SEL-05). */
  const [selectDialog, setSelectDialog] = useState<ModifyKind | 'colorRange' | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const swatches = useSwatches();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [totalMemoryBytes, setTotalMemoryBytes] = useState(8 * 1024 ** 3);
  const [appInfo, setAppInfo] = useState<{
    version: string;
    autosaveSecondsOverride: number | null;
    crashReportsAvailable: boolean;
  }>({ version: '0.0.0', autosaveSecondsOverride: null, crashReportsAvailable: false });
  // Filter workers start while the page is idle, so the first filter does not wait for them (NFR-PERF-05).
  useEffect(() => {
    // The scratch worker also clears history files left by a crashed session (ADR-0005).
    const id = window.requestIdleCallback?.(
      () => {
        warmUpOps();
        scratchStore.open().catch((err: unknown) => console.warn('[scratch]', err));
      },
      { timeout: 5000 },
    );
    return () => {
      if (id !== undefined) window.cancelIdleCallback?.(id);
    };
  }, []);
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
        spillStore: scratchStore,
        renderText,
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
  // The grid's spacing comes from the preferences; snapping uses it too.
  const { gridSpacing, gridSubdivisions } = prefs.settings.general;
  useEffect(() => editor?.setGrid(gridSpacing, gridSubdivisions), [editor, gridSpacing, gridSubdivisions]);
  const updates = useUpdates();
  const autosaveMs =
    appInfo.autosaveSecondsOverride !== null
      ? appInfo.autosaveSecondsOverride * 1000
      : prefs.settings.files.autosaveMinutes * 60_000;
  const recovery = useRecovery(editor, snap, autosaveMs, appInfo.version);
  const files = useFileActions(editor, recovery.discardAll);
  const [workspace, setWorkspace] = useWorkspace(prefs.settings, prefs.update);
  /** Tab hides the toolbar, options bar and panels (docs/03 §6). */
  const [uiHidden, setUiHidden] = useState(false);
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

  // A window opened for a tab dragged out of another one shows that document (FR-DOC-03).
  const { reportError } = files;
  useEffect(() => {
    if (!editor) return;
    api.app.takeHandover().then(async (h) => {
      if (!h) return;
      const { doc } = await readProject(h.project);
      editor.openMoved(doc, h.document);
    }, reportError);
  }, [editor, reportError]);

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
      toggleUi: () => setUiHidden((h) => !h),
      closeDocument: () => void files.closeDocument(),
      copyMerged: () => void clipboard.copyMerged(),
      imageSize: () => setImageDialog('imageSize'),
      feather: () => editor?.hasSelection && setSelectDialog('feather'),
      canvasSize: () => setImageDialog('canvasSize'),
    }),
    [files, clipboard, editor],
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
          'window.moveTab': () => void files.moveToNewWindow(),
          'window.layers': () => setWorkspace(toggleVisible(workspace, 'layers')),
          'window.swatches': () => setWorkspace(toggleVisible(workspace, 'swatches')),
          'window.history': () => setWorkspace(toggleVisible(workspace, 'history')),
          'window.properties': () => setWorkspace(toggleVisible(workspace, 'properties')),
          'window.histogram': () => setWorkspace(toggleVisible(workspace, 'histogram')),
          'view.rulers': () => editor?.toggleView('rulers'),
          'view.grid': () => editor?.toggleView('grid'),
          'window.navigator': () => setWorkspace(toggleVisible(workspace, 'navigator')),
          'view.guides': () => editor?.toggleView('guides'),
          'view.snap': () => editor?.toggleView('snap'),
          'view.lockGuides': () => editor?.toggleView('guidesLocked'),
          'view.clearGuides': () => editor?.clearGuides(),
          'view.newGuide': () => setImageDialog('newGuide'),
          'filter.last': () => editor?.repeatLastFilter(),
          'filter.gaussian-blur': () => editor?.beginFilter('gaussian-blur'),
          'filter.box-blur': () => editor?.beginFilter('box-blur'),
          'filter.sharpen': () => editor?.beginFilter('sharpen'),
          'filter.unsharp-mask': () => editor?.beginFilter('unsharp-mask'),
          'filter.motion-blur': () => editor?.beginFilter('motion-blur'),
          'filter.add-noise': () => editor?.beginFilter('add-noise'),
          'filter.reduce-noise': () => editor?.beginFilter('reduce-noise'),
          'filter.mosaic': () => editor?.beginFilter('mosaic'),
          'filter.emboss': () => editor?.beginFilter('emboss'),
          'filter.find-edges': () => editor?.beginFilter('find-edges'),
          'filter.vignette': () => editor?.beginFilter('vignette'),
          'image.autoTone': () => void editor?.autoAdjust('tone'),
          'image.autoContrast': () => void editor?.autoAdjust('contrast'),
          'image.autoColor': () => void editor?.autoAdjust('color'),
          ...(Object.fromEntries(
            ADJUSTMENT_KINDS.map((k) => [`layer.adjustment.${k}`, () => editor?.addAdjustmentLayer(k)]),
          ) as Record<`layer.adjustment.${AdjustmentKind}`, () => void>),
          ...(Object.fromEntries(
            ADJUSTMENT_KINDS.map((k) => [
              `image.adjust.${k}`,
              () =>
                k === 'invert' ? editor?.applyAdjustmentNow({ kind: 'invert' }) : editor?.beginAdjustment(k),
            ]),
          ) as Record<`image.adjust.${AdjustmentKind}`, () => void>),
          'window.essentials': () => setWorkspace(applyPreset(workspace, 'essentials')),
          'window.photography': () => setWorkspace(applyPreset(workspace, 'photography')),
          'window.resetWorkspace': () =>
            setWorkspace(
              applyPreset(workspace, workspace.preset === 'photography' ? 'photography' : 'essentials'),
            ),
          'edit.copyMerged': () => void clipboard.copyMerged(),
          'edit.pasteNewDocument': () => void clipboard.pasteAsNewDocument(),
          'edit.undo': () => editor?.undo(),
          'edit.freeTransform': () => editor?.beginTransform(),
          'edit.flipHorizontal': () => editor?.transformStep('flipHorizontal'),
          'edit.flipVertical': () => editor?.transformStep('flipVertical'),
          'edit.rotate180': () => editor?.transformStep('rotate180'),
          'edit.rotate90cw': () => editor?.transformStep('rotate90cw'),
          'edit.rotate90ccw': () => editor?.transformStep('rotate90ccw'),
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
          'layer.rasterizeType': () => editor?.rasterizeType(),
          'layer.mergeVisible': () => editor?.mergeVisible(),
          'layer.flatten': () => editor?.flattenImage(),
          'layer.alignLeft': () => editor?.align('left'),
          'layer.alignHCenter': () => editor?.align('hcenter'),
          'layer.alignRight': () => editor?.align('right'),
          'layer.alignTop': () => editor?.align('top'),
          'layer.alignVCenter': () => editor?.align('vcenter'),
          'layer.alignBottom': () => editor?.align('bottom'),
          'layer.distributeLeft': () => editor?.distribute('left'),
          'layer.distributeHCenter': () => editor?.distribute('hcenter'),
          'layer.distributeRight': () => editor?.distribute('right'),
          'layer.distributeTop': () => editor?.distribute('top'),
          'layer.distributeVCenter': () => editor?.distribute('vcenter'),
          'layer.distributeBottom': () => editor?.distribute('bottom'),
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
          'help.checkForUpdates': updates.check,
          'select.all': () => editor?.selectAll(),
          'select.deselect': () => editor?.deselect(),
          'select.reselect': () => editor?.reselect(),
          'select.inverse': () => editor?.invertSelection(),
          'edit.clear': () => editor?.clearSelection(),
          'image.cropToSelection': () => editor?.cropToSelection(),
          'image.trim': () => setImageDialog('trim'),
          'image.revealAll': () => editor?.revealAll(),
          'select.colorRange': () => setSelectDialog('colorRange'),
          'layer.clip': () => editor?.setClipped(true),
          'layer.unclip': () => editor?.setClipped(false),
          'layer.maskRevealAll': () => editor?.addLayerMask('reveal'),
          'layer.maskHideAll': () => editor?.addLayerMask('hide'),
          'layer.maskRevealSelection': () => editor?.addLayerMask('revealSelection'),
          'layer.maskHideSelection': () => editor?.addLayerMask('hideSelection'),
          'layer.maskDelete': () => editor?.deleteLayerMask(),
          'layer.maskApply': () => editor?.applyLayerMask(),
          'layer.maskToggle': () => editor?.toggleLayerMask('enabled'),
          'layer.maskLink': () => editor?.toggleLayerMask('linked'),
          'select.feather': () => editor?.hasSelection && setSelectDialog('feather'),
          'select.expand': () => editor?.hasSelection && setSelectDialog('expand'),
          'select.contract': () => editor?.hasSelection && setSelectDialog('contract'),
          'select.border': () => editor?.hasSelection && setSelectDialog('border'),
          'select.smooth': () => editor?.hasSelection && setSelectDialog('smooth'),
        };
        run[id]();
      }),
    [actions, files, editor, clipboard, workspace, setWorkspace, updates.check],
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
  const brushPx =
    snap && (isPaintTool(active) || active === 'clone') ? snap.options[active].size * snap.zoom : 0;
  // Preferences › Painting cursor: "precise" always shows the crosshair.
  const outline = brushPx >= 4 && prefs.settings.general.brushCursor === 'outline' ? brushPx : 0;
  const cursorClass = CURSORS[active] ?? (outline ? 'cursor-none' : 'cursor-crosshair');
  // The crop tool shows the handle under the pointer (resize arrows, move).
  const t = snap?.transform;
  const guideCursor = snap?.guideDrag ?? (snap?.guideHover ? { orientation: snap.guideHover } : null);
  const cropCursor = t
    ? transformCursor(t.box, t.params, t.hover ?? 'rotate')
    : guideCursor
      ? guideCursor.orientation === 'vertical'
        ? 'col-resize'
        : 'row-resize'
      : active === 'crop' && snap?.crop?.hover
        ? HANDLE_CURSORS[snap.crop.hover]
        : undefined;
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
      {snap && hasDoc && editor && !uiHidden && (
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
          onEditTextColor={() => setPicking('text')}
          onActualSize={() => editor.zoomTo(1)}
          transform={snap.transform}
          onTransform={{
            params: (patch) => editor.setTransformParams(patch),
            commit: () => void editor.commitTransform(),
            cancel: () => editor.cancelTransform(),
          }}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {snap && hasDoc && editor && !uiHidden && (
          <ToolBar
            tool={snap.tool}
            colors={snap.colors}
            onSelect={(t) => editor.setTool(t)}
            onEditColor={setPicking}
            onSwap={() => editor.swapColors()}
            onReset={() => editor.resetColors()}
            quickMask={snap.quickMask}
            onQuickMask={() => editor.toggleQuickMask()}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {snap && snap.tabs.length > 0 && editor && (
            <TabBar
              tabs={snap.tabs}
              onActivate={(id) => editor.activateDocument(id)}
              onClose={(id) => void files.closeDocument(id)}
              onMoveOut={(id, at) => void files.moveToNewWindow(id, at)}
            />
          )}
          <div ref={canvasHost} className="relative min-h-0 flex-1 overflow-hidden">
            <canvas
              key={canvasKey}
              ref={attachCanvas}
              aria-label={
                snap?.doc
                  ? `Canvas, ${snap.doc.width} by ${snap.doc.height} pixels${
                      snap.selection
                        ? `, selection ${snap.selection.bounds.x1 - snap.selection.bounds.x0} by ${
                            snap.selection.bounds.y1 - snap.selection.bounds.y0
                          } at ${snap.selection.bounds.x0}, ${snap.selection.bounds.y0}`
                        : ''
                    }`
                  : 'Canvas'
              }
              role="img"
              // Absolutely positioned: the canvas's own pixel size (CSS size × DPR) must never feed back into layout.
              className={`absolute inset-0 block h-full w-full ${cursorClass}`}
              style={{ touchAction: 'none', cursor: cropCursor }}
            />
            {hasDoc && <BrushCursor host={canvasHost} diameter={outline} />}
            {snap?.crop && editor && <CropOverlay crop={snap.crop} editor={editor} />}
            {snap?.transform && editor && <TransformOverlay transform={snap.transform} editor={editor} />}
            {snap?.doc && editor && snap.view.grid && (
              <GridOverlay
                editor={editor}
                doc={snap.doc}
                spacing={prefs.settings.general.gridSpacing}
                subdivisions={prefs.settings.general.gridSubdivisions}
              />
            )}
            {snap?.doc && editor && (
              <GuidesOverlay
                editor={editor}
                guides={snap.guides}
                drag={snap.guideDrag}
                shown={snap.view.guides}
              />
            )}
            {snap?.doc && editor && snap.view.rulers && (
              <Rulers
                editor={editor}
                doc={snap.doc}
                units={prefs.settings.general.rulerUnits}
                cursor={snap.cursor}
                onUnits={(rulerUnits) => void prefs.update({ general: { rulerUnits } })}
              />
            )}
            {editor &&
              (snap?.selection ||
                snap?.marquee ||
                snap?.lasso ||
                snap?.gradientLine ||
                snap?.cloneSource ||
                snap?.textBox) && (
                <SelectionOverlay
                  editor={editor}
                  // In Quick Mask the red overlay shows the selection instead of the ants.
                  selection={snap.quickMask ? null : snap.selection}
                  marquee={snap.marquee}
                  lasso={snap.lasso}
                  gradientLine={snap.gradientLine}
                  cloneSource={snap.cloneSource}
                  textBox={snap.textBox}
                />
              )}
            {editor && snap?.textEdit && <TextEditor editor={editor} edit={snap.textEdit} />}
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
        {snap && hasDoc && !uiHidden && (
          <PanelDock
            workspace={workspace}
            onChange={setWorkspace}
            panels={{
              layers: { content: editor && <LayersPanel editor={editor} snap={snap} /> },
              properties: { content: editor && <PropertiesPanel editor={editor} snap={snap} /> },
              histogram: { content: editor && <HistogramPanel editor={editor} snap={snap} /> },
              navigator: { content: editor && <NavigatorPanel editor={editor} snap={snap} /> },
              swatches: {
                content: (
                  <SwatchesPanel
                    recent={snap.colors.recent}
                    saved={swatches}
                    onForeground={(c) => editor?.setForeground(c)}
                    onBackground={(c) => editor?.setBackground(c)}
                  />
                ),
                actions: (
                  <button
                    className="text-ui-muted hover:text-ui-text px-1"
                    aria-label="Add foreground colour to swatches"
                    title="Add foreground colour to swatches"
                    onClick={() => swatches.add(snap.colors.foreground)}
                  >
                    ＋
                  </button>
                ),
              },
              history: {
                content: (
                  <HistoryPanel
                    history={snap.history}
                    initialLabel={snap.file.ref ? 'Open' : 'New'}
                    onGoTo={(i) => editor?.goToHistory(i)}
                    onRestore={(id) => editor?.restoreSnapshot(id)}
                    onDeleteSnapshot={(id) => editor?.deleteSnapshot(id)}
                  />
                ),
                actions: (
                  <button
                    className="text-ui-muted hover:text-ui-text px-1"
                    aria-label="New snapshot"
                    title="New snapshot: keep this state even when older steps are dropped"
                    onClick={() => editor?.takeSnapshot()}
                  >
                    📷
                  </button>
                ),
              },
            }}
          />
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
      <UpdateBanner updates={updates} version={appInfo.version} />
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
          title={
            picking === 'foreground'
              ? 'Foreground colour'
              : picking === 'text'
                ? 'Text colour'
                : 'Background colour'
          }
          initial={
            picking === 'text'
              ? (snap.options.text.color.slice(0, 3) as [number, number, number])
              : snap.colors[picking]
          }
          recent={snap.colors.recent}
          onAddSwatch={swatches.add}
          onCancel={() => setPicking(null)}
          onOk={(c) => {
            if (picking === 'foreground') editor.setForeground(c);
            else if (picking === 'text') editor.setToolOptions('text', { color: [c[0], c[1], c[2], 1] });
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
      {snap?.filtering && editor && (
        <FilterDialog
          filtering={snap.filtering}
          onChange={(f) => editor.setFilter(f)}
          onPreview={(on) => editor.setFilterPreview(on)}
          onApply={() => void editor.commitFilter()}
          onCancel={() => editor.cancelFilter()}
        />
      )}
      {snap?.adjusting && editor && (
        <AdjustmentDialog
          editor={editor}
          snap={snap}
          adjusting={snap.adjusting}
          onChange={(a) => editor.setAdjusting(a)}
          onPreview={(on) => editor.setAdjustingPreview(on)}
          onApply={() => void editor.commitAdjustment()}
          onCancel={() => editor.cancelAdjustment()}
        />
      )}
      {imageDialog === 'newGuide' && snap?.doc && editor && (
        <NewGuideDialog
          max={snap.doc}
          onCancel={() => setImageDialog(null)}
          onApply={(orientation, position) => {
            setImageDialog(null);
            editor.addGuide(orientation, position);
          }}
        />
      )}
      {imageDialog === 'trim' && snap?.doc && editor && (
        <TrimDialog
          onCancel={() => setImageDialog(null)}
          onApply={(basis, sides) => {
            setImageDialog(null);
            void editor.trim(basis, sides);
          }}
        />
      )}
      {selectDialog === 'colorRange' && editor && snap && (
        <ColorRangeDialog
          color={snap.colors.foreground}
          onCancel={() => setSelectDialog(null)}
          onApply={(fuzziness, sampleAll) => {
            setSelectDialog(null);
            void editor.selectColorRange(fuzziness, sampleAll);
          }}
        />
      )}
      {selectDialog && selectDialog !== 'colorRange' && editor && (
        <ModifyDialog
          kind={selectDialog}
          onCancel={() => setSelectDialog(null)}
          onApply={(op) => {
            setSelectDialog(null);
            void editor.modifySelection(op);
          }}
        />
      )}
      {preferencesOpen && (
        <PreferencesDialog
          settings={prefs.settings}
          totalMemoryBytes={totalMemoryBytes}
          onChange={(patch) => void prefs.update(patch)}
          onClose={() => setPreferencesOpen(false)}
          updates={updates}
          version={appInfo.version}
          crashReportsAvailable={appInfo.crashReportsAvailable}
        />
      )}
      {newOpen && <NewDocumentDialog onCancel={() => setNewOpen(false)} {...newDocumentForm} />}
    </div>
  );
}
