import { applyStroke, DabGenerator, DEFAULT_BRUSH, type BrushSettings, type Dab } from './brush/brush';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  PaintTilesCommand,
  SetActiveLayerCommand,
  SetLayerPropsCommand,
  type Command,
} from './doc/commands';
import {
  createGroupLayer,
  createRasterLayer,
  Document,
  type BlendMode,
  type Layer,
  type LayerLocks,
  type LayerProps,
} from './doc/document';
import { liveLayers, flattenPreview } from './doc/flatten';
import {
  duplicateLayer,
  flattenImage,
  groupLayer,
  mergeDown,
  mergeDownBlocker,
  mergeVisible,
  moveLayer,
  nudgeLayer,
  ungroupLayer,
} from './doc/layer-ops';
import { fromSnapshot, toSnapshot, type DocSnapshot } from './io/snapshot';
import { Compositor } from './gpu/compositor';
import { StrokeBuffer } from './gpu/stroke-buffer';
import { History, type HistoryEntry } from './history/history';
import { Viewport } from './render/viewport';
import { parseTileKey, TileGrid, type Tile, type TileKey } from './tiles/tile';

export type Tool = 'brush' | 'eraser' | 'hand' | 'zoom';

/** Where the open document lives on disk (a FileRef from main; the engine never sees paths). */
export type DocumentFile = { id: string; displayName: string; displayDir: string };

export type EditorSnapshot = {
  doc: { width: number; height: number; name: string; sourceProfile: string | null } | null;
  /** Save state (FR-DOC-04/11). */
  file: {
    /** The file the document was opened from or last saved to. */
    ref: DocumentFile | null;
    /** True when `ref` is a project (.iep) that Save can overwrite. */
    isProject: boolean;
    /** Unsaved changes since open/save. */
    dirty: boolean;
    /** Why Save must go to a new file (a project from a newer version), if so. */
    readOnlyReason: string | null;
  };
  /** Rows of the Layers panel: top → bottom, children under their group (hidden when collapsed). */
  layers: LayerRow[];
  activeLayerId: string | null;
  /** Whether each layer operation applies to the active layer (null = yes, else why not). */
  layerOps: { mergeDown: string | null; canUngroup: boolean; canDelete: boolean };
  history: { entries: HistoryEntry[]; position: number; canUndo: boolean; canRedo: boolean };
  zoom: number;
  tool: Tool;
  brush: BrushSettings;
  cursor: { x: number; y: number } | null;
  gpu: string;
};

export type LayerRow = {
  id: string;
  type: 'raster' | 'group';
  name: string;
  visible: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: BlendMode;
  locks: LayerLocks;
  passThrough: boolean;
  collapsed: boolean;
  depth: number;
  parentId: string | null;
  /** Changes whenever the layer's pixels change; key for thumbnails (FR-LAY-06). */
  contentKey: string;
};

type ActiveStroke = { layerId: string; settings: BrushSettings; generator: DabGenerator; pointerId: number };

/** Everything needed to continue editing on a fresh canvas (CPU state only; GPU state is rebuilt). */
export type EditorState = {
  doc: Document | null;
  history: History | null;
  file: {
    ref: DocumentFile | null;
    isProject: boolean;
    readOnlyReason: string | null;
    savedTop: Command | null;
  };
  view: { zoom: number; panX: number; panY: number; autoFit: boolean };
  tool: Tool;
  brush: BrushSettings;
};

export type EditorOptions = {
  /**
   * Called when a lost WebGL context is not restored in time. The host should give the editor's state to
   * a new Editor on a new canvas (NFR-REL-02: pixels live in CPU tiles, nothing is lost).
   */
  onUnrecoverableContextLoss?: () => void;
  /** How long to wait for `webglcontextrestored` before giving up on this canvas. */
  restoreTimeoutMs?: number;
  /** Short user-facing explanation when an action is refused (e.g. painting on a locked layer). */
  onNotice?: (message: string) => void;
};

/**
 * Engine façade (docs/02 §3): owns the document, history, viewport, tools and GPU. Framework-free; the UI
 * subscribes to snapshots (useSyncExternalStore) and calls methods. Stroke input never triggers UI renders.
 */
export class Editor {
  private gl: WebGL2RenderingContext;
  private compositor!: Compositor;
  private strokeBuffer!: StrokeBuffer;
  private doc: Document | null = null;
  private history: History | null = null;
  private file: EditorState['file'] = { ref: null, isProject: false, readOnlyReason: null, savedTop: null };
  /** Increments on every document change; lets the file worker reuse a flatten for repeated exports. */
  private version = 0;
  readonly viewport = new Viewport();
  private tool: Tool = 'brush';
  private brush: BrushSettings = { ...DEFAULT_BRUSH };
  private stroke: ActiveStroke | null = null;
  private pan: { x: number; y: number; pointerId: number } | null = null;
  private spaceHeld = false;
  /** Keep the document fitted on resize until the user zooms or pans (FR-NAV-01). */
  private autoFit = true;
  private cursor: { x: number; y: number } | null = null;
  private frame = 0;
  private pendingInputTimes: number[] = [];
  private listeners = new Set<() => void>();
  private snapshot: EditorSnapshot;
  private readonly resizeObserver: ResizeObserver;
  private readonly abort = new AbortController();
  private restoreTimer = 0;
  private readonly thumbs = new Map<string, { width: number; height: number; rgba: Uint8ClampedArray }>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: EditorOptions = {},
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available on this system.');
    this.gl = gl;
    this.initGpu();
    this.snapshot = this.buildSnapshot();
    const signal = this.abort.signal;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal });
    canvas.addEventListener('pointerleave', () => this.setCursor(null), { signal });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault(); // ask the browser to restore the context
        console.warn('[engine] WebGL context lost; waiting for restore');
        this.stroke = null; // any stroke in progress cannot be committed
        // Some drivers never restore (seen on Linux software GL). Fall back to a fresh canvas.
        window.clearTimeout(this.restoreTimer);
        this.restoreTimer = window.setTimeout(() => {
          if (!this.gl.isContextLost()) return;
          console.warn('[engine] WebGL context was not restored; moving the document to a new canvas');
          this.options.onUnrecoverableContextLoss?.();
        }, this.options.restoreTimeoutMs ?? 1500);
        this.changed();
      },
      { signal },
    );
    canvas.addEventListener('webglcontextrestored', () => this.onContextRestored(), { signal });
    this.resizeObserver = new ResizeObserver(() => {
      if (this.autoFit && this.doc) this.fitToScreen();
      else this.requestRender();
    });
    this.resizeObserver.observe(canvas);
    console.info(`[engine] ${this.snapshot.gpu}`);
  }

  private initGpu(): void {
    this.compositor = new Compositor(this.gl);
    this.strokeBuffer = new StrokeBuffer(this.gl, this.compositor.quad);
    // Composite buffers need the same capability the stroke self-test checked (blending into the format).
    this.compositor.targetFormat = this.strokeBuffer.format;
  }

  /** NFR-REL-02: pixels live in CPU tiles, so a lost GPU context only needs re-uploading. */
  private onContextRestored(): void {
    window.clearTimeout(this.restoreTimer);
    this.stroke = null;
    this.initGpu(); // textures are rebuilt lazily from the CPU tiles
    console.info(`[engine] WebGL context restored (${this.strokeBuffer.format})`);
    this.changed();
  }

  // ---- documents -------------------------------------------------------------------------------

  newDocument(
    width: number,
    height: number,
    background: [number, number, number, number] = [255, 255, 255, 255],
  ): void {
    const doc = new Document(
      width,
      height,
      createRasterLayer('Background', TileGrid.filled(width, height, background)),
    );
    this.open(doc);
  }

  loadImage(
    width: number,
    height: number,
    rgba: Uint8Array,
    meta: { name: string; sourceProfile: string | null; exif: Uint8Array | null },
    file: DocumentFile | null = null,
  ): void {
    const doc = new Document(
      width,
      height,
      createRasterLayer('Background', TileGrid.fromRgba(width, height, rgba)),
      meta,
    );
    this.open(doc, { ref: file, isProject: false, readOnlyReason: null });
  }

  /** Opens a project read by the file worker. */
  openProject(snapshot: DocSnapshot, file: DocumentFile | null, readOnlyReason: string | null): void {
    const doc = fromSnapshot(snapshot);
    if (file) doc.meta.name = file.displayName;
    this.open(doc, { ref: file, isProject: file !== null, readOnlyReason });
  }

  /** Plain copy of the document for the file worker (tile bytes are shared, not copied). */
  getDocSnapshot(): DocSnapshot | null {
    return this.doc ? toSnapshot(this.doc) : null;
  }

  get documentVersion(): number {
    return this.version;
  }

  /** Identifies the current history state; take it together with getDocSnapshot() when saving. */
  saveToken(): Command | null {
    return this.history?.top ?? null;
  }

  /**
   * Records a successful save of the state identified by `token`: the document now lives at `ref` (a
   * project) and is clean — unless it was edited while the file was being written.
   */
  markSaved(ref: DocumentFile, token: Command | null): void {
    if (!this.doc) return;
    this.doc.meta.name = ref.displayName;
    this.file = { ref, isProject: true, readOnlyReason: null, savedTop: token };
    this.changed();
  }

  /** Snapshot of the CPU-side state, to continue on another canvas. */
  exportState(): EditorState {
    const { zoom, panX, panY } = this.viewport;
    return {
      doc: this.doc,
      history: this.history,
      file: this.file,
      view: { zoom, panX, panY, autoFit: this.autoFit },
      tool: this.tool,
      brush: this.brush,
    };
  }

  /** Continues editing a document exported from another Editor (history, file state and view included). */
  adopt(state: EditorState): void {
    this.doc = state.doc;
    this.history = state.history;
    this.file = state.file;
    if (this.history) this.history.onChange = () => this.onHistoryChange();
    Object.assign(this.viewport, { zoom: state.view.zoom, panX: state.view.panX, panY: state.view.panY });
    this.autoFit = state.view.autoFit;
    this.tool = state.tool;
    this.brush = state.brush;
    this.version++;
    this.changed();
  }

  private open(
    doc: Document,
    file: Omit<EditorState['file'], 'savedTop'> = { ref: null, isProject: false, readOnlyReason: null },
  ): void {
    this.stroke = null;
    this.strokeBuffer.clear();
    this.doc = doc;
    this.history = new History(doc, { maxSteps: 100, maxBytes: 2 * 1024 ** 3 }, () => this.onHistoryChange());
    this.file = { ...file, savedTop: null };
    this.version++;
    this.fitToScreen();
  }

  private onHistoryChange(): void {
    this.version++;
    this.changed();
  }

  // ---- state for the UI ------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorSnapshot => this.snapshot;

  private buildSnapshot(): EditorSnapshot {
    const doc = this.doc;
    const debug = this.gl.getExtension('WEBGL_debug_renderer_info');
    return {
      doc: doc
        ? { width: doc.width, height: doc.height, name: doc.meta.name, sourceProfile: doc.meta.sourceProfile }
        : null,
      file: {
        ref: this.file.ref,
        isProject: this.file.isProject,
        dirty: doc !== null && (this.history?.top ?? null) !== this.file.savedTop,
        readOnlyReason: this.file.readOnlyReason,
      },
      layers: doc ? layerRows(doc.layers) : [],
      activeLayerId: doc?.activeLayerId ?? null,
      layerOps: doc
        ? {
            mergeDown: mergeDownBlocker(doc, doc.activeLayerId),
            canUngroup: doc.activeLayer.type === 'group',
            canDelete:
              !doc.activeLayer.locks.all &&
              !(doc.layers.length <= 1 && doc.locate(doc.activeLayerId).parent === null),
          }
        : { mergeDown: 'No document.', canUngroup: false, canDelete: false },
      history: {
        entries: this.history?.entries() ?? [],
        position: this.history?.position ?? -1,
        canUndo: this.history?.canUndo ?? false,
        canRedo: this.history?.canRedo ?? false,
      },
      zoom: this.viewport.zoom,
      tool: this.tool,
      brush: this.brush,
      cursor: this.cursor,
      gpu: this.gl.isContextLost()
        ? 'Graphics context lost — restoring…'
        : `${debug ? String(this.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'WebGL2'} · strokes ${this.strokeBuffer.format.toUpperCase()}`,
    };
  }

  private changed(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
    this.requestRender();
  }

  // ---- commands --------------------------------------------------------------------------------

  undo(): void {
    if (!this.stroke) this.history?.undo();
  }

  redo(): void {
    if (!this.stroke) this.history?.redo();
  }

  goToHistory(index: number): void {
    this.history?.goTo(index);
  }

  private exec(cmd: Parameters<History['execute']>[0] | null, opts?: { coalesce?: boolean }): void {
    if (cmd && this.history && !this.stroke) this.history.execute(cmd, opts);
  }

  /** Where a new layer goes: above the active layer, in the same group. */
  private insertionPoint(): { parentId: string | null; index: number } {
    const loc = this.doc!.locate(this.doc!.activeLayerId);
    return { parentId: loc.parent?.id ?? null, index: loc.index + 1 };
  }

  private nextName(prefix: string): string {
    const used = new Set(this.doc!.allLayers().map((l) => l.name));
    let n = 1;
    while (used.has(`${prefix} ${n}`)) n++;
    return `${prefix} ${n}`;
  }

  addLayer(): void {
    if (!this.doc) return;
    const { parentId, index } = this.insertionPoint();
    this.exec(new AddLayerCommand(this.nextName('Layer'), index, parentId));
  }

  addGroup(): void {
    if (!this.doc) return;
    const { parentId, index } = this.insertionPoint();
    this.exec(new AddLayerCommand(createGroupLayer(this.nextName('Group')), index, parentId, 'New Group'));
  }

  deleteLayer(id = this.doc?.activeLayerId): void {
    const doc = this.doc;
    if (!doc || !id) return;
    if (doc.layer(id).locks.all) return this.notice('This layer is locked.');
    if (doc.layers.length <= 1 && doc.locate(id).parent === null)
      return this.notice('A document needs at least one layer.');
    this.exec(new DeleteLayerCommand(id));
  }

  /** @deprecated use deleteLayer() */
  deleteActiveLayer(): void {
    this.deleteLayer();
  }

  duplicateLayer(): void {
    if (this.doc) this.exec(duplicateLayer(this.doc, this.doc.activeLayerId));
  }

  groupActiveLayer(): void {
    if (this.doc) this.exec(groupLayer(this.doc, this.doc.activeLayerId));
  }

  ungroupActiveLayer(): void {
    if (this.doc) this.exec(ungroupLayer(this.doc, this.doc.activeLayerId));
  }

  mergeDown(): void {
    if (!this.doc) return;
    const blocker = mergeDownBlocker(this.doc, this.doc.activeLayerId);
    if (blocker) return this.notice(blocker);
    this.exec(mergeDown(this.doc, this.doc.activeLayerId));
  }

  mergeVisible(): void {
    if (!this.doc) return;
    const cmd = mergeVisible(this.doc);
    if (!cmd) return this.notice('Merge Visible needs at least two visible, unlocked layers.');
    this.exec(cmd);
  }

  flattenImage(): void {
    if (this.doc) this.exec(flattenImage(this.doc));
  }

  /** Drag and drop in the Layers panel: `index` counts positions after the layer is removed. */
  moveLayer(id: string, parentId: string | null, index: number): void {
    if (this.doc) this.exec(moveLayer(this.doc, id, parentId, index));
  }

  /**
   * Drops layer `id` relative to `targetId` as shown in the Layers panel (top = higher in the stack):
   * 'above' / 'below' the target in its group, or 'inside' a group (on top of its children).
   */
  dropLayer(id: string, targetId: string, where: 'above' | 'below' | 'inside'): void {
    const doc = this.doc;
    if (!doc || id === targetId) return;
    const from = doc.locate(id);
    const target = doc.locate(targetId);
    let parentId = target.parent?.id ?? null;
    let index = where === 'above' ? target.index + 1 : target.index;
    if (where === 'inside' && target.layer.type === 'group') {
      parentId = target.layer.id;
      index = target.layer.children.length;
    }
    // Indices count positions after the layer is removed from its current place.
    const sameContainer = from.siblings === (parentId === null ? doc.layers : doc.container(parentId));
    if (sameContainer && from.index < index) index--;
    this.moveLayer(id, parentId, index);
  }

  /** Bring forward (+1) / send backward (−1) within the group (Ctrl+] / Ctrl+[). */
  nudgeActiveLayer(step: 1 | -1): void {
    if (this.doc) this.exec(nudgeLayer(this.doc, this.doc.activeLayerId, step));
  }

  /**
   * Layer properties (name, visibility, opacity, fill, blend mode, locks, pass-through). With `coalesce`,
   * repeated calls (slider drags) become one undo step until endCoalesce().
   */
  setLayerProps(id: string, props: Partial<LayerProps>, { coalesce = false } = {}): void {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.layer(id);
    const onlyAllowedWhenLocked = Object.keys(props).every(
      (k) => k === 'visible' || k === 'locks' || k === 'name',
    );
    if (layer.locks.all && !onlyAllowedWhenLocked) return this.notice('This layer is locked.');
    this.exec(new SetLayerPropsCommand(id, props), { coalesce });
  }

  setLayerVisible(id: string, visible: boolean): void {
    this.setLayerProps(id, { visible });
  }

  /** Call repeatedly while dragging, then `endCoalesce()` on release: one undo step per drag. */
  setLayerOpacity(id: string, opacity: number): void {
    this.setLayerProps(id, { opacity }, { coalesce: true });
  }

  /** Collapsing a group is view state: saved with the project but not an undo step. */
  toggleCollapsed(id: string): void {
    const layer = this.doc?.layer(id);
    if (layer?.type !== 'group') return;
    layer.collapsed = !layer.collapsed;
    this.changed();
  }

  /**
   * Small preview of one layer's own pixels (FR-LAY-06), ignoring its visibility, opacity and blend mode.
   * Cached by content key; call it lazily (the panel throttles).
   */
  layerThumbnail(
    id: string,
    maxSide: number,
  ): { width: number; height: number; rgba: Uint8ClampedArray } | null {
    const doc = this.doc;
    if (!doc || !doc.has(id)) return null;
    const layer = doc.layer(id);
    const key = `${id}|${contentKey(layer)}|${maxSide}`;
    const cached = this.thumbs.get(key);
    if (cached) return cached;
    const plain: Layer = {
      ...layer,
      visible: true,
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
    } as Layer;
    if (plain.type === 'group') plain.passThrough = false;
    const thumb = flattenPreview(liveLayers([plain]), doc.width, doc.height, maxSide);
    if (this.thumbs.size > 500) this.thumbs.clear();
    this.thumbs.set(key, thumb);
    return thumb;
  }

  private notice(message: string): void {
    this.options.onNotice?.(message);
  }

  endCoalesce(): void {
    this.history?.endCoalesce();
  }

  /** Layer selection is UI state, not an undo step (matches common editors). */
  setActiveLayer(id: string): void {
    if (!this.doc) return;
    new SetActiveLayerCommand(id).do(this.doc);
    this.changed();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.changed();
  }

  setBrush(patch: Partial<BrushSettings>): void {
    this.brush = {
      ...this.brush,
      ...patch,
      size: Math.min(2500, Math.max(1, patch.size ?? this.brush.size)),
    };
    this.changed();
  }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
  }

  // ---- view ------------------------------------------------------------------------------------

  private cssSize(): { width: number; height: number } {
    return { width: this.canvas.clientWidth || 1, height: this.canvas.clientHeight || 1 };
  }

  fitToScreen(): void {
    if (!this.doc) return;
    const { width, height } = this.cssSize();
    this.viewport.fit(this.doc.width, this.doc.height, width, height);
    this.autoFit = true;
    this.changed();
  }

  zoomTo(zoom: number): void {
    const { width, height } = this.cssSize();
    this.viewport.setZoomCentered(zoom, width, height);
    this.autoFit = false;
    this.changed();
  }

  zoomBy(factor: number): void {
    this.zoomTo(this.viewport.zoom * factor);
  }

  // ---- input -----------------------------------------------------------------------------------

  private docPoint(e: PointerEvent): { x: number; y: number; pressure: number } {
    const rect = this.canvas.getBoundingClientRect();
    const [x, y] = this.viewport.screenToDoc(e.clientX - rect.left, e.clientY - rect.top);
    // Mice report 0.5 while pressed; treat them as full pressure.
    const pressure = e.pointerType === 'mouse' ? 1 : e.pressure || 1;
    return { x, y, pressure };
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.doc || this.stroke || this.pan) return;
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || this.tool === 'hand' || this.spaceHeld) {
      this.pan = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      return;
    }
    if (e.button !== 0) return;
    if (this.tool === 'zoom') {
      const rect = this.canvas.getBoundingClientRect();
      this.viewport.zoomAt(e.altKey ? 0.5 : 2, e.clientX - rect.left, e.clientY - rect.top);
      this.autoFit = false;
      this.changed();
      return;
    }
    const layer = this.doc.activeLayer;
    if (this.gl.isContextLost()) return; // no GPU: nothing to paint with
    if (layer.type !== 'raster') return this.notice('Select a layer to paint on (groups have no pixels).');
    if (!layer.visible) return this.notice('This layer is hidden. Show it to paint on it.');
    if (layer.locks.all || layer.locks.pixels) return this.notice('This layer is locked.');
    const settings: BrushSettings = { ...this.brush, mode: this.tool === 'eraser' ? 'erase' : 'paint' };
    const generator = new DabGenerator(settings);
    this.stroke = { layerId: layer.id, settings, generator, pointerId: e.pointerId };
    this.strokeBuffer.clear();
    this.strokeBuffer.hardness = settings.hardness;
    this.addDabs(generator.begin(this.docPoint(e)), e.timeStamp);
  }

  private onPointerMove(e: PointerEvent): void {
    this.setCursor(this.doc ? this.docPoint(e) : null);
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.viewport.panBy(e.clientX - this.pan.x, e.clientY - this.pan.y);
      this.autoFit = false;
      this.pan = { ...this.pan, x: e.clientX, y: e.clientY };
      this.requestRender();
      return;
    }
    if (!this.stroke || e.pointerId !== this.stroke.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const dabs: Dab[] = [];
    for (const ev of events.length ? events : [e])
      dabs.push(...this.stroke.generator.moveTo(this.docPoint(ev)));
    this.addDabs(dabs, e.timeStamp);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.pan = null;
      this.changed();
    }
    if (this.stroke && e.pointerId === this.stroke.pointerId) this.commitStroke();
  }

  private onWheel(e: WheelEvent): void {
    if (!this.doc) return;
    e.preventDefault();
    this.autoFit = false;
    if (e.ctrlKey || e.metaKey) {
      const rect = this.canvas.getBoundingClientRect();
      this.viewport.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
      this.changed();
    } else {
      this.viewport.panBy(-e.deltaX, -e.deltaY);
      this.requestRender();
    }
  }

  private setCursor(p: { x: number; y: number } | null): void {
    const next = p ? { x: Math.floor(p.x), y: Math.floor(p.y) } : null;
    if (next?.x === this.cursor?.x && next?.y === this.cursor?.y) return;
    this.cursor = next;
    this.snapshot = { ...this.snapshot, cursor: next };
    for (const l of this.listeners) l();
  }

  private addDabs(dabs: Dab[], inputTime: number): void {
    if (!this.doc || dabs.length === 0) return;
    this.strokeBuffer.addDabs(dabs, this.doc.width, this.doc.height);
    this.requestRender(inputTime);
  }

  /** Commits the stroke on the CPU (exact, straight alpha) as one PaintTiles command (docs/02 §5.3). */
  private commitStroke(): void {
    const stroke = this.stroke;
    const doc = this.doc;
    this.stroke = null;
    if (!stroke || !doc || !this.history) return;
    if (this.gl.isContextLost()) {
      // The coverage lives on the GPU; without a context it cannot be read. Never commit a silent no-op.
      console.warn('[engine] stroke discarded: WebGL context lost');
      this.strokeBuffer.clear();
      return;
    }
    const start = performance.now();
    const layer = doc.raster(stroke.layerId);
    const preserveAlpha = layer.locks.transparency;
    const before = new Map<TileKey, Tile | undefined>();
    const after = new Map<TileKey, Tile | undefined>();
    for (const key of this.strokeBuffer.keys()) {
      const [tileX, tileY] = parseTileKey(key);
      const old = layer.tiles.get(key);
      const next = applyStroke(
        old,
        this.strokeBuffer.readCoverage(key),
        stroke.settings,
        {
          tileX,
          tileY,
          docWidth: doc.width,
          docHeight: doc.height,
        },
        preserveAlpha,
      );
      if (next !== old) {
        before.set(key, old);
        after.set(key, next);
      }
    }
    this.strokeBuffer.clear();
    if (after.size > 0) {
      this.history.execute(
        new PaintTilesCommand(stroke.settings.mode === 'erase' ? 'Eraser' : 'Brush', layer.id, before, after),
      );
    } else {
      this.requestRender();
    }
    performance.measure('stroke-commit', { start, end: performance.now() });
  }

  // ---- rendering -------------------------------------------------------------------------------

  requestRender(inputTime?: number): void {
    if (inputTime !== undefined) this.pendingInputTimes.push(inputTime);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const dpr = window.devicePixelRatio || 1;
    const { width: cssWidth, height: cssHeight } = this.cssSize();
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const gl = this.gl;
    if (!this.doc) {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0x3a / 255, 0x3a / 255, 0x3a / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const strokeLayer = this.stroke ? this.doc.layer(this.stroke.layerId) : null;
    const preview = this.stroke
      ? {
          buffer: this.strokeBuffer,
          layerId: this.stroke.layerId,
          settings: this.stroke.settings,
          preserveAlpha: strokeLayer?.locks.transparency ?? false,
        }
      : undefined;
    this.compositor.render(this.doc, this.viewport, { cssWidth, cssHeight, width, height, dpr }, preview);
    // NFR-PERF-02: pointer event → frame submitted. Read by the benchmark/E2E via the Performance API.
    const now = performance.now();
    for (const t of this.pendingInputTimes.splice(0))
      performance.measure('brush-latency', { start: t, end: now });
  }

  dispose(): void {
    window.clearTimeout(this.restoreTimer);
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.strokeBuffer.clear();
    this.compositor.dispose();
  }
}

/** Identity of a layer's pixels: changes when any tile is replaced (tiles are immutable). */
function contentKey(layer: Layer): string {
  if (layer.type === 'group')
    return `g(${layer.children.map((c) => `${c.visible ? '' : '!'}${c.opacity}${c.blendMode}${contentKey(c)}`).join(',')})`;
  let sum = 0;
  let xor = 0;
  for (const t of layer.tiles.entries()) {
    sum += t[1].id;
    xor ^= t[1].id;
  }
  return `${layer.tiles.size}.${sum}.${xor}`;
}

function layerRows(layers: Layer[]): LayerRow[] {
  const rows: LayerRow[] = [];
  const visit = (list: Layer[], depth: number, parentId: string | null) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i]!;
      rows.push({
        id: l.id,
        type: l.type,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        fillOpacity: l.fillOpacity,
        blendMode: l.blendMode,
        locks: l.locks,
        passThrough: l.type === 'group' && l.passThrough,
        collapsed: l.type === 'group' && l.collapsed,
        depth,
        parentId,
        contentKey: contentKey(l),
      });
      if (l.type === 'group' && !l.collapsed) visit(l.children, depth + 1, l.id);
    }
  };
  visit(layers, 0, null);
  return rows;
}
