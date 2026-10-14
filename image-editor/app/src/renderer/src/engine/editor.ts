import { tileRange } from '@shared/iep-schema';
import {
  applyStroke,
  DabGenerator,
  DEFAULT_BRUSH,
  PulledString,
  type BrushPoint,
  type BrushSettings,
  type Dab,
} from './brush/brush';
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
import { compositePixel, liveLayers, flattenPreview } from './doc/flatten';
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
import { sampleColor, type RGB, type SampleSize, type SampleSource } from './doc/sample';
import {
  alignOffset,
  layerAt,
  moveBlocker,
  movedRasters,
  translateGrid,
  translateLayer,
  type AlignEdge,
} from './doc/translate';
import { fromSnapshot, toSnapshot, type DocSnapshot } from './io/snapshot';
import { Compositor } from './gpu/compositor';
import { StrokeBuffer } from './gpu/stroke-buffer';
import {
  cropDocument,
  flipCanvas,
  replacePixels,
  resizeCanvas,
  rotateCanvas,
  type Anchor,
  type CropRect,
} from './doc/geometry';
import { History, type HistoryEntry } from './history/history';
import { captureState, collectTileIds, restoreState, type DocState } from './history/snapshots';
import { clipGrid, type Turns } from './ops/canvas';
import {
  dragHandle,
  fitRatio,
  hitHandle,
  ratioValue,
  rectFromDrag,
  roundRect,
  straightenAngle,
  type CropRatio,
  type Handle,
} from './tools/crop';
import { fromGrid, runOpsJob, toGrid, type LayerTiles, type OpsJob } from './ops/jobs';
import { inscribedSize, rotatedCanvasSize, type ResampleFilter } from './ops/resample';
import { nextZoomStep, Viewport } from './render/viewport';
import { parseTileKey, TILE_BYTES, TileGrid, type Tile, type TileKey } from './tiles/tile';

export type Tool = 'move' | 'crop' | 'brush' | 'pencil' | 'eraser' | 'eyedropper' | 'hand' | 'zoom';
export type PaintTool = 'brush' | 'pencil' | 'eraser';
export const isPaintTool = (t: Tool): t is PaintTool => t === 'brush' || t === 'pencil' || t === 'eraser';

/** Per-tool brush options (FR-PNT-01/02). Colour comes from the foreground/background colours. */
export type BrushOptions = Pick<
  BrushSettings,
  | 'size'
  | 'hardness'
  | 'opacity'
  | 'flow'
  | 'spacing'
  | 'smoothing'
  | 'pressureSize'
  | 'pressureOpacity'
  | 'tip'
>;

export type ToolOptions = {
  brush: BrushOptions;
  pencil: BrushOptions;
  /** `pencil`: the eraser uses an aliased pencil tip (FR-PNT-02). */
  eraser: BrushOptions & { pencil: boolean };
  eyedropper: { size: SampleSize; source: SampleSource };
  move: { autoSelect: boolean; autoSelectMode: 'layer' | 'group' };
  /** Crop tool (FR-TRF-01): ratio preset, "Delete cropped pixels", and Straighten (draw a line) mode. */
  crop: { ratio: CropRatio; deletePixels: boolean; straighten: boolean };
};

const brushDefaults = (o: Partial<BrushOptions> = {}): BrushOptions => ({
  size: DEFAULT_BRUSH.size,
  hardness: DEFAULT_BRUSH.hardness,
  opacity: DEFAULT_BRUSH.opacity,
  flow: DEFAULT_BRUSH.flow,
  spacing: DEFAULT_BRUSH.spacing,
  smoothing: DEFAULT_BRUSH.smoothing,
  pressureSize: DEFAULT_BRUSH.pressureSize,
  pressureOpacity: DEFAULT_BRUSH.pressureOpacity,
  tip: DEFAULT_BRUSH.tip,
  ...o,
});

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  brush: brushDefaults({ smoothing: 0.1 }),
  pencil: brushDefaults({ size: 1, hardness: 1, spacing: 0.25 }),
  eraser: { ...brushDefaults(), pencil: false },
  eyedropper: { size: 1, source: 'all' },
  move: { autoSelect: false, autoSelectMode: 'layer' },
  crop: { ratio: 'free', deletePixels: true, straighten: false },
};

/** Foreground/background colours (FR-PNT-07) and recently painted colours, newest first. */
export type Colors = { foreground: RGB; background: RGB; recent: RGB[] };
export const DEFAULT_COLORS: Colors = { foreground: [0, 0, 0], background: [255, 255, 255], recent: [] };
const MAX_RECENT = 10;

/** Smoothing 100 % is a 60 screen-px string (scaled to document px by the zoom at stroke start). */
const SMOOTHING_SCREEN_PX = 60;
/** Arrow-key nudges this close together become one undo step (docs/02 §6). */
const NUDGE_COALESCE_MS = 500;
/** FR-HIS-01: 100 steps by default; the memory budget bounds them too. */
const DEFAULT_HISTORY_STEPS = 100;
const HISTORY_BYTES = 2 * 1024 ** 3;

/** Zoom/pan (CSS px) and the canvas's CSS size. */
export type ViewState = { zoom: number; panX: number; panY: number; width: number; height: number };

/** Where the open document lives on disk (a FileRef from main; the engine never sees paths). */
export type DocumentFile = { id: string; displayName: string; displayDir: string };

export type EditorSnapshot = {
  doc: {
    /** Identity of this open document (names its recovery snapshot, FR-DOC-10). */
    id: string;
    width: number;
    height: number;
    name: string;
    sourceProfile: string | null;
  } | null;
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
  /** Open documents in tab order (FR-DOC-03). */
  tabs: Array<{ id: string; name: string; dirty: boolean; active: boolean }>;
  /** Rows of the Layers panel: top → bottom, children under their group (hidden when collapsed). */
  layers: LayerRow[];
  activeLayerId: string | null;
  /** Whether each layer operation applies to the active layer (null = yes, else why not). */
  layerOps: { mergeDown: string | null; canUngroup: boolean; canDelete: boolean };
  history: {
    entries: HistoryEntry[];
    position: number;
    canUndo: boolean;
    canRedo: boolean;
    /** Named states that never expire (FR-HIS-02); the first is the document as opened. */
    snapshots: Array<{ id: string; name: string }>;
    maxSteps: number;
  };
  /** Memory meter (FR-NAV-06): pixels held by the document, snapshots and history, against the budget. */
  memory: { usedBytes: number; budgetBytes: number };
  /** Pixel grid at ≥ 800 % (View › Pixel Grid). */
  pixelGrid: boolean;
  zoom: number;
  tool: Tool;
  /** The tool a click would use now: Alt (eyedropper) and Ctrl/⌘ (move) switch temporarily (docs/03 §4). */
  activeTool: Tool;
  /** Crop tool state for the overlay (null unless the Crop tool is selected). */
  crop: {
    rect: CropRect;
    /** A handle is being dragged (the overlay shows the rule-of-thirds grid). */
    dragging: boolean;
    /** Straighten line being drawn, document px. */
    line: { x0: number; y0: number; x1: number; y1: number } | null;
    /** Handle under the pointer, for the cursor. */
    hover: Handle | null;
  } | null;
  options: ToolOptions;
  colors: Colors;
  /** Document pixel under the pointer and the composite colour there (#RRGGBB, null if transparent). */
  cursor: { x: number; y: number; color: string | null } | null;
  /** A pixel job running in the ops worker (Image Size, rotation); editing waits until it ends. */
  job: { label: string; progress: number } | null;
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

type ActiveStroke = {
  layerId: string;
  tool: PaintTool;
  settings: BrushSettings;
  generator: DabGenerator;
  smoother: PulledString;
  /** Last pointer position, for the catch-up at the end of a smoothed stroke. */
  last: BrushPoint;
  pointerId: number;
};

type ActiveMove = {
  layerId: string;
  rasterIds: ReadonlySet<string>;
  start: { x: number; y: number };
  dx: number;
  dy: number;
  pointerId: number;
};

/** Everything needed to continue editing on a fresh canvas (CPU state only; GPU state is rebuilt). */
export type EditorState = {
  doc: Document | null;
  history: History | null;
  file: {
    ref: DocumentFile | null;
    isProject: boolean;
    readOnlyReason: string | null;
    savedTop: Command | null;
    /** Restored from a recovery snapshot: unsaved until saved, whatever the history says. */
    recovered?: boolean;
  };
  view: { zoom: number; panX: number; panY: number; autoFit: boolean };
  tool: Tool;
  options: ToolOptions;
  colors: Colors;
  snapshots: DocSnapshotEntry[];
  docId: string;
  /** Documents open in other tabs, and the tab order (FR-DOC-03). */
  background: Session[];
  tabOrder: string[];
};

type DocSnapshotEntry = { id: string; name: string; state: DocState };

/** A document open in a tab that is not shown: everything needed to switch back to it (FR-DOC-03). */
type Session = {
  id: string;
  doc: Document;
  history: History;
  file: EditorState['file'];
  view: EditorState['view'];
  snapshots: DocSnapshotEntry[];
  /** Document version when it was last shown (it cannot change while hidden). */
  version: number;
};

const sessionDirty = (history: History | null, file: EditorState['file']) =>
  Boolean(file.recovered) || (history?.top ?? null) !== file.savedTop;

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
  /** Runs heavy pixel jobs (resampling) off the UI thread; defaults to running them in-thread. */
  runOps?: (job: OpsJob, onProgress: (p: number) => void) => Promise<LayerTiles[]>;
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
  private docId = '';
  private readonly background = new Map<string, Session>();
  private tabOrder: string[] = [];
  private untitledSeq = 0;
  /** Increments on every document change; lets the file worker reuse a flatten for repeated exports. */
  private version = 0;
  readonly viewport = new Viewport();
  private tool: Tool = 'brush';
  /** Brush or pencil, whichever was used last (B selects it, docs/03 §4). */
  private lastBrushTool: 'brush' | 'pencil' = 'brush';
  private toolOptions: ToolOptions = structuredClone(DEFAULT_TOOL_OPTIONS);
  private colors: Colors = structuredClone(DEFAULT_COLORS);
  private stroke: ActiveStroke | null = null;
  private moving: ActiveMove | null = null;
  private sampling: { pointerId: number; target: 'foreground' | 'background' } | null = null;
  private pan: { x: number; y: number; pointerId: number } | null = null;
  private spaceHeld = false;
  private modifiers = { alt: false, ctrl: false };
  private lastNudge = 0;
  private job: { label: string; progress: number } | null = null;
  private cropRect: CropRect | null = null;
  private cropDrag:
    | {
        kind: 'rect';
        handle: Handle | 'new';
        start: CropRect;
        from: { x: number; y: number };
        pointerId: number;
      }
    | { kind: 'line'; line: { x0: number; y0: number; x1: number; y1: number }; pointerId: number }
    | null = null;
  private cropHover: Handle | null = null;
  /** Canvas size the view was last fitted to (refit when a command changes it). */
  private shownSize = { width: 0, height: 0 };
  private snapshots: DocSnapshotEntry[] = [];
  private snapshotSeq = 0;
  private historySteps = DEFAULT_HISTORY_STEPS;
  private historyBytes = HISTORY_BYTES;
  /** Kept here too, because a context loss rebuilds the compositor. */
  private surround: [number, number, number] = [0x3a, 0x3a, 0x3a];
  private pixelGrid = true;
  private view: ViewState = { zoom: 1, panX: 0, panY: 0, width: 0, height: 0 };
  private readonly viewListeners = new Set<() => void>();
  /** Keep the document fitted on resize until the user zooms or pans (FR-NAV-01). */
  private autoFit = true;
  private cursor: EditorSnapshot['cursor'] = null;
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
    this.compositor.surround = this.surround;
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
    ppi = 72,
  ): void {
    const doc = new Document(
      width,
      height,
      createRasterLayer('Background', TileGrid.filled(width, height, background)),
      // Numbered, so tabs of new documents can be told apart (as in Photoshop).
      { ppi, name: `Untitled-${++this.untitledSeq}` },
    );
    this.open(doc);
  }

  loadImage(
    width: number,
    height: number,
    rgba: Uint8Array,
    meta: { name: string; sourceProfile: string | null; exif: Uint8Array | null },
    file: DocumentFile | null = null,
    /** Revert: reload into the same tab. */
    replace = false,
  ): void {
    const doc = new Document(
      width,
      height,
      createRasterLayer('Background', TileGrid.fromRgba(width, height, rgba)),
      meta,
    );
    this.open(doc, { ref: file, isProject: false, readOnlyReason: null }, undefined, replace);
  }

  /** Opens a project read by the file worker. */
  openProject(
    snapshot: DocSnapshot,
    file: DocumentFile | null,
    readOnlyReason: string | null,
    replace = false,
  ): void {
    const doc = fromSnapshot(snapshot);
    if (file) doc.meta.name = file.displayName;
    this.open(doc, { ref: file, isProject: file !== null, readOnlyReason }, undefined, replace);
  }

  /**
   * Reopens a recovery snapshot (FR-DOC-10) as an unsaved document that keeps its id, so later autosaves
   * overwrite the same recovery entry and saving removes it.
   */
  openRecovered(snapshot: DocSnapshot, id: string, name: string): void {
    const doc = fromSnapshot(snapshot);
    doc.meta.name = name;
    this.open(doc, { ref: null, isProject: false, readOnlyReason: null }, id);
    this.file = { ...this.file, recovered: true };
    this.changed();
  }

  /** Plain copy of the document for the file worker (tile bytes are shared, not copied). */
  getDocSnapshot(id: string = this.docId): DocSnapshot | null {
    if (id === this.docId) return this.doc ? toSnapshot(this.doc) : null;
    const s = this.background.get(id);
    return s ? toSnapshot(s.doc) : null;
  }

  get documentVersion(): number {
    return this.version;
  }

  /** Version of any open document (autosave skips documents that have not changed). */
  documentVersionOf(id: string): number {
    return id === this.docId ? this.version : (this.background.get(id)?.version ?? -1);
  }

  // ---- tabs (FR-DOC-03) --------------------------------------------------------------------------

  /** Keeps the shown document as a background session (before showing another one). */
  private stash(): void {
    if (!this.doc || !this.history) return;
    const { zoom, panX, panY } = this.viewport;
    this.background.set(this.docId, {
      id: this.docId,
      doc: this.doc,
      history: this.history,
      file: this.file,
      view: { zoom, panX, panY, autoFit: this.autoFit },
      snapshots: this.snapshots,
      version: this.version,
    });
  }

  /** Shows a background session; transient tool state never crosses documents. */
  private show(s: Session): void {
    this.background.delete(s.id);
    this.stroke = null;
    this.moving = null;
    this.sampling = null;
    this.cropDrag = null;
    this.strokeBuffer.clear();
    this.doc = s.doc;
    this.history = s.history;
    this.file = s.file;
    this.snapshots = s.snapshots;
    this.docId = s.id;
    Object.assign(this.viewport, { zoom: s.view.zoom, panX: s.view.panX, panY: s.view.panY });
    this.autoFit = s.view.autoFit;
    this.shownSize = { width: s.doc.width, height: s.doc.height };
    if (this.cropRect) this.cropRect = { x: 0, y: 0, width: s.doc.width, height: s.doc.height };
    // A new version: caches keyed by version (the export flatten) must not serve another document.
    this.version++;
    if (this.autoFit) this.fitToScreen();
    else this.changed();
  }

  /** Clicking a tab (or Ctrl+Tab). */
  activateDocument(id: string): void {
    const s = this.background.get(id);
    if (!s || this.busy) return;
    this.stash();
    this.show(s);
  }

  /** Ctrl+Tab / Ctrl+Shift+Tab. */
  cycleDocument(step: 1 | -1): void {
    const n = this.tabOrder.length;
    if (n < 2) return;
    const i = this.tabOrder.indexOf(this.docId);
    this.activateDocument(this.tabOrder[(i + step + n) % n]!);
  }

  /** Closes a tab without asking (the host confirms unsaved changes first). */
  closeDocument(id: string = this.docId): void {
    if (this.busy) return;
    const index = this.tabOrder.indexOf(id);
    if (index < 0) return;
    this.tabOrder.splice(index, 1);
    if (id !== this.docId) {
      this.background.delete(id);
      return this.changed();
    }
    const next = this.tabOrder[index] ?? this.tabOrder[index - 1];
    if (next) return this.show(this.background.get(next)!);
    this.doc = null;
    this.history = null;
    this.file = { ref: null, isProject: false, readOnlyReason: null, savedTop: null };
    this.snapshots = [];
    this.docId = '';
    this.cropRect = null;
    this.version++;
    this.changed();
  }

  /** The tab already showing this file, if any (opening it again just switches to it). */
  findDocument(file: Pick<DocumentFile, 'displayName' | 'displayDir'>): string | null {
    const same = (f: EditorState['file']) =>
      f.ref !== null && f.ref.displayName === file.displayName && f.ref.displayDir === file.displayDir;
    if (this.doc && same(this.file)) return this.docId;
    for (const s of this.background.values()) if (same(s.file)) return s.id;
    return null;
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
      options: this.toolOptions,
      colors: this.colors,
      snapshots: this.snapshots,
      docId: this.docId,
      background: [...this.background.values()],
      tabOrder: [...this.tabOrder],
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
    this.toolOptions = state.options;
    this.colors = state.colors;
    this.snapshots = state.snapshots;
    this.docId = state.docId;
    this.background.clear();
    for (const s of state.background) {
      s.history.onChange = () => this.onHistoryChange();
      this.background.set(s.id, s);
    }
    this.tabOrder = [...state.tabOrder];
    this.version++;
    this.changed();
  }

  /**
   * Shows `doc` in a new tab after the active one, or in place of the active one with `replace` (Revert).
   */
  private open(
    doc: Document,
    file: Omit<EditorState['file'], 'savedTop'> = { ref: null, isProject: false, readOnlyReason: null },
    id: string = crypto.randomUUID(),
    replace = false,
  ): void {
    const at = this.tabOrder.indexOf(this.docId);
    if (replace && at >= 0) this.tabOrder.splice(at, 1, id);
    else {
      this.stash();
      this.tabOrder.splice(at + 1, 0, id);
    }
    this.cropRect = this.cropRect && { x: 0, y: 0, width: doc.width, height: doc.height };
    this.docId = id;
    this.stroke = null;
    this.moving = null;
    this.strokeBuffer.clear();
    this.doc = doc;
    this.history = new History(doc, { maxSteps: this.historySteps, maxBytes: this.historyBytes }, () =>
      this.onHistoryChange(),
    );
    // The document as opened is always reachable, however many steps are dropped (FR-HIS-02).
    this.snapshots = [{ id: `S${++this.snapshotSeq}`, name: doc.meta.name, state: captureState(doc) }];
    this.file = { ...file, savedTop: null };
    this.version++;
    this.fitToScreen();
  }

  private onHistoryChange(): void {
    this.version++;
    // Crop, image/canvas size and rotation change the canvas size: show the whole new canvas.
    const doc = this.doc;
    if (doc && (doc.width !== this.shownSize.width || doc.height !== this.shownSize.height)) {
      if (this.cropRect) this.cropRect = { x: 0, y: 0, width: doc.width, height: doc.height };
      this.fitToScreen();
    } else this.changed();
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
        ? {
            id: this.docId,
            width: doc.width,
            height: doc.height,
            name: doc.meta.name,
            sourceProfile: doc.meta.sourceProfile,
          }
        : null,
      file: {
        ref: this.file.ref,
        isProject: this.file.isProject,
        dirty: doc !== null && sessionDirty(this.history, this.file),
        readOnlyReason: this.file.readOnlyReason,
      },
      tabs: this.tabOrder.map((id) => {
        if (id === this.docId)
          return { id, name: doc!.meta.name, dirty: sessionDirty(this.history, this.file), active: true };
        const s = this.background.get(id)!;
        return { id, name: s.doc.meta.name, dirty: sessionDirty(s.history, s.file), active: false };
      }),
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
        snapshots: this.snapshots.map(({ id, name }) => ({ id, name })),
        maxSteps: this.history?.limits.maxSteps ?? DEFAULT_HISTORY_STEPS,
      },
      memory: { usedBytes: this.memoryUsed(), budgetBytes: this.historyBytes },
      pixelGrid: this.pixelGrid,
      zoom: this.viewport.zoom,
      tool: this.tool,
      activeTool: this.effectiveTool(this.modifiers),
      crop: this.cropState(),
      options: this.toolOptions,
      colors: this.colors,
      cursor: this.cursor,
      job: this.job,
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

  /** A pointer gesture or a pixel job is changing the document (undo and other commands wait). */
  private get busy(): boolean {
    return this.stroke !== null || this.moving !== null || this.job !== null;
  }

  undo(): void {
    if (!this.busy) this.history?.undo();
  }

  redo(): void {
    if (!this.busy) this.history?.redo();
  }

  goToHistory(index: number): void {
    if (!this.busy) this.history?.goTo(index);
  }

  private exec(cmd: Parameters<History['execute']>[0] | null, opts?: { coalesce?: boolean }): void {
    if (cmd && this.history && !this.busy) this.history.execute(cmd, opts);
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

  /**
   * Edit › Paste (FR-DOC-12): the pixels become a new layer above the active one, centred on the visible
   * part of the canvas (as in Photoshop). Parts outside the canvas are kept (FR-TRF-07 margin).
   */
  pasteAsLayer(width: number, height: number, rgba: Uint8Array): void {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const view = this.viewport.visibleDocRect(this.cssSize().width, this.cssSize().height);
    const cx = (Math.max(0, view.x0) + Math.min(doc.width, view.x1)) / 2;
    const cy = (Math.max(0, view.y0) + Math.min(doc.height, view.y1)) / 2;
    const grid = translateGrid(
      TileGrid.fromRgba(width, height, rgba),
      Math.round(cx - width / 2),
      Math.round(cy - height / 2),
      tileRange(doc.width, doc.height),
    );
    const { parentId, index } = this.insertionPoint();
    this.exec(
      new AddLayerCommand(createRasterLayer(this.nextName('Pasted Layer'), grid), index, parentId, 'Paste'),
    );
  }

  /**
   * What Edit › Copy (the active layer, as if visible, opaque and Normal) or Copy Merged (the visible
   * composite) puts on the clipboard, as a snapshot for the file worker to encode (FR-DOC-12).
   */
  clipboardSnapshot(merged: boolean): DocSnapshot | null {
    const doc = this.doc;
    if (!doc) return null;
    const full = toSnapshot(doc);
    if (merged) return full;
    const find = (list: DocSnapshot['layers']): DocSnapshot['layers'][number] | undefined => {
      for (const l of list) {
        if (l.id === doc.activeLayerId) return l;
        const inner = l.type === 'group' ? find(l.children) : undefined;
        if (inner) return inner;
      }
      return undefined;
    };
    const layer = find(full.layers);
    if (!layer) return null;
    const plain = { ...layer, visible: true, opacity: 1, fillOpacity: 1, blendMode: 'normal' as const };
    return { ...full, layers: [plain.type === 'group' ? { ...plain, passThrough: false } : plain] };
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
    if (tool === 'crop' && this.tool !== 'crop') this.resetCrop(false);
    this.tool = tool;
    if (tool === 'brush' || tool === 'pencil') this.lastBrushTool = tool;
    this.changed();
  }

  /** B: the brush or pencil, whichever was used last; Shift+B switches between them (docs/03 §4). */
  selectBrushTool(cycle = false): void {
    if (this.tool !== 'brush' && this.tool !== 'pencil') this.setTool(this.lastBrushTool);
    else if (cycle) this.setTool(this.tool === 'brush' ? 'pencil' : 'brush');
  }

  setToolOptions<T extends keyof ToolOptions>(tool: T, patch: Partial<ToolOptions[T]>): void {
    const next = { ...this.toolOptions[tool], ...patch };
    if ('size' in next) next.size = Math.min(2500, Math.max(1, Math.round(next.size)));
    this.toolOptions = { ...this.toolOptions, [tool]: next };
    this.changed();
  }

  /** "Reset tool" in the options bar (docs/03 §3). */
  resetToolOptions(tool: keyof ToolOptions): void {
    this.toolOptions = { ...this.toolOptions, [tool]: structuredClone(DEFAULT_TOOL_OPTIONS[tool]) };
    this.changed();
  }

  /** The paint tool whose options the brush shortcuts ([ ], Shift+[ ], digits) change. */
  private get paintTool(): PaintTool {
    return isPaintTool(this.tool) ? this.tool : this.lastBrushTool;
  }

  /** Changes the options of the current paint tool (or the last brush tool). */
  setBrush(patch: Partial<BrushOptions>): void {
    this.setToolOptions(this.paintTool, patch);
  }

  get brushOptions(): BrushOptions {
    return this.toolOptions[this.paintTool];
  }

  // ---- colours (FR-PNT-07) ----------------------------------------------------------------------

  setForeground(color: RGB): void {
    this.colors = { ...this.colors, foreground: [...color] };
    this.changed();
  }

  setBackground(color: RGB): void {
    this.colors = { ...this.colors, background: [...color] };
    this.changed();
  }

  /** X */
  swapColors(): void {
    this.colors = { ...this.colors, foreground: this.colors.background, background: this.colors.foreground };
    this.changed();
  }

  /** D: black foreground, white background. */
  resetColors(): void {
    this.colors = { ...this.colors, foreground: [0, 0, 0], background: [255, 255, 255] };
    this.changed();
  }

  private addRecent(color: RGB): void {
    const same = (c: RGB) => c[0] === color[0] && c[1] === color[1] && c[2] === color[2];
    if (this.colors.recent[0] && same(this.colors.recent[0])) return;
    this.colors = {
      ...this.colors,
      recent: [[...color] as RGB, ...this.colors.recent.filter((c) => !same(c))].slice(0, MAX_RECENT),
    };
  }

  // ---- move tool (FR-TRF-07) ---------------------------------------------------------------------

  /** Arrow keys with the Move tool: moves the active layer; nudges in quick succession are one undo step. */
  nudge(dx: number, dy: number): void {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const blocker = moveBlocker(doc, doc.activeLayerId);
    if (blocker) return this.notice(blocker);
    const now = performance.now();
    if (now - this.lastNudge > NUDGE_COALESCE_MS) this.history?.endCoalesce();
    this.lastNudge = now;
    this.exec(translateLayer(doc, doc.activeLayerId, dx, dy, 'Nudge'), { coalesce: true });
  }

  /** Aligns the active layer's content with the canvas (Layer › Align). */
  align(edge: AlignEdge): void {
    const doc = this.doc;
    if (!doc) return;
    const blocker = moveBlocker(doc, doc.activeLayerId);
    if (blocker) return this.notice(blocker);
    const [dx, dy] = alignOffset(doc, doc.activeLayerId, edge);
    this.exec(translateLayer(doc, doc.activeLayerId, dx, dy, 'Align'));
  }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
  }

  /** Modifier keys, for the temporary tools shown by the cursor (the click itself reads the event). */
  setModifiers(mods: { alt: boolean; ctrl: boolean }): void {
    if (mods.alt === this.modifiers.alt && mods.ctrl === this.modifiers.ctrl) return;
    this.modifiers = { ...mods };
    this.changed();
  }

  /** Alt turns the brush and pencil into the eyedropper; Ctrl/⌘ turns painting tools into Move (docs/03 §4). */
  private effectiveTool(mods: { alt: boolean; ctrl: boolean }): Tool {
    const t = this.tool;
    if (mods.ctrl && (isPaintTool(t) || t === 'eyedropper')) return 'move';
    if (mods.alt && (t === 'brush' || t === 'pencil')) return 'eyedropper';
    return t;
  }

  // ---- crop tool (FR-TRF-01) ---------------------------------------------------------------------

  private cropState(): EditorSnapshot['crop'] {
    if (this.tool !== 'crop' || !this.cropRect) return null;
    return {
      rect: this.cropRect,
      dragging: this.cropDrag?.kind === 'rect',
      line: this.cropDrag?.kind === 'line' ? this.cropDrag.line : null,
      hover: this.cropHover,
    };
  }

  private get cropRatio(): number | null {
    return this.doc ? ratioValue(this.toolOptions.crop.ratio, this.doc) : null;
  }

  /** Esc: the crop box covers the whole canvas again (with the ratio preset applied). */
  resetCrop(notify = true): void {
    const doc = this.doc;
    if (!doc) return;
    const full = { x: 0, y: 0, width: doc.width, height: doc.height };
    this.cropRect = fitRatio(full, this.cropRatio, doc);
    this.cropDrag = null;
    if (notify) this.changed();
  }

  /** Numeric entry or a ratio change: keeps the box inside the canvas and on the ratio. */
  setCropRect(rect: CropRect): void {
    if (!this.doc) return;
    this.cropRect = fitRatio(rect, this.cropRatio, this.doc);
    this.changed();
  }

  setCropRatio(ratio: CropRatio): void {
    this.setToolOptions('crop', { ratio });
    if (this.doc && this.cropRect) this.setCropRect(this.cropRect);
  }

  /** Enter: crops to the box (whole pixels). */
  commitCrop(): void {
    const doc = this.doc;
    if (!doc || !this.cropRect || this.busy) return;
    this.crop(roundRect(this.cropRect, doc), this.toolOptions.crop.deletePixels);
    this.resetCrop();
  }

  private beginCrop(e: PointerEvent): void {
    const doc = this.doc!;
    const p = this.docPoint(e);
    if (this.toolOptions.crop.straighten) {
      this.cropDrag = { kind: 'line', line: { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, pointerId: e.pointerId };
      return this.changed();
    }
    const rect = this.cropRect ?? { x: 0, y: 0, width: doc.width, height: doc.height };
    const handle = hitHandle(rect, p, 8 / this.viewport.zoom);
    this.cropDrag = { kind: 'rect', handle: handle ?? 'new', start: rect, from: p, pointerId: e.pointerId };
    this.changed();
  }

  private moveCrop(e: PointerEvent): void {
    const doc = this.doc;
    if (!doc) return;
    const p = this.docPoint(e);
    const drag = this.cropDrag;
    if (!drag || e.pointerId !== drag.pointerId) {
      // Hover: which handle a drag would grab (the cursor shows it).
      const hover = this.cropRect ? hitHandle(this.cropRect, p, 8 / this.viewport.zoom) : null;
      if (hover !== this.cropHover) {
        this.cropHover = hover;
        this.changed();
      }
      return;
    }
    if (drag.kind === 'line') {
      drag.line = { ...drag.line, x1: p.x, y1: p.y };
    } else if (drag.handle === 'new') {
      if (Math.hypot(p.x - drag.from.x, p.y - drag.from.y) * this.viewport.zoom < 3) return;
      this.cropRect = rectFromDrag(drag.from, p, this.cropRatio, doc);
    } else {
      this.cropRect = dragHandle(
        drag.start,
        drag.handle,
        p.x - drag.from.x,
        p.y - drag.from.y,
        this.cropRatio,
        doc,
      );
    }
    this.changed();
  }

  private endCrop(): void {
    const drag = this.cropDrag;
    this.cropDrag = null;
    if (drag?.kind === 'line') {
      const { x0, y0, x1, y1 } = drag.line;
      this.setToolOptions('crop', { straighten: false });
      // A click without a real line does nothing.
      if (Math.hypot(x1 - x0, y1 - y0) * this.viewport.zoom >= 10)
        void this.straighten(
          straightenAngle({ x: x0, y: y0 }, { x: x1, y: y1 }),
          this.toolOptions.crop.deletePixels,
        );
      return;
    }
    this.changed();
  }

  // ---- canvas geometry (FR-TRF-01..03) ----------------------------------------------------------

  /** Image › Image Rotation › 90° CW (1), 180° (2), 90° CCW (3). */
  rotateCanvas(turns: Turns): void {
    if (this.doc) this.exec(rotateCanvas(this.doc, turns));
  }

  flipCanvas(axis: 'horizontal' | 'vertical'): void {
    if (this.doc) this.exec(flipCanvas(this.doc, axis));
  }

  /** Image › Canvas Size. */
  resizeCanvas(width: number, height: number, anchor: Anchor): void {
    if (this.doc) this.exec(resizeCanvas(this.doc, width, height, anchor));
  }

  /** Crop tool commit. */
  crop(rect: CropRect, deletePixels: boolean): void {
    if (this.doc) this.exec(cropDocument(this.doc, rect, deletePixels));
  }

  /** Image › Image Size: resamples every layer (in the ops worker). */
  resizeImage(width: number, height: number, filter: ResampleFilter): Promise<void> {
    const doc = this.doc;
    if (!doc || (width === doc.width && height === doc.height)) return Promise.resolve();
    const sx = width / doc.width;
    const sy = height / doc.height;
    const g = doc.meta.guides;
    return this.runJob(
      'Image Size',
      { op: 'resample', layers: this.layerTiles(), src: this.size(), dst: { width, height }, filter },
      (grids) =>
        replacePixels('Image Size', grids, {
          width,
          height,
          guides: { horizontal: g.horizontal.map((y) => y * sy), vertical: g.vertical.map((x) => x * sx) },
        }),
    );
  }

  /** Image › Image Rotation › Arbitrary: clockwise degrees; the canvas grows to hold the rotated image. */
  rotateArbitrary(degrees: number): Promise<void> {
    const doc = this.doc;
    if (!doc || degrees % 360 === 0) return Promise.resolve();
    const dst = rotatedCanvasSize(doc.width, doc.height, degrees);
    const dx = (dst.width - doc.width) / 2;
    const dy = (dst.height - doc.height) / 2;
    const g = doc.meta.guides;
    return this.runJob(
      'Rotate Canvas',
      { op: 'rotate', layers: this.layerTiles(), src: this.size(), dst, degrees },
      (grids) =>
        replacePixels('Rotate Canvas', grids, {
          ...dst,
          guides: { horizontal: g.horizontal.map((y) => y + dy), vertical: g.vertical.map((x) => x + dx) },
        }),
    );
  }

  /**
   * Crop tool › Straighten: rotates by `degrees` and crops to the largest rectangle without transparent
   * corners, as one undo step.
   */
  straighten(degrees: number, deletePixels: boolean): Promise<void> {
    const doc = this.doc;
    if (!doc || Math.abs(degrees) < 0.01) return Promise.resolve();
    const dst = rotatedCanvasSize(doc.width, doc.height, degrees);
    const inner = inscribedSize(doc.width, doc.height, degrees);
    const ox = Math.round((dst.width - inner.width) / 2);
    const oy = Math.round((dst.height - inner.height) / 2);
    return this.runJob(
      'Straighten',
      { op: 'rotate', layers: this.layerTiles(), src: this.size(), dst, degrees },
      (grids) => {
        const range = tileRange(inner.width, inner.height);
        const cropped = new Map(
          [...grids].map(([id, grid]) => {
            const moved = translateGrid(grid, -ox, -oy, range);
            return [id, deletePixels ? clipGrid(moved, inner.width, inner.height) : moved] as const;
          }),
        );
        return replacePixels('Straighten', cropped, { ...inner, guides: { horizontal: [], vertical: [] } });
      },
    );
  }

  private size(): { width: number; height: number } {
    return { width: this.doc!.width, height: this.doc!.height };
  }

  /** Every raster layer's tiles as plain bytes for the ops worker (structured-cloned, never mutated). */
  private layerTiles(): LayerTiles[] {
    return this.doc!.allLayers().flatMap((l) => (l.type === 'raster' ? [fromGrid(l.id, l.tiles)] : []));
  }

  /**
   * Runs a pixel job, then turns its result into one command. Editing is blocked meanwhile; if the document
   * changed anyway (another document opened), the result is dropped.
   */
  private async runJob(
    label: string,
    job: OpsJob,
    command: (grids: Map<string, TileGrid>) => Command,
  ): Promise<void> {
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const doc = this.doc;
    const version = this.version;
    this.job = { label, progress: 0 };
    this.changed();
    const run =
      this.options.runOps ?? ((j: OpsJob, p: (v: number) => void) => Promise.resolve(runOpsJob(j, p)));
    try {
      const result = await run(job, (progress) => {
        this.job = { label, progress };
        this.changed();
      });
      this.job = null;
      if (this.doc !== doc || this.version !== version)
        return this.notice(`${label} was cancelled because the document changed.`);
      this.exec(command(new Map(result.map((l) => [l.id, toGrid(l.tiles)]))));
    } catch (err) {
      this.job = null;
      this.notice(err instanceof Error ? err.message : `${label} failed.`);
    } finally {
      this.changed();
    }
  }

  // ---- view ------------------------------------------------------------------------------------

  private cssSize(): { width: number; height: number } {
    return { width: this.canvas.clientWidth || 1, height: this.canvas.clientHeight || 1 };
  }

  fitToScreen(): void {
    if (!this.doc) return;
    const { width, height } = this.cssSize();
    this.viewport.fit(this.doc.width, this.doc.height, width, height);
    this.shownSize = { width: this.doc.width, height: this.doc.height };
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

  /** Zoom In (+1) / Zoom Out (−1) to the next preset step (FR-NAV-01), keeping the view centre. */
  zoomStep(dir: 1 | -1): void {
    this.zoomTo(nextZoomStep(this.viewport.zoom, dir));
  }

  /** View › Pixel Grid. */
  togglePixelGrid(): void {
    this.pixelGrid = !this.pixelGrid;
    this.changed();
  }

  /** Scrollbars: pans so the canvas's view starts at (panX, panY) CSS px. */
  panTo(panX: number, panY: number): void {
    if (!this.doc) return;
    this.viewport.panX = panX;
    this.viewport.panY = panY;
    this.autoFit = false;
    this.requestRender();
  }

  /** Zoom, pan and canvas size for overlays (scrollbars, crop box); updated every frame it changes. */
  subscribeView = (listener: () => void): (() => void) => {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  };

  getView = (): ViewState => this.view;

  // ---- history limits and snapshots (FR-HIS-01/02) ----------------------------------------------

  /** Preferences › Memory budget for history and snapshots (bytes). */
  setMemoryBudget(bytes: number): void {
    this.historyBytes = Math.max(256 * 1024 ** 2, bytes);
    this.history?.setLimits({ maxBytes: this.historyBytes });
    this.changed();
  }

  /** Colour around the canvas (FR-GEN-02): the theme's neutral grey or a chosen one. */
  setCanvasColor(rgb: [number, number, number]): void {
    this.surround = rgb;
    this.compositor.surround = rgb;
    this.requestRender();
  }

  /** Preferences › History steps (20…1000). */
  setHistoryLimit(steps: number): void {
    this.historySteps = Math.min(1000, Math.max(20, Math.round(steps)));
    this.history?.setLimits({ maxSteps: this.historySteps });
  }

  /** History › New Snapshot: the current state, named "Snapshot n". */
  takeSnapshot(): void {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const n = this.snapshots.filter((s) => s.name.startsWith('Snapshot ')).length + 1;
    this.snapshots = [
      ...this.snapshots,
      { id: `S${++this.snapshotSeq}`, name: `Snapshot ${n}`, state: captureState(doc) },
    ];
    this.changed();
  }

  /** Clicking a snapshot: returns the document to it as a new, undoable step. */
  restoreSnapshot(id: string): void {
    const snap = this.snapshots.find((s) => s.id === id);
    if (snap) this.exec(restoreState(snap.state, `Restore ${snap.name}`));
  }

  deleteSnapshot(id: string): void {
    this.snapshots = this.snapshots.filter((s) => s.id !== id);
    this.changed();
  }

  /** Bytes of distinct tiles in the document and snapshots, plus what history holds on its own. */
  private memoryUsed(): number {
    const ids = new Set<number>();
    if (this.doc) collectTileIds(this.doc.layers, ids);
    for (const s of this.snapshots) collectTileIds(s.state.layers, ids);
    return ids.size * TILE_BYTES + (this.history?.sizeBytes ?? 0);
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
    if (this.job) return this.notice(`Wait for ${this.job.label} to finish.`);
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || this.tool === 'hand' || this.spaceHeld) {
      this.pan = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      return;
    }
    if (e.button !== 0) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const tool = this.effectiveTool({ alt: e.altKey, ctrl });
    if (tool === 'zoom') {
      const rect = this.canvas.getBoundingClientRect();
      const z = this.viewport.zoom;
      const target = nextZoomStep(z, e.altKey ? -1 : 1);
      this.viewport.zoomAt(target / z, e.clientX - rect.left, e.clientY - rect.top);
      this.autoFit = false;
      this.changed();
      return;
    }
    if (tool === 'move') return this.beginMove(e, this.tool === 'move' && ctrl);
    if (tool === 'crop') return this.beginCrop(e);
    if (tool === 'eyedropper') {
      this.sampling = {
        pointerId: e.pointerId,
        target: this.tool === 'eyedropper' && e.altKey ? 'background' : 'foreground',
      };
      this.sample(e);
      return;
    }
    if (!isPaintTool(tool)) return;
    const layer = this.doc.activeLayer;
    if (this.gl.isContextLost()) return; // no GPU: nothing to paint with
    if (layer.type !== 'raster') return this.notice('Select a layer to paint on (groups have no pixels).');
    if (!layer.visible) return this.notice('This layer is hidden. Show it to paint on it.');
    if (layer.locks.all || layer.locks.pixels) return this.notice('This layer is locked.');
    const settings = this.strokeSettings(tool, layer.locks.transparency);
    const generator = new DabGenerator(settings);
    const smoother = new PulledString((settings.smoothing * SMOOTHING_SCREEN_PX) / this.viewport.zoom);
    const start = this.docPoint(e);
    this.stroke = {
      layerId: layer.id,
      tool,
      settings,
      generator,
      smoother,
      last: start,
      pointerId: e.pointerId,
    };
    this.strokeBuffer.clear();
    this.strokeBuffer.hardness = settings.hardness;
    this.strokeBuffer.aliased = settings.aliased;
    this.addDabs(generator.begin(smoother.begin(start)), e.timeStamp);
  }

  /**
   * What a stroke with `tool` paints. The eraser on a layer with locked transparency paints the background
   * colour instead (FR-PNT-02, as on Photoshop's Background layer).
   */
  private strokeSettings(tool: PaintTool, transparencyLocked: boolean): BrushSettings {
    const o = this.toolOptions;
    const { foreground, background } = this.colors;
    if (tool === 'eraser') {
      const { pencil, ...rest } = o.eraser;
      return {
        ...rest,
        aliased: pencil,
        mode: transparencyLocked ? 'paint' : 'erase',
        color: transparencyLocked ? background : foreground,
      };
    }
    return { ...o[tool], aliased: tool === 'pencil', mode: 'paint', color: foreground };
  }

  private beginMove(e: PointerEvent, toggleAutoSelect: boolean): void {
    const doc = this.doc!;
    const p = this.docPoint(e);
    const { autoSelect, autoSelectMode } = this.toolOptions.move;
    if (autoSelect !== toggleAutoSelect) {
      const hit = layerAt(doc, p.x, p.y, autoSelectMode);
      if (hit && hit !== doc.activeLayerId) this.setActiveLayer(hit);
    }
    const id = doc.activeLayerId;
    const blocker = moveBlocker(doc, id);
    if (blocker) return this.notice(blocker);
    this.moving = {
      layerId: id,
      rasterIds: new Set(movedRasters(doc, id).map((l) => l.id)),
      start: { x: p.x, y: p.y },
      dx: 0,
      dy: 0,
      pointerId: e.pointerId,
    };
  }

  private sample(e: PointerEvent): void {
    if (!this.doc || !this.sampling) return;
    const p = this.docPoint(e);
    const { size, source } = this.toolOptions.eyedropper;
    const color = sampleColor(this.doc, p.x, p.y, size, source);
    if (!color) return;
    if (this.sampling.target === 'background') this.setBackground(color);
    else this.setForeground(color);
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
    if (this.moving && e.pointerId === this.moving.pointerId) {
      const p = this.docPoint(e);
      let dx = Math.round(p.x - this.moving.start.x);
      let dy = Math.round(p.y - this.moving.start.y);
      if (e.shiftKey) {
        // Shift constrains the move to horizontal or vertical.
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (dx !== this.moving.dx || dy !== this.moving.dy) {
        this.moving = { ...this.moving, dx, dy };
        this.requestRender(e.timeStamp);
      }
      return;
    }
    if (this.sampling && e.pointerId === this.sampling.pointerId) return this.sample(e);
    if (this.tool === 'crop') return this.moveCrop(e);
    const stroke = this.stroke;
    if (!stroke || e.pointerId !== stroke.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const dabs: Dab[] = [];
    for (const ev of events.length ? events : [e]) {
      stroke.last = this.docPoint(ev);
      const p = stroke.smoother.move(stroke.last);
      if (p) dabs.push(...stroke.generator.moveTo(p));
    }
    this.addDabs(dabs, e.timeStamp);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pan && e.pointerId === this.pan.pointerId) {
      this.pan = null;
      this.changed();
    }
    if (this.sampling && e.pointerId === this.sampling.pointerId) this.sampling = null;
    if (this.cropDrag && e.pointerId === this.cropDrag.pointerId) this.endCrop();
    if (this.moving && e.pointerId === this.moving.pointerId) {
      const { layerId, dx, dy } = this.moving;
      this.moving = null;
      if (this.doc && (dx !== 0 || dy !== 0)) this.exec(translateLayer(this.doc, layerId, dx, dy));
      else this.requestRender();
    }
    if (this.stroke && e.pointerId === this.stroke.pointerId) {
      // Catch up with the pointer so a smoothed stroke ends where it was released.
      this.addDabs(this.stroke.generator.moveTo(this.stroke.last), e.timeStamp);
      this.commitStroke();
    }
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
    const x = p ? Math.floor(p.x) : 0;
    const y = p ? Math.floor(p.y) : 0;
    if (p && x === this.cursor?.x && y === this.cursor?.y) return;
    if (!p && !this.cursor) return;
    const next = p ? { x, y, color: this.colorAt(x, y) } : null;
    this.cursor = next;
    this.snapshot = { ...this.snapshot, cursor: next };
    for (const l of this.listeners) l();
  }

  /** Composite colour of one document pixel (status bar, FR-NAV-06), or null outside/transparent. */
  private colorAt(x: number, y: number): string | null {
    const doc = this.doc;
    if (!doc || x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
    const [r, g, b, a] = compositePixel(liveLayers(doc.layers), x, y);
    if (a === 0) return null;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
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
      if (stroke.tool !== 'eraser') this.addRecent(stroke.settings.color);
      const label = { brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser' }[stroke.tool];
      this.history.execute(new PaintTilesCommand(label, layer.id, before, after));
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
    const move = this.moving
      ? { layerIds: this.moving.rasterIds, dx: this.moving.dx, dy: this.moving.dy }
      : undefined;
    this.compositor.render(
      this.doc,
      this.viewport,
      { cssWidth, cssHeight, width, height, dpr },
      preview,
      move,
      { pixelGrid: this.pixelGrid },
    );
    // Overlays (scrollbars, crop box) follow pans and zooms through the separate view store.
    const { zoom, panX, panY } = this.viewport;
    const v = this.view;
    if (
      v.zoom !== zoom ||
      v.panX !== panX ||
      v.panY !== panY ||
      v.width !== cssWidth ||
      v.height !== cssHeight
    ) {
      this.view = { zoom, panX, panY, width: cssWidth, height: cssHeight };
      for (const l of this.viewListeners) l();
    }
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
  // Order-independent hash of (position, tile id) pairs: a tile moved to another position changes it too.
  let sum = 0;
  let xor = 0;
  for (const [key, tile] of layer.tiles.entries()) {
    let h = tile.id;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    sum = (sum + h) | 0;
    xor ^= h;
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
