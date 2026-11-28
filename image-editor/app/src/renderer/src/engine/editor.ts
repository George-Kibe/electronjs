import { tileRange } from '@shared/iep-schema';
import {
  accumulateDabs,
  applyMaskStroke,
  applySelectionStroke,
  applyStroke,
  DabGenerator,
  DEFAULT_BRUSH,
  PulledString,
  type BrushPoint,
  type BrushSettings,
  type Dab,
} from './brush/brush';
import { cloneTile, type CloneSource } from './brush/clone';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  PaintTilesCommand,
  SetActiveLayerCommand,
  SetLayerPropsCommand,
  ApplyLayerMaskCommand,
  SetAdjustmentCommand,
  SetGuidesCommand,
  SetLayerMaskCommand,
  SetSelectionCommand,
  type Command,
} from './doc/commands';
import {
  createAdjustmentLayer,
  createGroupLayer,
  createRasterLayer,
  Document,
  type RasterLayer as RasterLayerOf,
  type BlendMode,
  type Layer,
  type LayerLocks,
  type LayerProps,
} from './doc/document';
import { compositePixel, compositeTile, liveLayers, flattenPreview } from './doc/flatten';
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
  ellipseMask,
  Mask,
  maskTile,
  polygonMask,
  rectMask,
  type Bounds,
  type MaskTile as MaskTileOf,
  type Point,
  type SelectionOp,
} from './doc/selection';
import { selectionOutline } from './doc/selection-outline';
import {
  alignOffset,
  layerAt,
  moveBlocker,
  movedRasters,
  translateGrid,
  translateLayer,
  translateMoves,
  type AlignEdge,
} from './doc/translate';
import { alignLayers, deleteLayers, distributeLayers, groupLayers, topSelected } from './doc/multi';
import {
  floatingPreview,
  gridToSelection,
  liftedId,
  selectionToGrid,
  splitBySelection,
  type Floating,
} from './doc/float';
import { fromSnapshot, layerToSnapshot, toSnapshot, type DocSnapshot } from './io/snapshot';
import { Compositor } from './gpu/compositor';
import { StrokeBuffer } from './gpu/stroke-buffer';
import {
  cropDocument,
  flipCanvas,
  replacePixels,
  resizeCanvas,
  rotateCanvas,
  replaceLayers,
  type Anchor,
  type CropRect,
} from './doc/geometry';
import { History, type HistoryEntry } from './history/history';
import { captureState, collectTileIds, restoreState, type DocState } from './history/snapshots';
import { TileVault, type SpillStore } from './history/spill';
import { clipGrid, contentBounds, type Turns } from './ops/canvas';
import { invert, isIdentity, snapExact, type Affine } from './ops/affine';
import {
  dragTransform,
  hitTransform,
  NO_TRANSFORM,
  transformedHandles,
  transformMatrix,
  type Box,
  type TransformHandle,
  type TransformHit,
  type TransformParams,
} from './tools/transform';
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
import {
  DEFAULT_MARQUEE,
  dragMode,
  marqueeLabel,
  marqueeRect,
  type MarqueeOptions,
  type MarqueeShape,
} from './tools/marquee';
import {
  addPoint,
  closesPolygon,
  DEFAULT_LASSO,
  lassoLabel,
  lassoOutline,
  type LassoKind,
  type LassoOptions,
} from './tools/lasso';
import { fromGrid, runOpsJob, toGrid, type LayerTiles, type OpsJob } from './ops/jobs';
import type { WandOptions } from './ops/wand';
import { presetStops, type GradientPreset, type GradientType } from './ops/gradient';
import {
  ADJUSTMENT_LABELS,
  defaultAdjustment,
  isNeutral,
  type Adjustment,
  type AdjustmentKind,
  type AdjustmentOf,
} from './ops/adjust';
import { autoLevels, unpackHistogram, type Histogram } from './ops/histogram';
import { defaultFilter, FILTER_LABELS, hasSettings, type Filter, type FilterKind } from './ops/filters';
import { snapOffset, snapTargets, type SnapTargets } from './tools/snap';
import type { ModifyOp } from './ops/modify';
import type { TrimBasis } from './ops/trim';
import { inscribedSize, rotatedCanvasSize, type ResampleFilter } from './ops/resample';
import { nextZoomStep, Viewport } from './render/viewport';
import {
  createTile,
  parseTileKey,
  TILE_BYTES,
  TILE_SIZE,
  TileGrid,
  tileKeysInRect,
  type Tile,
  type TileKey,
} from './tiles/tile';

export type Tool =
  | 'move'
  | 'marquee'
  | 'lasso'
  | 'wand'
  | 'crop'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'eyedropper'
  | 'bucket'
  | 'gradient'
  | 'clone'
  | 'hand'
  | 'zoom';
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
  | 'blendMode'
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
  /** Rectangular / Elliptical Marquee (FR-SEL-01/04). */
  marquee: MarqueeOptions;
  /** Lasso / Polygonal Lasso (FR-SEL-02). */
  lasso: LassoOptions;
  /** Magic Wand (FR-SEL-03): tolerance, contiguous, anti-alias, and sampling the active layer or all. */
  wand: WandOptions & { mode: SelectionOp; sampleAll: boolean };
  /** Paint Bucket (FR-PNT-03): the Magic Wand's options, for the region it fills. */
  bucket: WandOptions & { sampleAll: boolean };
  /**
   * Clone Stamp (FR-PNT-05): a brush, plus Aligned (the offset to the source stays between strokes) and
   * sampling the active layer or all layers.
   */
  clone: BrushOptions & { aligned: boolean; sampleAll: boolean };
  /** Gradient (FR-PNT-04): geometry, colours (a preset of the current colours), opacity, mode, dither. */
  gradient: {
    type: GradientType;
    preset: GradientPreset;
    opacity: number;
    mode: BlendMode;
    dither: boolean;
    reverse: boolean;
  };
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
  blendMode: DEFAULT_BRUSH.blendMode,
  ...o,
});

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  brush: brushDefaults({ smoothing: 0.1 }),
  pencil: brushDefaults({ size: 1, hardness: 1, spacing: 0.25 }),
  eraser: { ...brushDefaults(), pencil: false },
  eyedropper: { size: 1, source: 'all' },
  move: { autoSelect: false, autoSelectMode: 'layer' },
  crop: { ratio: 'free', deletePixels: true, straighten: false },
  marquee: DEFAULT_MARQUEE,
  lasso: DEFAULT_LASSO,
  wand: { tolerance: 32, contiguous: true, antiAlias: true, sampleAll: false, mode: 'replace' },
  bucket: { tolerance: 32, contiguous: true, antiAlias: true, sampleAll: false },
  gradient: { type: 'linear', preset: 'fg-bg', opacity: 1, mode: 'normal', dither: true, reverse: false },
  clone: { ...brushDefaults(), aligned: true, sampleAll: false },
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
    /** Pixels per inch (rulers in inches and centimetres). */
    ppi: number;
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
  /** diskBytes: history in the scratch file (FR-HIS-03); spilling: being written there now. */
  memory: { usedBytes: number; budgetBytes: number; diskBytes: number; spilling: boolean };
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
  /** The selection's outline for the marching ants (doc px SVG path) and its bounds; null = none. */
  selection: { outline: string; bounds: Bounds } | null;
  /** A marquee being dragged: the shape it will add (doc px), before it becomes a selection. */
  marquee: { shape: MarqueeShape; rect: Bounds } | null;
  /** The Gradient tool's line being dragged, in document px. */
  gradientLine: { start: { x: number; y: number }; end: { x: number; y: number } } | null;
  /** The Clone Stamp's source (Alt-click), or where it samples during a stroke, in document px. */
  cloneSource: { x: number; y: number } | null;
  /** A lasso outline being drawn (doc px), and for the polygonal lasso the pointer's position. */
  lasso: { kind: LassoKind; points: Point[]; hover: Point | null } | null;
  /** Select › Reselect has something to bring back. */
  canReselect: boolean;
  /** Painting tools edit the active layer's mask, not its pixels (FR-LAY-04). */
  editingMask: boolean;
  /** Quick Mask mode (Q, FR-SEL-06): the selection shows as red and painting tools edit it. */
  quickMask: boolean;
  /** Layers selected in the Layers panel (FR-LAY-08), including the active one. */
  selectedLayerIds: string[];
  /** The active layer's adjustment, when it is an adjustment layer (the Properties panel, FR-ADJ-01). */
  activeAdjustment: { id: string; adjustment: Adjustment } | null;
  /** Filter › … open for the active layer (FR-FLT-01); `updating` while its preview is computed. */
  filtering: { layerId: string; filter: Filter; preview: boolean; updating: boolean } | null;
  /** Filter › Last Filter (Ctrl+Alt+F) has something to repeat. */
  canRepeatFilter: boolean;
  /** View › Rulers / Guides / Lock Guides / Snap (FR-NAV-04). */
  view: { rulers: boolean; guides: boolean; guidesLocked: boolean; snap: boolean; grid: boolean };
  /** Guides, document px (FR-NAV-04). */
  guides: { horizontal: number[]; vertical: number[] };
  /** A guide being dragged (a new one, or a moved one), document px. */
  guideDrag: { orientation: GuideOrientation; position: number; index: number | null } | null;
  /** The Move tool is over a guide (the cursor shows it can be dragged). */
  guideHover: GuideOrientation | null;
  /** Changes with every document change (the Histogram panel recomputes when it does). */
  docVersion: number;
  /** Image › Adjustments open for the active layer (destructive, FR-ADJ-01): its settings and preview. */
  adjusting: { layerId: string; adjustment: Adjustment; preview: boolean } | null;
  /** Free Transform (Ctrl+T, FR-TRF-04): where the box's handles are (document px) and its parameters. */
  transform: {
    box: Box;
    params: TransformParams;
    handles: Record<TransformHandle, [number, number]>;
    hover: TransformHit | null;
    dragging: boolean;
  } | null;
  options: ToolOptions;
  colors: Colors;
  /** Document pixel under the pointer and the composite colour there (#RRGGBB, null if transparent). */
  cursor: { x: number; y: number; color: string | null } | null;
  /** A pixel job running in the ops worker (Image Size, rotation); editing waits until it ends. */
  /** A long operation; progress null = unknown (reading history back from disk). */
  job: { label: string; progress: number | null } | null;
  gpu: string;
};

export type LayerRow = {
  id: string;
  type: 'raster' | 'group' | 'adjustment';
  /** An adjustment layer's kind (FR-ADJ-01), for its icon and the Properties panel. */
  adjustment: AdjustmentKind | null;
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
  /** Clipped to the layer below (FR-LAY-05). */
  clipped: boolean;
  /** The layer mask (FR-LAY-04): its state and a key that changes with its contents (for its thumbnail). */
  mask: { enabled: boolean; linked: boolean; key: string } | null;
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
  /** Painting the layer mask toward `value` (0..255) instead of the pixels (FR-LAY-04). */
  mask: { value: number } | null;
  /** Quick Mask: painting the selection toward `value` (0..255; FR-SEL-06). */
  quick: { value: number } | null;
};

type ActiveMove = {
  layerId: string;
  /** Every selected layer that moves (FR-LAY-08); `layerId` is the active one. */
  layerIds: string[];
  rasterIds: ReadonlySet<string>;
  start: { x: number; y: number };
  dx: number;
  dy: number;
  pointerId: number;
};

/** What Free Transform acts on (Ctrl+T, FR-TRF-04). */
type TransformTarget = {
  /** The layers being transformed (groups cover their children). */
  layerIds: string[];
  /** Their raster layers. */
  rasterIds: ReadonlySet<string>;
  /** The content bounds the handles start on, document px. */
  box: Box;
  /**
   * Transforming a selection: each layer's selected pixels (lifted) and the rest, the selection itself, and
   * a preview document that draws the lifted parts (`liftedIds`) through the matrix.
   */
  floating: {
    parts: ReadonlyMap<string, Floating>;
    selection: Mask;
    preview: Document;
    liftedIds: ReadonlySet<string>;
  } | null;
};

/** Free Transform in progress. */
type ActiveTransform = TransformTarget & {
  params: TransformParams;
  drag: { pointerId: number; hit: TransformHit; start: TransformParams; from: [number, number] } | null;
  hover: TransformHit | null;
};

/** What the canvas draws for a transform: these layers through the matrix, in `doc` if not the document. */
type TransformShown = { layerIds: ReadonlySet<string>; matrix: Affine; doc: Document | null };

/** The id of the selection in a transform job's layers (the app's layer ids never start with '#'). */
const SELECTION_JOB_ID = '#selection';

export type GuideOrientation = 'horizontal' | 'vertical';

/** How close (screen px) things snap, and a press must be to grab a guide (FR-NAV-04). */
const SNAP_PX = 8;
const GUIDE_GRAB_PX = 4;

/** What a histogram measures (FR-ADJ-03): the image as shown, the active layer, or what is below a layer. */
export type HistogramSource = 'image' | 'layer' | { below: string };

/** How close (screen px) a press must be to grab a Free Transform handle. */
const TRANSFORM_HANDLE_SLOP = 8;

/** Everything needed to continue editing on a fresh canvas (CPU state only; GPU state is rebuilt). */
export type EditorState = {
  doc: Document | null;
  history: History | null;
  file: {
    ref: DocumentFile | null;
    isProject: boolean;
    readOnlyReason: string | null;
    savedTop: Command | null;
    /**
     * Arrived without its history (a recovery snapshot, or moved from another window) with unsaved
     * changes: unsaved until saved, whatever the history says.
     */
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
  /**
   * The window's history scratch file (FR-HIS-03): history beyond the memory budget spills there. Without
   * one, the oldest steps are dropped instead.
   */
  spillStore?: SpillStore;
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
  private transform: ActiveTransform | null = null;
  /** Image › Adjustments in progress: the dialog's settings and the selection as a mask, built once. */
  private adjusting: {
    layerId: string;
    adjustment: Adjustment;
    preview: boolean;
    mask: RasterLayerOf['mask'];
  } | null = null;
  /** Drawn instead of the document while a destructive adjustment is previewed or being applied. */
  private adjustPreview: Document | null = null;
  /** Filter › … in progress (FR-FLT-01): the dialog's settings, and the preview of the tiles in view. */
  private filtering: {
    layerId: string;
    filter: Filter;
    preview: boolean;
    /** Bumped by every change; a preview computed for an older one is dropped. */
    seq: number;
    running: boolean;
    timer: number;
  } | null = null;
  private filterPreview: Document | null = null;
  /** Filter › Last Filter (Ctrl+Alt+F) repeats this. */
  private lastFilter: Filter | null = null;
  /** View › Rulers, Guides, Lock Guides, Snap (FR-NAV-04); view state, not undo steps. */
  private viewFlags = { rulers: false, guides: true, guidesLocked: false, snap: true, grid: false };
  /** The grid's spacing and subdivisions (px), from the preferences; snapping uses its lines when shown. */
  private grid = { spacing: 100, subdivisions: 4 };
  /**
   * A guide being dragged: a new one from a ruler (index null) or an existing one with the Move tool. The
   * position is in document px, snapped; NaN while the pointer is still over the ruler.
   */
  private guideDrag: {
    orientation: GuideOrientation;
    index: number | null;
    position: number;
    pointerId: number | null;
    targets: SnapTargets | null;
  } | null = null;
  /** The guide under the pointer (Move tool), for the cursor. */
  private guideHover: GuideOrientation | null = null;
  /** Snapping for the current Move-tool drag: the moved content's bounds and what it can snap to. */
  private moveSnap: { bounds: Bounds; targets: SnapTargets } | null = null;
  /** A committed transform, still drawn until its job replaces the pixels. */
  private transformPreview: TransformShown | null = null;
  private sampling: { pointerId: number; target: 'foreground' | 'background' } | null = null;
  private pan: { x: number; y: number; pointerId: number } | null = null;
  private spaceHeld = false;
  private modifiers = { alt: false, ctrl: false };
  private lastNudge = 0;
  private job: { label: string; progress: number } | null = null;
  private readonly vault: TileVault | null;
  /** History has been reading spilled tiles back for over 100 ms: the status bar says so. */
  private historyLoadingShown = false;
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
  private gradientDrag: {
    pointerId: number;
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null = null;
  private lastFillTool: 'bucket' | 'gradient' = 'bucket';
  /** Clone Stamp (FR-PNT-05): the Alt-clicked source, and the offset kept between strokes when aligned. */
  private cloneFrom: { x: number; y: number } | null = null;
  private cloneOffset: { dx: number; dy: number } | null = null;
  private cloneStroke: {
    pointerId: number;
    layerId: string;
    settings: BrushSettings;
    generator: DabGenerator;
    smoother: PulledString;
    offset: { dx: number; dy: number };
    source: CloneSource;
    preserveAlpha: boolean;
    coverage: Map<TileKey, Float32Array>;
    /** The layer's tiles as the stroke began, and the stroke's result so far. */
    before: Map<TileKey, Tile | undefined>;
    after: Map<TileKey, Tile | undefined>;
    last: { x: number; y: number };
  } | null = null;
  /** The document with the clone stroke so far (shown instead of the document while painting). */
  private clonePreview: Document | null = null;
  private marqueeDrag: {
    pointerId: number;
    start: { x: number; y: number };
    current: { x: number; y: number };
    op: SelectionOp;
    shape: MarqueeShape;
    /** Shift/Alt held at mouse-down choose the mode; pressed again later they constrain / centre. */
    shiftFree: boolean;
    altFree: boolean;
    constrain: boolean;
    fromCentre: boolean;
  } | null = null;
  private lassoDraw: {
    kind: LassoKind;
    op: SelectionOp;
    points: Point[];
    hover: Point | null;
    /** Freehand: the drawing pointer (released = done). Polygon: null between clicks. */
    pointerId: number | null;
  } | null = null;
  /** Outline of the current selection, recomputed only when the mask changes. */
  private outline: { mask: Mask; path: string } | null = null;
  /** Painting goes to the active layer's mask (its thumbnail was clicked; FR-LAY-04). */
  private editingMask = false;
  /** Quick Mask mode (FR-SEL-06). */
  private quickMask = false;
  /** Other layers selected with the active one, per document (FR-LAY-08). */
  private readonly layerSelection = new WeakMap<Document, Set<string>>();
  /** The last selection removed by Deselect, per document (Select › Reselect). */
  private readonly lastSelection = new WeakMap<Document, Mask>();
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
  /** Adjustment changes waiting for their frame (NFR-PERF-04: 'adjust-latency'). */
  private pendingAdjustTimes: number[] = [];
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
    this.vault = options.spillStore ? new TileVault(options.spillStore) : null;
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
    // A double-click closes a polygonal lasso (its second click added a duplicate vertex, dropped on close).
    canvas.addEventListener('dblclick', () => this.lassoDraw?.kind === 'polygon' && this.finishLasso(), {
      signal,
    });
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

  /**
   * Shows a document moved here from another window (FR-DOC-03): same id (recovery continues), same file
   * and save state. Its history stays behind.
   */
  openMoved(
    snapshot: DocSnapshot,
    meta: {
      id: string;
      name: string;
      file: DocumentFile | null;
      isProject: boolean;
      dirty: boolean;
      readOnlyReason: string | null;
    },
  ): void {
    const doc = fromSnapshot(snapshot);
    doc.meta.name = meta.name;
    this.open(
      doc,
      { ref: meta.file, isProject: meta.isProject, readOnlyReason: meta.readOnlyReason },
      meta.id,
    );
    if (meta.dirty) this.file = { ...this.file, recovered: true };
    this.changed();
  }

  /** Name, file and save state of any open document (moving it to another window). */
  describeDocument(id: string) {
    const active = id === this.docId;
    const s = active ? null : this.background.get(id);
    const doc = active ? this.doc : s?.doc;
    if (!doc) return null;
    const file = active ? this.file : s!.file;
    return {
      id,
      name: doc.meta.name,
      file: file.ref,
      isProject: file.isProject,
      dirty: sessionDirty(active ? this.history : s!.history, file),
      readOnlyReason: file.readOnlyReason,
    };
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
    this.transform = null;
    this.adjusting = null;
    this.adjustPreview = null;
    if (this.filtering) window.clearTimeout(this.filtering.timer);
    this.filtering = null;
    this.filterPreview = null;
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
    if (this.history) this.bindHistory(this.history);
    Object.assign(this.viewport, { zoom: state.view.zoom, panX: state.view.panX, panY: state.view.panY });
    this.autoFit = state.view.autoFit;
    this.tool = state.tool;
    this.toolOptions = state.options;
    this.colors = state.colors;
    this.snapshots = state.snapshots;
    this.docId = state.docId;
    this.background.clear();
    for (const s of state.background) {
      this.bindHistory(s.history);
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
    this.transform = null;
    this.adjusting = null;
    this.adjustPreview = null;
    if (this.filtering) window.clearTimeout(this.filtering.timer);
    this.filtering = null;
    this.filterPreview = null;
    this.strokeBuffer.clear();
    this.doc = doc;
    this.history = new History(
      doc,
      { maxSteps: this.historySteps, maxBytes: this.historyBytes },
      () => this.onHistoryChange(),
      this.vault && { vault: this.vault },
    );
    this.bindHistory(this.history);
    // The document as opened is always reachable, however many steps are dropped (FR-HIS-02).
    this.snapshots = [{ id: `S${++this.snapshotSeq}`, name: doc.meta.name, state: captureState(doc) }];
    this.file = { ...file, savedTop: null };
    this.version++;
    this.fitToScreen();
  }

  /** Points a history's callbacks at this Editor (new documents, and adopted ones after a GPU reset). */
  private bindHistory(history: History): void {
    history.onChange = () => this.onHistoryChange();
    // A spill changes memory, not pixels: refresh the panels without a new document version (which would
    // make a running job drop its result as stale).
    history.onStatus = () => this.changed();
    history.onError = (m) => this.notice(m);
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
            ppi: doc.meta.ppi,
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
      memory: {
        usedBytes: this.memoryUsed(),
        budgetBytes: this.historyBytes,
        diskBytes: this.options.spillStore?.bytesOnDisk ?? 0,
        spilling: this.history?.spillRunning ?? false,
      },
      pixelGrid: this.pixelGrid,
      zoom: this.viewport.zoom,
      tool: this.tool,
      activeTool: this.effectiveTool(this.modifiers),
      crop: this.cropState(),
      // While selected pixels float, the box shows where they go instead of the marching ants.
      selection: this.transformShown()?.doc ? null : this.selectionState(),
      marquee: this.marqueeState(),
      gradientLine: this.gradientDrag && { start: this.gradientDrag.start, end: this.gradientDrag.end },
      cloneSource: this.cloneSourceShown(),
      lasso: this.lassoDraw
        ? { kind: this.lassoDraw.kind, points: [...this.lassoDraw.points], hover: this.lassoDraw.hover }
        : null,
      canReselect: doc !== null && !doc.selection && this.lastSelection.has(doc),
      editingMask:
        doc !== null &&
        doc.activeLayer.type !== 'group' &&
        Boolean(doc.activeLayer.mask) &&
        (this.editingMask || doc.activeLayer.type === 'adjustment'),
      quickMask: this.quickMask && doc !== null,
      selectedLayerIds: doc ? this.selectedIds() : [],
      activeAdjustment: this.activeAdjustment,
      docVersion: this.version,
      view: { ...this.viewFlags },
      guides: doc ? doc.meta.guides : { horizontal: [], vertical: [] },
      guideDrag: this.guideDrag && {
        orientation: this.guideDrag.orientation,
        position: this.guideDrag.position,
        index: this.guideDrag.index,
      },
      guideHover: this.guideHover,
      filtering: this.filtering && {
        layerId: this.filtering.layerId,
        filter: this.filtering.filter,
        preview: this.filtering.preview,
        updating: this.filtering.running || this.filtering.timer !== 0,
      },
      canRepeatFilter: this.lastFilter !== null,
      adjusting: this.adjusting && {
        layerId: this.adjusting.layerId,
        adjustment: this.adjusting.adjustment,
        preview: this.adjusting.preview,
      },
      transform: this.transform && {
        box: this.transform.box,
        params: this.transform.params,
        handles: transformedHandles(this.transform.box, this.transform.params),
        hover: this.transform.hover,
        dragging: this.transform.drag !== null,
      },
      options: this.toolOptions,
      colors: this.colors,
      cursor: this.cursor,
      job:
        this.job ??
        (this.history?.loading && this.historyLoadingShown
          ? { label: 'Reading history back', progress: null }
          : null),
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
    return (
      this.stroke !== null ||
      this.moving !== null ||
      this.transform !== null ||
      this.adjusting !== null ||
      this.filtering !== null ||
      this.job !== null ||
      this.history?.loading === true ||
      this.marqueeDrag !== null ||
      this.gradientDrag !== null ||
      this.cloneStroke !== null ||
      this.lassoDraw?.pointerId != null
    );
  }

  undo(): void {
    // Undo during Free Transform leaves it without changes (the layers are untouched until it is applied).
    if (this.transform && !this.transform.drag) return this.cancelTransform();
    if (this.adjusting) return this.cancelAdjustment();
    if (this.filtering) return this.cancelFilter();
    if (!this.busy) this.history?.undo();
    this.whileHistoryLoads();
  }

  redo(): void {
    if (!this.busy) this.history?.redo();
    this.whileHistoryLoads();
  }

  goToHistory(index: number): void {
    if (!this.busy) this.history?.goTo(index);
    this.whileHistoryLoads();
  }

  /** An undo or redo is reading spilled tiles back: say so in the status bar if it takes over 100 ms. */
  private whileHistoryLoads(): void {
    const history = this.history;
    if (!history?.loading) return;
    const timer = window.setTimeout(() => {
      if (!history.loading) return;
      this.historyLoadingShown = true;
      this.changed();
    }, 100);
    void history.idle().then(() => {
      window.clearTimeout(timer);
      if (!this.historyLoadingShown) return;
      this.historyLoadingShown = false;
      this.changed();
    });
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
    // Several selected: delete them all (FR-LAY-08).
    if (id === doc.activeLayerId && this.selectedIds().length > 1) {
      const cmd = deleteLayers(doc, this.selectedIds());
      if (!cmd) return this.notice('A document needs at least one layer.');
      this.layerSelection.delete(doc);
      return this.exec(cmd);
    }
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
    const doc = this.doc;
    if (!doc) return;
    const ids = this.selectedIds();
    this.exec(ids.length > 1 ? groupLayers(doc, ids) : groupLayer(doc, doc.activeLayerId));
    this.layerSelection.delete(doc);
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
      // The pixel thumbnail shows the pixels themselves; the mask has its own thumbnail.
      ...(layer.type === 'raster' ? { mask: null } : {}),
    } as Layer;
    if (plain.type === 'group') plain.passThrough = false;
    const thumb = flattenPreview(liveLayers([plain]), doc.width, doc.height, maxSide);
    if (this.thumbs.size > 500) this.thumbs.clear();
    this.thumbs.set(key, thumb);
    return thumb;
  }

  /** The layer mask as a grey thumbnail: white shows, black hides (FR-LAY-04, FR-LAY-06). */
  maskThumbnail(
    id: string,
    maxSide: number,
  ): { width: number; height: number; rgba: Uint8ClampedArray } | null {
    const doc = this.doc;
    if (!doc || !doc.has(id)) return null;
    const layer = doc.layer(id);
    if (layer.type === 'group' || !layer.mask) return null;
    const mask = layer.mask;
    const key = `mask|${id}|${maskKey(mask)}|${maxSide}`;
    const cached = this.thumbs.get(key);
    if (cached) return cached;
    const grey = (v: (i: number) => number) => {
      const data = new Uint8ClampedArray(TILE_BYTES);
      for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
        const g = v(i);
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g;
        data[i * 4 + 3] = 255;
      }
      return data;
    };
    const background = grey(() => mask.background);
    const flat = {
      kind: 'raster' as const,
      visible: true,
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal' as const,
      tile: (k: TileKey) => {
        const t = mask.grid.get(k);
        return t ? grey((i) => t.data[i * 4 + 3]!) : background;
      },
    };
    const thumb = flattenPreview([flat], doc.width, doc.height, maxSide);
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
    if (id !== this.doc.activeLayerId) this.editingMask = false; // painting goes back to pixels
    this.layerSelection.delete(this.doc); // a plain click selects just this layer
    new SetActiveLayerCommand(id).do(this.doc);
    this.changed();
  }

  /** The selected layers (FR-LAY-08): the active one plus any Ctrl/Shift-clicked, that still exist. */
  selectedIds(): string[] {
    const doc = this.doc;
    if (!doc) return [];
    const extra = this.layerSelection.get(doc);
    const ids = new Set([...(extra ?? [])].filter((id) => doc.has(id)));
    ids.add(doc.activeLayerId);
    return [...ids];
  }

  /**
   * Ctrl/⌘-click toggles a layer in the selection; Shift-click selects every row between the active layer
   * and this one (FR-LAY-08). The clicked layer becomes active (unless it was toggled off).
   */
  selectLayer(id: string, mode: 'toggle' | 'range'): void {
    const doc = this.doc;
    if (!doc || !doc.has(id)) return;
    const current = new Set(this.selectedIds());
    if (mode === 'toggle') {
      if (current.has(id) && current.size > 1) {
        current.delete(id);
        if (doc.activeLayerId === id) new SetActiveLayerCommand([...current].at(-1)!).do(doc);
      } else {
        current.add(id);
        new SetActiveLayerCommand(id).do(doc);
      }
    } else {
      const rows = layerRows(doc.layers).map((r) => r.id);
      const a = rows.indexOf(doc.activeLayerId);
      const b = rows.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (const rid of rows.slice(lo, hi + 1)) current.add(rid);
      new SetActiveLayerCommand(id).do(doc);
    }
    this.editingMask = false;
    this.layerSelection.set(doc, current);
    this.changed();
  }

  setTool(tool: Tool): void {
    // Choosing another tool applies an open Free Transform (Photoshop asks; applying loses nothing: undo).
    if (this.transform) void this.commitTransform();
    if (tool === 'crop' && this.tool !== 'crop') this.resetCrop(false);
    if (tool !== 'lasso') this.lassoDraw = null; // an unfinished polygon is abandoned
    this.tool = tool;
    if (tool === 'brush' || tool === 'pencil') this.lastBrushTool = tool;
    if (tool === 'bucket' || tool === 'gradient') this.lastFillTool = tool;
    this.changed();
  }

  /** B: the brush or pencil, whichever was used last; Shift+B switches between them (docs/03 §4). */
  /** G: the Paint Bucket or the Gradient, whichever was used last; Shift+G switches (docs/03 §4). */
  selectFillTool(cycle = false): void {
    if (this.tool !== 'bucket' && this.tool !== 'gradient') this.setTool(this.lastFillTool);
    else if (cycle) this.setTool(this.tool === 'bucket' ? 'gradient' : 'bucket');
  }

  selectBrushTool(cycle = false): void {
    if (this.tool !== 'brush' && this.tool !== 'pencil') this.setTool(this.lastBrushTool);
    else if (cycle) this.setTool(this.tool === 'brush' ? 'pencil' : 'brush');
  }

  /** L: the lasso of the last kind; Shift+L switches between freehand and polygonal (docs/03 §4). */
  selectLassoTool(cycle = false): void {
    if (this.tool === 'lasso' && cycle) {
      this.lassoDraw = null;
      this.setToolOptions('lasso', {
        kind: this.toolOptions.lasso.kind === 'freehand' ? 'polygon' : 'freehand',
      });
    } else this.setTool('lasso');
  }

  /** M: the marquee with its last shape; Shift+M switches between rectangle and ellipse (docs/03 §4). */
  selectMarqueeTool(cycle = false): void {
    if (this.tool === 'marquee' && cycle) {
      const shape = this.toolOptions.marquee.shape === 'rect' ? 'ellipse' : 'rect';
      this.setToolOptions('marquee', { shape });
    } else this.setTool('marquee');
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
  /** The brush keys ([ ], Shift+[ ], 1…0) change the active painting tool's brush, the Clone Stamp's too. */
  setBrush(patch: Partial<BrushOptions>): void {
    this.setToolOptions(this.tool === 'clone' ? 'clone' : this.paintTool, patch);
  }

  get brushOptions(): BrushOptions {
    return this.toolOptions[this.tool === 'clone' ? 'clone' : this.paintTool];
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
    // With Free Transform open, the arrows move its box.
    if (this.transform)
      return this.setTransformParams({
        tx: this.transform.params.tx + dx,
        ty: this.transform.params.ty + dy,
      });
    if (!doc || this.busy) return;
    const ids = topSelected(doc, this.selectedIds());
    const blocker = ids.map((id) => moveBlocker(doc, id)).find(Boolean);
    if (blocker) return this.notice(blocker);
    const now = performance.now();
    if (now - this.lastNudge > NUDGE_COALESCE_MS) this.history?.endCoalesce();
    this.lastNudge = now;
    this.exec(
      translateMoves(
        doc,
        ids.map((id) => ({ id, dx, dy })),
        'Nudge',
      ),
      { coalesce: true },
    );
  }

  /** Aligns the active layer's content with the canvas (Layer › Align). */
  align(edge: AlignEdge): void {
    const doc = this.doc;
    if (!doc) return;
    // Several selected: align them to each other (FR-LAY-08); one: to the canvas.
    if (topSelected(doc, this.selectedIds()).length > 1)
      return this.exec(alignLayers(doc, this.selectedIds(), edge));
    const blocker = moveBlocker(doc, doc.activeLayerId);
    if (blocker) return this.notice(blocker);
    const [dx, dy] = alignOffset(doc, doc.activeLayerId, edge);
    this.exec(translateLayer(doc, doc.activeLayerId, dx, dy, 'Align'));
  }

  /** Layer › Distribute (three or more selected layers; FR-LAY-08). */
  distribute(edge: AlignEdge): void {
    const doc = this.doc;
    if (!doc) return;
    const cmd = distributeLayers(doc, this.selectedIds(), edge);
    if (!cmd) return this.notice('Select three or more layers to distribute.');
    this.exec(cmd);
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

  /**
   * Alt turns the brush, pencil and paint bucket into the eyedropper; Ctrl/⌘ turns painting tools into Move
   * (docs/03 §4).
   */
  private effectiveTool(mods: { alt: boolean; ctrl: boolean }): Tool {
    const t = this.tool;
    if (
      mods.ctrl &&
      (isPaintTool(t) ||
        ['eyedropper', 'marquee', 'lasso', 'wand', 'bucket', 'gradient', 'clone'].includes(t))
    )
      return 'move';
    if (mods.alt && (t === 'brush' || t === 'pencil' || t === 'bucket')) return 'eyedropper';
    return t;
  }

  // ---- Quick Mask (FR-SEL-06) -------------------------------------------------------------------

  /** Q: Quick Mask on or off. The selection stays as it is: painting changed it stroke by stroke. */
  toggleQuickMask(): void {
    if (!this.doc || this.busy) return;
    this.quickMask = !this.quickMask;
    this.changed();
  }

  private beginQuickMaskStroke(e: PointerEvent, tool: PaintTool, layerId: string): void {
    const settings = this.strokeSettings(tool, false);
    const generator = new DabGenerator(settings);
    const smoother = new PulledString((settings.smoothing * SMOOTHING_SCREEN_PX) / this.viewport.zoom);
    const start = this.docPoint(e);
    this.stroke = {
      layerId,
      tool,
      settings,
      generator,
      smoother,
      last: start,
      pointerId: e.pointerId,
      mask: null,
      quick: { value: this.maskPaintValue(tool) },
    };
    this.strokeBuffer.clear();
    this.strokeBuffer.hardness = settings.hardness;
    this.strokeBuffer.aliased = settings.aliased;
    this.addDabs(generator.begin(smoother.begin(start)), e.timeStamp);
  }

  /** A Quick Mask stroke becomes one selection change (white selects, black deselects). */
  private commitQuickMaskStroke(stroke: ActiveStroke, doc: Document): void {
    const base = doc.selection ?? Mask.all(doc.width, doc.height);
    const updates = new Map<TileKey, MaskTileOf | undefined>();
    for (const key of this.strokeBuffer.keys()) {
      const [tx, ty] = parseTileKey(key);
      if (tx < 0 || ty < 0 || tx * TILE_SIZE >= doc.width || ty * TILE_SIZE >= doc.height) continue;
      const old = base.tile(key);
      const data = applySelectionStroke(
        old && !old.full ? old.data : null,
        old ? 255 : 0,
        this.strokeBuffer.readCoverage(key),
        stroke.quick!.value,
        stroke.settings,
      );
      updates.set(key, maskTile(data));
    }
    this.strokeBuffer.clear();
    if (updates.size) this.setSelection(base.withTiles(updates), 'Quick Mask');
    else this.requestRender();
  }

  // ---- layer masks (FR-LAY-04) ------------------------------------------------------------------

  /** Mask painting: the brush and pencil paint the foreground colour's grey, the eraser the background's. */
  private maskPaintValue(tool: PaintTool): number {
    const [r, g, b] = tool === 'eraser' ? this.colors.background : this.colors.foreground;
    return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  /** The active layer if it can have a mask (raster or adjustment), else null with a notice. */
  private activeMasked(): RasterLayerOf | Extract<Layer, { type: 'adjustment' }> | null {
    const layer = this.doc?.activeLayer;
    if (!layer || layer.type === 'group') {
      this.notice('Select a layer (groups get masks in a later version).');
      return null;
    }
    return layer;
  }

  private activeRaster(): RasterLayerOf | null {
    const layer = this.doc?.activeLayer;
    if (!layer || layer.type !== 'raster') {
      this.notice('Select a layer (groups get masks in a later version).');
      return null;
    }
    return layer;
  }

  /** Layer › Layer Mask › Reveal All / Hide All / Reveal Selection / Hide Selection. Painting then edits it. */
  addLayerMask(kind: 'reveal' | 'hide' | 'revealSelection' | 'hideSelection'): void {
    const doc = this.doc;
    const layer = this.activeMasked();
    if (!doc || !layer || this.busy) return;
    if (layer.mask) return this.notice('This layer already has a mask.');
    if (layer.locks.all) return this.notice('This layer is locked.');
    const sel = doc.selection;
    const fromSelection = kind === 'revealSelection' || kind === 'hideSelection';
    if (fromSelection && !sel) return this.notice('Make a selection first.');
    let grid = new TileGrid();
    let background: 0 | 255 = kind === 'hide' ? 0 : 255;
    if (sel && fromSelection) {
      background = kind === 'revealSelection' ? 0 : 255;
      grid = maskGridOf(kind === 'revealSelection' ? sel : sel.invert(), doc, background);
    }
    const label = {
      reveal: 'Reveal All',
      hide: 'Hide All',
      revealSelection: 'Reveal Selection',
      hideSelection: 'Hide Selection',
    }[kind];
    this.exec(new SetLayerMaskCommand(label, layer.id, { grid, background, enabled: true, linked: true }));
    this.editingMask = true;
    this.changed();
  }

  // ---- adjustment layers (FR-ADJ-01) ------------------------------------------------------------

  /**
   * Layer › New Adjustment Layer: above the active layer, with Photoshop's defaults. Its mask reveals
   * everything, or only the selection when there is one (docs/03 §5.2).
   */
  addAdjustmentLayer(kind: AdjustmentKind): void {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const { parentId, index } = this.insertionPoint();
    const sel = doc.selection;
    const mask = sel
      ? { grid: maskGridOf(sel, doc, 0), background: 0 as const, enabled: true, linked: true }
      : { grid: new TileGrid(), background: 255 as const, enabled: true, linked: true };
    const layer = createAdjustmentLayer(this.nextName(ADJUSTMENT_LABELS[kind]), defaultAdjustment(kind), {
      mask,
    });
    this.exec(new AddLayerCommand(layer, index, parentId, `New ${ADJUSTMENT_LABELS[kind]} Layer`));
  }

  /** Properties panel: new settings for an adjustment layer; `coalesce` while a control is dragged. */
  setAdjustment(id: string, adjustment: Adjustment, { coalesce = false } = {}): void {
    const doc = this.doc;
    if (!doc?.has(id) || doc.layer(id).type !== 'adjustment') return;
    if (doc.layer(id).locks.all) return this.notice('This layer is locked.');
    this.pendingAdjustTimes.push(performance.now());
    this.exec(new SetAdjustmentCommand(id, adjustment), { coalesce });
  }

  /** The end of a drag on an adjustment control: the next change is a new undo step. */
  endAdjustmentEdit(): void {
    this.history?.endCoalesce();
  }

  /** The active layer's adjustment (for the Properties panel), if it is an adjustment layer. */
  get activeAdjustment(): { id: string; adjustment: Adjustment } | null {
    const l = this.doc?.activeLayer;
    return l?.type === 'adjustment' ? { id: l.id, adjustment: l.adjustment } : null;
  }

  // ---- destructive adjustments (Image › Adjustments, FR-ADJ-01) ---------------------------------

  /** Why the active layer cannot be adjusted directly, or null. */
  private adjustBlocker(): string | null {
    const layer = this.doc!.activeLayer;
    if (layer.type === 'group') return 'Select a layer to adjust (groups have no pixels).';
    if (layer.type === 'adjustment') return 'This is an adjustment layer: change it in the Properties panel.';
    if (this.editingMask && layer.mask)
      return 'Adjusting a mask is not supported yet. Click the layer’s thumbnail.';
    if (layer.locks.all || layer.locks.pixels) return 'This layer is locked.';
    if (!layer.visible) return 'This layer is hidden. Show it to adjust it.';
    return null;
  }

  /**
   * Image › Adjustments › …: opens `kind` for the active layer with its defaults, previewed live within the
   * selection. The dialog then calls setAdjusting, and commitAdjustment or cancelAdjustment.
   */
  beginAdjustment(kind: AdjustmentKind): void {
    const doc = this.doc;
    if (!doc || this.adjusting) return;
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const blocker = this.adjustBlocker();
    if (blocker) return this.notice(blocker);
    const sel = doc.selection;
    this.adjusting = {
      layerId: doc.activeLayerId,
      adjustment: defaultAdjustment(kind),
      preview: true,
      mask: sel ? { grid: maskGridOf(sel, doc, 0), background: 0, enabled: true, linked: true } : null,
    };
    this.refreshAdjustPreview();
    this.changed();
  }

  /** The dialog's settings changed. */
  setAdjusting(adjustment: Adjustment): void {
    if (!this.adjusting || this.adjusting.adjustment.kind !== adjustment.kind) return;
    this.adjusting = { ...this.adjusting, adjustment };
    this.pendingAdjustTimes.push(performance.now());
    this.refreshAdjustPreview();
    this.changed();
  }

  /** The dialog's Preview checkbox: off shows the layer as it is. */
  setAdjustingPreview(preview: boolean): void {
    if (!this.adjusting) return;
    this.adjusting = { ...this.adjusting, preview };
    this.refreshAdjustPreview();
    this.changed();
  }

  cancelAdjustment(): void {
    if (!this.adjusting) return;
    this.adjusting = null;
    this.adjustPreview = null;
    this.changed();
  }

  /** OK: the adjusted pixels replace the layer's, in the ops worker, as one undo step. */
  async commitAdjustment(): Promise<void> {
    const a = this.adjusting;
    if (!a) return;
    this.adjusting = null;
    await this.applyAdjustment(a.layerId, a.adjustment, a.mask);
  }

  /** Applies an adjustment without a dialog (Image › Adjustments › Invert, Ctrl+I). */
  applyAdjustmentNow(adjustment: Adjustment): void {
    const doc = this.doc;
    if (!doc) return;
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const blocker = this.adjustBlocker();
    if (blocker) return this.notice(blocker);
    const sel = doc.selection;
    const mask = sel
      ? { grid: maskGridOf(sel, doc, 0), background: 0 as const, enabled: true, linked: true }
      : null;
    void this.applyAdjustment(doc.activeLayerId, adjustment, mask);
  }

  private async applyAdjustment(
    layerId: string,
    adjustment: Adjustment,
    mask: RasterLayerOf['mask'],
    label = ADJUSTMENT_LABELS[adjustment.kind],
  ): Promise<void> {
    const doc = this.doc;
    if (!doc || !doc.has(layerId) || isNeutral(adjustment)) {
      this.adjustPreview = null;
      return this.changed();
    }
    // The preview stays on the canvas until the job's pixels replace it.
    this.adjustPreview = this.adjustedDocument(doc, layerId, adjustment, mask);
    const selection = doc.selection
      ? [...doc.selection.entries()].map(([k, t]): [TileKey, Uint8Array] => [
          k,
          new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength),
        ])
      : null;
    const job: OpsJob = {
      op: 'adjust',
      layer: fromGrid(layerId, doc.raster(layerId).tiles),
      adjustment,
      selection,
    };
    try {
      await this.runJob(label, job, (grids) => replaceLayers(label, grids));
    } finally {
      this.adjustPreview = null;
      this.changed();
    }
  }

  private refreshAdjustPreview(): void {
    const a = this.adjusting;
    const doc = this.doc;
    this.adjustPreview =
      a && doc && a.preview ? this.adjustedDocument(doc, a.layerId, a.adjustment, a.mask) : null;
  }

  /**
   * The document with `layerId` adjusted, for the preview only: the layer becomes an isolated group of
   * itself and an adjustment layer masked by the selection, carrying its blend mode and opacity. An
   * adjustment keeps alpha, so this shows exactly what adjusting the pixels gives.
   */
  private adjustedDocument(
    doc: Document,
    layerId: string,
    adjustment: Adjustment,
    mask: RasterLayerOf['mask'],
  ): Document {
    const adj = createAdjustmentLayer('preview', adjustment, { id: '#adjust-preview', mask });
    const swap = (list: readonly Layer[]): Layer[] =>
      list.map((l): Layer => {
        if (l.type === 'group') return { ...l, children: swap(l.children) };
        if (l.id !== layerId) return l;
        return createGroupLayer(
          l.name,
          [{ ...l, blendMode: 'normal', opacity: 1, clipped: false } as Layer, adj],
          {
            id: `${l.id}#adjust`,
            visible: l.visible,
            opacity: l.opacity,
            blendMode: l.blendMode,
            passThrough: false,
          },
        );
      });
    const preview = new Document(doc.width, doc.height, swap(doc.layers));
    preview.selection = doc.selection;
    return preview;
  }

  // ---- rulers, guides and snapping (FR-NAV-04) -----------------------------------------------------

  /** View › Rulers (Ctrl+R), Guides (Ctrl+;), Lock Guides (Ctrl+Alt+;), Snap (Ctrl+Shift+;). */
  toggleView(flag: 'rulers' | 'guides' | 'guidesLocked' | 'snap' | 'grid'): void {
    this.viewFlags = { ...this.viewFlags, [flag]: !this.viewFlags[flag] };
    this.changed();
  }

  /** Preferences › grid spacing and subdivisions. */
  setGrid(spacing: number, subdivisions: number): void {
    this.grid = { spacing: Math.max(2, spacing), subdivisions: Math.max(1, subdivisions) };
  }

  /** What drags snap to: guides, canvas, layer edges, and the grid's lines when it is shown. */
  private snapTargetsFor(exclude?: ReadonlySet<string>): SnapTargets {
    const doc = this.doc!;
    const t = snapTargets(doc, exclude);
    if (!this.viewFlags.grid) return t;
    const step = this.grid.spacing / this.grid.subdivisions;
    for (let x = step; x < doc.width; x += step) t.x.push(Math.round(x));
    for (let y = step; y < doc.height; y += step) t.y.push(Math.round(y));
    return t;
  }

  /**
   * The composite as a small image (the Navigator, FR-NAV-05), cached until the document changes.
   */
  documentThumbnail(maxSide: number): { width: number; height: number; rgba: Uint8ClampedArray } | null {
    const doc = this.doc;
    if (!doc) return null;
    const key = `doc|${this.docId}|${this.version}|${maxSide}`;
    const cached = this.thumbs.get(key);
    if (cached) return cached;
    const thumb = flattenPreview(liveLayers(doc.layers), doc.width, doc.height, maxSide);
    if (this.thumbs.size > 500) this.thumbs.clear();
    this.thumbs.set(key, thumb);
    return thumb;
  }

  private setGuides(label: string, guides: { horizontal: number[]; vertical: number[] }): void {
    this.exec(new SetGuidesCommand(label, guides));
  }

  /** View › New Guide…: at `position` document px (one undo step). */
  addGuide(orientation: GuideOrientation, position: number): void {
    const doc = this.doc;
    if (!doc || !Number.isFinite(position)) return;
    const g = doc.meta.guides;
    this.setGuides('New Guide', { ...g, [orientation]: [...g[orientation], Math.round(position)] });
  }

  /** View › Clear Guides. */
  clearGuides(): void {
    const g = this.doc?.meta.guides;
    if (!g || g.horizontal.length + g.vertical.length === 0) return;
    this.setGuides('Clear Guides', { horizontal: [], vertical: [] });
  }

  /** The guide within reach of a document point, for the Move tool (shown and unlocked guides only). */
  private guideAt(p: { x: number; y: number }): { orientation: GuideOrientation; index: number } | null {
    const doc = this.doc;
    if (!doc || !this.viewFlags.guides || this.viewFlags.guidesLocked) return null;
    const reach = GUIDE_GRAB_PX / this.viewport.zoom;
    const v = doc.meta.guides.vertical.findIndex((x) => Math.abs(x - p.x) <= reach);
    if (v >= 0) return { orientation: 'vertical', index: v };
    const h = doc.meta.guides.horizontal.findIndex((y) => Math.abs(y - p.y) <= reach);
    return h >= 0 ? { orientation: 'horizontal', index: h } : null;
  }

  /** Guides snap to the canvas edges and centre and to layer edges (not to other guides). */
  private guideSnapTargets(): SnapTargets | null {
    const doc = this.doc;
    if (!doc || !this.viewFlags.snap) return null;
    const t = this.snapTargetsFor();
    const g = doc.meta.guides;
    return {
      x: t.x.filter((x) => !g.vertical.includes(x)),
      y: t.y.filter((y) => !g.horizontal.includes(y)),
    };
  }

  /** A ruler was pressed: a new guide follows the pointer until it is released (dragGuideTo / endGuideDrag). */
  beginGuideFromRuler(orientation: GuideOrientation): void {
    if (!this.doc || this.busy) return;
    if (this.viewFlags.guidesLocked) return this.notice('Guides are locked (View › Lock Guides).');
    if (!this.viewFlags.guides) this.viewFlags = { ...this.viewFlags, guides: true };
    this.guideDrag = {
      orientation,
      index: null,
      position: Number.NaN,
      pointerId: null,
      targets: this.guideSnapTargets(),
    };
    this.changed();
  }

  /** The dragged guide follows the pointer (client px), snapped to whole pixels and nearby targets. */
  dragGuideTo(clientX: number, clientY: number): void {
    const d = this.guideDrag;
    if (!d) return;
    const rect = this.canvas.getBoundingClientRect();
    const [x, y] = this.viewport.screenToDoc(clientX - rect.left, clientY - rect.top);
    let position = d.orientation === 'vertical' ? x : y;
    if (d.targets) {
      const targets = d.orientation === 'vertical' ? d.targets.x : d.targets.y;
      position += snapOffset([position], targets, SNAP_PX / this.viewport.zoom).offset;
    }
    const inside = d.orientation === 'vertical' ? clientY >= rect.top : clientX >= rect.left;
    this.guideDrag = { ...d, position: inside ? Math.round(position) : Number.NaN };
    this.changed();
  }

  /**
   * The drag ends: a new guide is added where it was released over the canvas; a moved one goes there, or is
   * removed when dropped outside the canvas (back on a ruler), as in Photoshop.
   */
  endGuideDrag(): void {
    const d = this.guideDrag;
    const doc = this.doc;
    this.guideDrag = null;
    if (!d || !doc) return this.changed();
    const size = d.orientation === 'vertical' ? doc.width : doc.height;
    const onCanvas = Number.isFinite(d.position) && d.position >= 0 && d.position <= size;
    const g = doc.meta.guides;
    const list = [...g[d.orientation]];
    if (d.index === null) {
      if (onCanvas) this.setGuides('New Guide', { ...g, [d.orientation]: [...list, d.position] });
      else this.changed();
      return;
    }
    if (!onCanvas) {
      list.splice(d.index, 1);
      this.setGuides('Delete Guide', { ...g, [d.orientation]: list });
    } else if (list[d.index] !== d.position) {
      list[d.index] = d.position;
      this.setGuides('Move Guide', { ...g, [d.orientation]: list });
    } else this.changed();
  }

  // ---- filters (FR-FLT-01) -------------------------------------------------------------------------

  /**
   * Filter › …: opens `kind` with its defaults for the active layer (within the selection), previewed on
   * the tiles in view. Filters without settings (Sharpen) apply at once.
   */
  beginFilter(kind: FilterKind): void {
    const doc = this.doc;
    if (!doc || this.filtering) return;
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const blocker = this.adjustBlocker();
    if (blocker) return this.notice(blocker);
    if (!hasSettings(kind)) return void this.applyFilterNow(defaultFilter(kind));
    this.filtering = {
      layerId: doc.activeLayerId,
      filter: defaultFilter(kind),
      preview: true,
      seq: 0,
      running: false,
      timer: 0,
    };
    this.scheduleFilterPreview();
  }

  /** The dialog's settings changed. */
  setFilter(filter: Filter): void {
    const f = this.filtering;
    if (!f || f.filter.kind !== filter.kind) return;
    f.filter = filter;
    f.seq++;
    this.scheduleFilterPreview();
  }

  /** The dialog's Preview checkbox. */
  setFilterPreview(preview: boolean): void {
    const f = this.filtering;
    if (!f) return;
    f.preview = preview;
    f.seq++;
    if (preview) return this.scheduleFilterPreview();
    this.filterPreview = null;
    this.changed();
  }

  cancelFilter(): void {
    if (!this.filtering) return;
    window.clearTimeout(this.filtering.timer);
    this.filtering = null;
    this.filterPreview = null;
    this.changed();
  }

  /** OK: the whole layer (within the selection) in the ops worker, as one undo step. */
  async commitFilter(): Promise<void> {
    const f = this.filtering;
    if (!f) return;
    window.clearTimeout(f.timer);
    this.filtering = null;
    await this.runFilterJob(f.layerId, f.filter);
  }

  /** Applies a filter without a dialog (Sharpen; Filter › Last Filter). */
  async applyFilterNow(filter: Filter): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const blocker = this.adjustBlocker();
    if (blocker) return this.notice(blocker);
    await this.runFilterJob(doc.activeLayerId, filter);
  }

  /** Filter › Last Filter (Ctrl+Alt+F): the last filter again, with the same settings. */
  repeatLastFilter(): void {
    if (this.lastFilter) void this.applyFilterNow(this.lastFilter);
  }

  private filterJob(layerId: string, filter: Filter, keys: TileKey[] | null): OpsJob {
    const layer = this.doc!.raster(layerId);
    return {
      op: 'filter',
      layer: fromGrid(layerId, layer.tiles),
      filter,
      size: this.size(),
      selection: this.selectionTiles(),
      keys,
      preserveAlpha: layer.locks.transparency,
    };
  }

  /** The layer's grid with a filter job's result applied (empty tiles = now transparent). */
  private filtered(layerId: string, result: LayerTiles[]): TileGrid {
    const grid = new TileGrid();
    for (const [k, t] of this.doc!.raster(layerId).tiles.entries()) grid.set(k, t);
    for (const [k, bytes] of result[0]?.tiles ?? []) {
      if (bytes.length === 0) grid.set(k, undefined);
      else grid.set(k, createTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
    }
    return grid;
  }

  private async runFilterJob(layerId: string, filter: Filter): Promise<void> {
    const doc = this.doc!;
    const label = FILTER_LABELS[filter.kind];
    this.lastFilter = filter;
    try {
      await this.runJobFor(label, this.filterJob(layerId, filter, null), (result) => {
        this.exec(replaceLayers(label, new Map([[layerId, this.filtered(layerId, result)]])));
      });
    } finally {
      if (this.doc === doc) this.filterPreview = null;
      this.changed();
    }
  }

  /** Recomputes the preview shortly after the last change, one job at a time, for the tiles in view. */
  private scheduleFilterPreview(): void {
    const f = this.filtering;
    if (!f) return;
    window.clearTimeout(f.timer);
    f.timer = window.setTimeout(() => {
      f.timer = 0;
      void this.runFilterPreview();
    }, 120);
    this.changed();
  }

  private async runFilterPreview(): Promise<void> {
    const f = this.filtering;
    const doc = this.doc;
    if (!f || !doc || !f.preview) return;
    if (f.running) return; // the running job starts the next one when it ends
    f.running = true;
    const seq = f.seq;
    const { width, height } = this.cssSize();
    const view = this.viewport.visibleDocRect(width, height);
    const keys = tileKeysInRect(
      Math.max(0, Math.floor(view.x0)),
      Math.max(0, Math.floor(view.y0)),
      Math.min(doc.width, Math.ceil(view.x1)),
      Math.min(doc.height, Math.ceil(view.y1)),
    );
    const run = this.options.runOps ?? ((j: OpsJob) => Promise.resolve(runOpsJob(j)));
    try {
      const result = await run(this.filterJob(f.layerId, f.filter, keys), () => undefined);
      if (this.filtering === f && this.doc === doc && f.seq === seq && f.preview)
        this.filterPreview = withLayerTiles(doc, f.layerId, this.filtered(f.layerId, result));
    } catch (err) {
      this.notice(err instanceof Error ? err.message : 'The preview failed.');
    } finally {
      f.running = false;
      if (this.filtering === f && f.seq !== seq) void this.runFilterPreview();
      this.changed();
    }
  }

  // ---- histograms and Auto (FR-ADJ-02/03) -----------------------------------------------------------

  /** The selection as one-byte tiles for a job, or null. */
  private selectionTiles(): Array<[TileKey, Uint8Array]> | null {
    const sel = this.doc?.selection;
    return sel
      ? [...sel.entries()].map(([k, t]): [TileKey, Uint8Array] => [
          k,
          new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength),
        ])
      : null;
  }

  /** What a histogram measures: the image as shown, the active layer alone, or what is below a layer. */
  private histogramLayers(source: HistogramSource): DocSnapshot['layers'] | null {
    const doc = this.doc!;
    if (source === 'image') return toSnapshot(doc).layers;
    if (source === 'layer') {
      const active = doc.activeLayer;
      // An adjustment layer has no pixels of its own: measure what it adjusts.
      if (active.type === 'adjustment') return this.histogramLayers({ below: active.id });
      const plain = {
        ...layerToSnapshot(active),
        visible: true,
        opacity: 1,
        fillOpacity: 1,
        blendMode: 'normal' as const,
      };
      return [plain.type === 'group' ? { ...plain, passThrough: false } : plain];
    }
    const below = (list: readonly Layer[]): Layer[] | null => {
      for (let i = 0; i < list.length; i++) {
        const l = list[i]!;
        if (l.id === source.below) return list.slice(0, i);
        if (l.type === 'group') {
          const inner = below(l.children);
          if (inner) return [...list.slice(0, i), { ...l, children: inner }];
        }
      }
      return null;
    };
    const kept = below(doc.layers);
    return kept ? kept.map(layerToSnapshot) : null;
  }

  /**
   * The Histogram panel's and Levels' data (FR-ADJ-03), within the selection, computed in the ops worker
   * without blocking editing. Null when there is no document or it changed meanwhile.
   */
  async histogram(source: HistogramSource): Promise<Histogram | null> {
    const doc = this.doc;
    if (!doc) return null;
    const version = this.version;
    const layers = this.histogramLayers(source);
    if (!layers) return null;
    const run = this.options.runOps ?? ((j: OpsJob) => Promise.resolve(runOpsJob(j)));
    try {
      const [result] = await run(
        { op: 'histogram', layers, size: this.size(), selection: this.selectionTiles() },
        () => undefined,
      );
      if (this.doc !== doc || this.version !== version || !result?.tiles[0]) return null;
      return unpackHistogram(result.tiles[0][1]);
    } catch {
      return null;
    }
  }

  /**
   * Image › Auto Tone / Auto Contrast / Auto Color (FR-ADJ-02): Levels computed from the active layer's
   * histogram (within the selection) and applied to its pixels, as one step.
   */
  async autoAdjust(mode: 'tone' | 'contrast' | 'color'): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const blocker = this.adjustBlocker();
    if (blocker) return this.notice(blocker);
    const label = { tone: 'Auto Tone', contrast: 'Auto Contrast', color: 'Auto Color' }[mode];
    const id = doc.activeLayerId;
    const h = await this.histogram('layer');
    if (!h || this.doc !== doc || doc.activeLayerId !== id) return;
    if (h.count === 0) return this.notice('There are no pixels to adjust.');
    const sel = doc.selection;
    const mask = sel
      ? { grid: maskGridOf(sel, doc, 0), background: 0 as const, enabled: true, linked: true }
      : null;
    await this.applyAdjustment(id, autoLevels(h, mode), mask, label);
  }

  /** Levels' Auto button: per-channel levels for what an adjustment layer or the open dialog adjusts. */
  async autoLevels(): Promise<AdjustmentOf<'levels'> | null> {
    const h = await this.histogram('layer');
    return h && h.count > 0 ? autoLevels(h, 'tone') : null;
  }

  /** Layer › Layer Mask › Delete. */
  deleteLayerMask(): void {
    const layer = this.activeMasked();
    if (!layer?.mask || this.busy) return;
    this.exec(new SetLayerMaskCommand('Delete Layer Mask', layer.id, null));
    this.editingMask = false;
  }

  /** Layer › Layer Mask › Apply: the mask is baked into the pixels' alpha, then removed (one step). */
  applyLayerMask(): void {
    const layer = this.activeRaster();
    const mask = layer?.mask;
    if (!layer || !mask || this.busy) return;
    if (layer.locks.all || layer.locks.pixels) return this.notice('This layer is locked.');
    const before = new Map<TileKey, Tile | undefined>();
    const after = new Map<TileKey, Tile | undefined>();
    for (const [key, tile] of layer.tiles.entries()) {
      const m = mask.grid.get(key);
      if (!m && mask.background === 255) continue;
      const data = new Uint8ClampedArray(tile.data);
      for (let p = 3; p < data.length; p += 4)
        data[p] = Math.round((data[p]! * (m ? m.data[p]! : mask.background)) / 255);
      before.set(key, tile);
      after.set(key, data.some((v, i) => i % 4 === 3 && v !== 0) ? createTile(data) : undefined);
    }
    this.exec(new ApplyLayerMaskCommand(layer.id, mask, before, after));
    this.editingMask = false;
  }

  /** Layer › Layer Mask › Disable / Enable (Shift-click the mask thumbnail). */
  setLayerMaskEnabled(enabled: boolean): void {
    const layer = this.activeMasked();
    if (!layer?.mask || layer.mask.enabled === enabled) return;
    const label = enabled ? 'Enable Layer Mask' : 'Disable Layer Mask';
    this.exec(new SetLayerMaskCommand(label, layer.id, { ...layer.mask, enabled }));
  }

  /** The chain between the thumbnails: a linked mask moves with the layer. */
  setLayerMaskLinked(linked: boolean): void {
    const layer = this.activeMasked();
    if (!layer?.mask || layer.mask.linked === linked) return;
    const label = linked ? 'Link Layer Mask' : 'Unlink Layer Mask';
    this.exec(new SetLayerMaskCommand(label, layer.id, { ...layer.mask, linked }));
  }

  /**
   * Layer › Create / Release Clipping Mask (Ctrl+Alt+G; FR-LAY-05): the active layer shows only where the
   * layer below it has pixels. The bottom layer of a group or of the document has nothing to clip to.
   */
  setClipped(clipped: boolean): void {
    const doc = this.doc;
    const layer = doc?.activeLayer;
    if (!doc || !layer || this.busy) return;
    if (layer.type === 'group') return this.notice('Groups cannot be clipped yet.');
    if (layer.clipped === clipped) return;
    if (clipped && doc.locate(layer.id).index === 0)
      return this.notice('There is no layer below to clip to.');
    this.exec(new SetLayerPropsCommand(layer.id, { clipped }));
  }

  /** Ctrl+Alt+G toggles the clipping mask. */
  toggleClipped(): void {
    const layer = this.doc?.activeLayer;
    if (layer) this.setClipped(!layer.clipped);
  }

  /** Layer › Layer Mask › Disable / Enable, Unlink / Link: flips the active layer's mask flag. */
  toggleLayerMask(flag: 'enabled' | 'linked'): void {
    const active = this.doc?.activeLayer;
    const mask = active && active.type !== 'group' ? active.mask : null;
    if (!mask) return this.notice('This layer has no mask.');
    if (flag === 'enabled') this.setLayerMaskEnabled(!mask.enabled);
    else this.setLayerMaskLinked(!mask.linked);
  }

  /** Invert on a mask (Ctrl+I while the mask is edited). */
  invertLayerMask(): void {
    const layer = this.activeMasked();
    const mask = layer?.mask;
    if (!layer || !mask || this.busy) return;
    const grid = new TileGrid();
    for (const [key, t] of mask.grid.entries()) {
      const data = new Uint8ClampedArray(TILE_BYTES);
      for (let p = 3; p < data.length; p += 4) data[p] = 255 - t.data[p]!;
      grid.set(key, createTile(data));
    }
    const background = mask.background === 255 ? 0 : 255;
    this.exec(new SetLayerMaskCommand('Invert Layer Mask', layer.id, { ...mask, grid, background }));
  }

  /** Clicking a layer's mask or pixel thumbnail chooses what painting edits. */
  editLayerMask(onMask: boolean): void {
    const layer = this.doc?.activeLayer;
    this.editingMask = onMask && layer?.type === 'raster' && Boolean(layer.mask);
    this.changed();
  }

  // ---- selection (FR-SEL-01..06) ---------------------------------------------------------------

  private selectionState(): EditorSnapshot['selection'] {
    const mask = this.doc?.selection;
    if (!mask) return null;
    if (this.outline?.mask !== mask) this.outline = { mask, path: selectionOutline(mask) };
    return { outline: this.outline.path, bounds: mask.bounds()! };
  }

  private marqueeState(): EditorSnapshot['marquee'] {
    const d = this.marqueeDrag;
    if (!d) return null;
    return { shape: d.shape, rect: marqueeRect(d, this.toolOptions.marquee) };
  }

  /** True when something is selected (Delete, Copy and painting then act on it only). */
  get hasSelection(): boolean {
    return Boolean(this.doc?.selection);
  }

  /** The selection mask, for workers and the clipboard (null = everything). */
  get selectionMask(): Mask | null {
    return this.doc?.selection ?? null;
  }

  private setSelection(mask: Mask | null, label: string): void {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const next = mask && !mask.isEmpty ? mask : null;
    if (next === doc.selection) return;
    if (doc.selection && !next) this.lastSelection.set(doc, doc.selection);
    this.exec(new SetSelectionCommand(label, next));
  }

  /** Select › All (Ctrl+A). */
  selectAll(): void {
    if (this.doc) this.setSelection(Mask.all(this.doc.width, this.doc.height), 'Select All');
  }

  /** Select › Deselect (Ctrl+D). */
  deselect(): void {
    if (this.doc?.selection) this.setSelection(null, 'Deselect');
  }

  /** Select › Reselect (Ctrl+Shift+D): the selection the last Deselect removed. */
  reselect(): void {
    const doc = this.doc;
    const last = doc && this.lastSelection.get(doc);
    if (!doc || !last || doc.selection) return;
    // A canvas change since then makes the old mask meaningless.
    if (last.width !== doc.width || last.height !== doc.height) {
      this.lastSelection.delete(doc);
      return;
    }
    this.setSelection(last, 'Reselect');
  }

  /** Image › Crop: the canvas becomes the selection's bounds (and the selection is dropped, FR-TRF-01). */
  cropToSelection(): void {
    const b = this.doc?.selection?.bounds();
    if (!this.doc || !b) return this.notice('Make a selection to crop to.');
    this.crop(
      { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 },
      this.toolOptions.crop.deletePixels,
    );
  }

  /** Select › Inverse (Ctrl+Shift+I). With no selection, everything becomes selected. */
  invertSelection(): void {
    const doc = this.doc;
    if (!doc) return;
    const current = doc.selection ?? Mask.empty(doc.width, doc.height);
    this.setSelection(current.invert(), 'Inverse');
  }

  /**
   * Edit › Clear (Delete / Backspace): removes the selected pixels from the active layer, in proportion to
   * their coverage. Without a selection nothing happens (Photoshop deletes the layer's content only from a
   * selection too).
   */
  clearSelection(): void {
    const doc = this.doc;
    const mask = doc?.selection;
    if (!doc || !mask || this.busy) return;
    const layer = doc.activeLayer;
    if (layer.type !== 'raster')
      return this.notice(
        `Select a layer to clear (${layer.type === 'group' ? 'groups' : 'adjustment layers'} have no pixels).`,
      );
    if (layer.locks.all || layer.locks.pixels) return this.notice('This layer is locked.');
    if (layer.locks.transparency) return this.notice('This layer’s transparency is locked.');
    const before = new Map<TileKey, Tile | undefined>();
    const after = new Map<TileKey, Tile | undefined>();
    for (const [key, m] of mask.entries()) {
      const old = layer.tiles.get(key);
      if (!old) continue;
      let next: Tile | undefined;
      if (m.full) next = undefined;
      else {
        const data = new Uint8ClampedArray(old.data);
        let any = false;
        for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
          const k = m.data[i]!;
          if (k === 0) continue;
          const a = i * 4 + 3;
          data[a] = Math.round((data[a]! * (255 - k)) / 255);
          any = true;
        }
        if (!any) continue;
        next = data.some((v, i) => i % 4 === 3 && v !== 0) ? createTile(data) : undefined;
      }
      before.set(key, old);
      after.set(key, next);
    }
    if (after.size) this.exec(new PaintTilesCommand('Clear', layer.id, before, after));
  }

  /**
   * Magic Wand click (FR-SEL-03): runs in the ops worker on the active layer (or the composite of all layers)
   * and applies the region in the mode chosen at the click (Shift add, Alt subtract, both intersect).
   */
  private async magicWand(e: PointerEvent): Promise<void> {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const p = this.docPoint(e);
    const o = this.toolOptions.wand;
    const op = dragMode(o.mode, e.shiftKey, e.altKey);
    const active = doc.activeLayer;
    if (!o.sampleAll && active.type !== 'raster')
      return this.notice('Select a layer to sample, or turn on "Sample all layers".');
    // The active layer alone counts as itself (opaque, Normal, visible); all layers as the canvas shows them.
    const layers = o.sampleAll
      ? toSnapshot(doc).layers
      : [
          {
            ...layerToSnapshot(active),
            visible: true,
            opacity: 1,
            fillOpacity: 1,
            blendMode: 'normal' as const,
          },
        ];
    const { tolerance, contiguous, antiAlias } = o;
    await this.runSelectionJob(
      'Magic Wand',
      {
        op: 'wand',
        layers,
        size: { width: doc.width, height: doc.height },
        seed: { x: p.x, y: p.y },
        options: { tolerance, contiguous, antiAlias },
      },
      op,
    );
  }

  /**
   * Paint Bucket click (G; FR-PNT-03): the foreground colour poured into the region the Magic Wand would
   * select there (in the ops worker), within the selection, as one history step. A click outside the
   * selection fills nothing, as in Photoshop.
   */
  private async paintBucket(e: PointerEvent): Promise<void> {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const blocker = this.fillBlocker('Paint Bucket');
    if (blocker) return this.notice(blocker);
    const layer = doc.raster(doc.activeLayerId);
    const p = this.docPoint(e);
    const [x, y] = [Math.floor(p.x), Math.floor(p.y)];
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    if (doc.selection && doc.selection.value(x, y) === 0) return;
    const o = this.toolOptions.bucket;
    const sample = o.sampleAll
      ? toSnapshot(doc).layers
      : [
          {
            ...layerToSnapshot(layer),
            visible: true,
            opacity: 1,
            fillOpacity: 1,
            blendMode: 'normal' as const,
          },
        ];
    const selection = doc.selection
      ? [...doc.selection.entries()].map(([k, t]): [TileKey, Uint8Array] => [
          k,
          new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength),
        ])
      : null;
    const color = this.colors.foreground;
    await this.runJobFor(
      'Paint Bucket',
      {
        op: 'fill',
        layer: fromGrid(layer.id, layer.tiles),
        sample,
        size: { width: doc.width, height: doc.height },
        seed: { x, y },
        options: { tolerance: o.tolerance, contiguous: o.contiguous, antiAlias: o.antiAlias },
        color: [color[0], color[1], color[2]],
        selection,
        preserveAlpha: layer.locks.transparency,
      },
      ([result]) => {
        if (result?.tiles.length) this.addRecent(color);
        this.commitPaintedTiles('Paint Bucket', layer.id, result?.tiles ?? []);
      },
    );
  }

  /** Why the active layer cannot take paint from the bucket or the gradient, or null. */
  private fillBlocker(tool: string): string | null {
    const layer = this.doc!.activeLayer;
    if (layer.type !== 'raster')
      return `Select a layer to paint on (${layer.type === 'group' ? 'groups' : 'adjustment layers'} have no pixels).`;
    if (this.editingMask) return `The ${tool} paints pixels. Click the layer thumbnail to edit them.`;
    if (layer.locks.all || layer.locks.pixels) return 'This layer is locked.';
    return null;
  }

  /** Gradient (G; FR-PNT-04): drag from where it starts to where it ends; Shift keeps 45° steps. */
  private beginGradient(e: PointerEvent): void {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const blocker = this.fillBlocker('Gradient');
    if (blocker) return this.notice(blocker);
    const p = this.docPoint(e);
    this.gradientDrag = { pointerId: e.pointerId, start: { x: p.x, y: p.y }, end: { x: p.x, y: p.y } };
    this.changed();
  }

  private moveGradient(e: PointerEvent): void {
    const d = this.gradientDrag!;
    const p = this.docPoint(e);
    let { x, y } = p;
    if (e.shiftKey) {
      const dx = x - d.start.x;
      const dy = y - d.start.y;
      const step = Math.PI / 4;
      const a = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = Math.hypot(dx, dy);
      x = d.start.x + Math.cos(a) * len;
      y = d.start.y + Math.sin(a) * len;
    }
    this.gradientDrag = { ...d, end: { x, y } };
    this.changed();
  }

  /** Draws the gradient (in the ops worker) onto the active layer, within the selection: one history step. */
  private async endGradient(): Promise<void> {
    const d = this.gradientDrag;
    const doc = this.doc;
    this.gradientDrag = null;
    this.changed();
    if (!d || !doc || Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) < 1) return;
    const blocker = this.fillBlocker('Gradient');
    if (blocker) return this.notice(blocker);
    const layer = doc.raster(doc.activeLayerId);
    const o = this.toolOptions.gradient;
    const { foreground: fg, background: bg } = this.colors;
    const selection = doc.selection
      ? [...doc.selection.entries()].map(([k, t]): [TileKey, Uint8Array] => [
          k,
          new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength),
        ])
      : null;
    await this.runJobFor(
      'Gradient',
      {
        op: 'gradient',
        layer: fromGrid(layer.id, layer.tiles),
        size: { width: doc.width, height: doc.height },
        fill: {
          gradient: {
            type: o.type,
            stops: presetStops(o.preset, fg, bg),
            start: d.start,
            end: d.end,
            reverse: o.reverse,
          },
          opacity: o.opacity,
          mode: o.mode,
          dither: o.dither,
        },
        selection,
        preserveAlpha: layer.locks.transparency,
        keys: null,
      },
      ([result]) => this.commitPaintedTiles('Gradient', layer.id, result?.tiles ?? []),
    );
  }

  // ---- Clone Stamp (S; FR-PNT-05) --------------------------------------------------------------

  /** Where the crosshair goes: the source, or during a stroke the pixel being sampled. */
  private cloneSourceShown(): { x: number; y: number } | null {
    const c = this.cloneStroke;
    if (c) return { x: c.last.x + c.offset.dx, y: c.last.y + c.offset.dy };
    return this.tool === 'clone' ? this.cloneFrom : null;
  }

  /** Alt-click sets the source; a plain drag paints with the image from there. */
  private beginClone(e: PointerEvent): void {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const p = this.docPoint(e);
    if (e.altKey) {
      this.cloneFrom = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
      this.cloneOffset = null;
      return this.changed();
    }
    const blocker = this.fillBlocker('Clone Stamp');
    if (blocker) return this.notice(blocker);
    if (!this.cloneFrom) return this.notice('Alt-click where to clone from first.');
    const layer = doc.raster(doc.activeLayerId);
    const o = this.toolOptions.clone;
    // Aligned: the first stroke after Alt-click fixes the offset. Otherwise every stroke starts at the source.
    const offset = (o.aligned && this.cloneOffset) || {
      dx: Math.round(this.cloneFrom.x - p.x),
      dy: Math.round(this.cloneFrom.y - p.y),
    };
    if (o.aligned) this.cloneOffset = offset;
    // The image as the stroke begins (tiles are immutable, so this costs references only).
    let source: CloneSource;
    if (o.sampleAll) {
      const layers = liveLayers(doc.layers);
      const cache = new Map<TileKey, Uint8ClampedArray>();
      source = (key) => {
        let t = cache.get(key);
        if (!t) cache.set(key, (t = compositeTile(layers, key)));
        return t;
      };
    } else {
      const tiles = new Map([...layer.tiles.entries()].map(([k, t]) => [k, t.data]));
      source = (key) => tiles.get(key);
    }
    // The colour is unused: the source pixels are the paint.
    const settings: BrushSettings = { ...o, aliased: false, mode: 'paint', color: [0, 0, 0] };
    const generator = new DabGenerator(settings);
    this.cloneStroke = {
      pointerId: e.pointerId,
      layerId: layer.id,
      settings,
      generator,
      smoother: new PulledString((settings.smoothing * SMOOTHING_SCREEN_PX) / this.viewport.zoom),
      offset,
      source,
      preserveAlpha: layer.locks.transparency,
      coverage: new Map(),
      before: new Map(),
      after: new Map(),
      last: { x: p.x, y: p.y },
    };
    this.cloneDabs(generator.begin(p));
  }

  private moveClone(e: PointerEvent): void {
    const c = this.cloneStroke!;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const dabs: Dab[] = [];
    for (const ev of events.length ? events : [e]) {
      const point = this.docPoint(ev);
      c.last = { x: point.x, y: point.y };
      const q = c.smoother.move(point);
      if (q) dabs.push(...c.generator.moveTo(q));
    }
    this.cloneDabs(dabs);
  }

  /** Adds dabs to the coverage and recomputes the tiles they touch (CPU; within the selection). */
  private cloneDabs(dabs: Dab[]): void {
    const c = this.cloneStroke;
    const doc = this.doc;
    if (!c || !doc || dabs.length === 0) return this.changed();
    const layer = doc.raster(c.layerId);
    const touched = new Set<TileKey>();
    for (const d of dabs)
      for (const key of tileKeysInRect(
        Math.max(0, d.x - d.radius),
        Math.max(0, d.y - d.radius),
        Math.min(doc.width, d.x + d.radius),
        Math.min(doc.height, d.y + d.radius),
      ))
        touched.add(key);
    for (const key of touched) {
      const [tileX, tileY] = parseTileKey(key);
      let coverage = c.coverage.get(key);
      if (!coverage) c.coverage.set(key, (coverage = new Float32Array(TILE_SIZE * TILE_SIZE)));
      accumulateDabs(coverage, tileX, tileY, dabs, c.settings.hardness);
      // Painting only reaches selected pixels, in proportion to their coverage (FR-SEL-06).
      const mask = doc.selection?.tile(key);
      if (doc.selection && !mask) continue;
      const k = mask && !mask.full ? coverage.map((v, i) => (v * mask.data[i]!) / 255) : coverage;
      if (!c.before.has(key)) c.before.set(key, layer.tiles.get(key));
      const before = c.before.get(key);
      c.after.set(
        key,
        cloneTile(
          before,
          k,
          c.source,
          c.offset,
          c.settings,
          { tileX, tileY, docWidth: doc.width, docHeight: doc.height },
          c.preserveAlpha,
        ),
      );
    }
    const grid = new TileGrid();
    for (const [k, t] of layer.tiles.entries()) grid.set(k, t);
    for (const [k, t] of c.after) grid.set(k, t);
    this.clonePreview = withLayerTiles(doc, c.layerId, grid);
    this.changed();
  }

  /** The stroke so far becomes one history step. */
  private endClone(): void {
    const c = this.cloneStroke;
    this.cloneStroke = null;
    this.clonePreview = null;
    if (!c || !this.doc) return this.changed();
    const before = new Map<TileKey, Tile | undefined>();
    const after = new Map<TileKey, Tile | undefined>();
    for (const [key, next] of c.after)
      if (next !== c.before.get(key)) {
        before.set(key, c.before.get(key));
        after.set(key, next);
      }
    if (after.size) this.exec(new PaintTilesCommand('Clone Stamp', c.layerId, before, after));
    else this.changed();
  }

  /** Painted tiles from an ops job as one history step (only the tiles that changed come back). */
  private commitPaintedTiles(label: string, layerId: string, tiles: Array<[TileKey, Uint8Array]>): void {
    const grid = this.doc!.raster(layerId).tiles;
    const before = new Map<TileKey, Tile | undefined>();
    const after = new Map<TileKey, Tile | undefined>();
    for (const [key, bytes] of tiles) {
      before.set(key, grid.get(key));
      after.set(key, createTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
    }
    if (after.size) this.exec(new PaintTilesCommand(label, layerId, before, after));
  }

  /** Runs a selection job in the ops worker and applies its mask in `op` (one history step). */
  private async runSelectionJob(label: string, job: OpsJob, op: SelectionOp): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const version = this.version;
    this.job = { label, progress: 0 };
    this.changed();
    const run =
      this.options.runOps ?? ((j: OpsJob, f: (v: number) => void) => Promise.resolve(runOpsJob(j, f)));
    try {
      const [result] = await run(job, () => undefined);
      this.job = null;
      if (this.doc !== doc || this.version !== version)
        return this.notice(`${label} was cancelled because the document changed.`);
      const tiles = new Map<TileKey, NonNullable<ReturnType<typeof maskTile>>>();
      for (const [key, bytes] of result?.tiles ?? []) {
        const t = maskTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        if (t) tiles.set(key, t);
      }
      const shape = Mask.fromTiles(tiles, doc.width, doc.height);
      const base = doc.selection ?? Mask.empty(doc.width, doc.height);
      this.setSelection(base.combine(op, shape), label);
    } catch (err) {
      this.job = null;
      this.notice(err instanceof Error ? err.message : `${label} failed.`);
    } finally {
      this.changed();
    }
  }

  /** Select › Modify › Feather / Expand / Contract / Border / Smooth (FR-SEL-05). */
  modifySelection(modify: ModifyOp): Promise<void> {
    const doc = this.doc;
    const clip = doc?.selection?.toClip();
    if (!doc || !clip) return Promise.resolve(this.notice('Make a selection first.'));
    const label = {
      feather: 'Feather',
      expand: 'Expand',
      contract: 'Contract',
      border: 'Border',
      smooth: 'Smooth',
    }[modify.kind];
    const job: OpsJob = {
      op: 'modify',
      tiles: clip.tiles,
      bounds: clip.bounds,
      size: { width: doc.width, height: doc.height },
      modify,
    };
    return this.runSelectionJob(label, job, 'replace');
  }

  /** Select › Color Range: pixels close to the foreground colour, on the active layer or all layers. */
  selectColorRange(fuzziness: number, sampleAll: boolean): Promise<void> {
    const doc = this.doc;
    if (!doc) return Promise.resolve();
    const active = doc.activeLayer;
    if (!sampleAll && active.type !== 'raster')
      return Promise.resolve(this.notice('Select a layer to sample, or sample all layers.'));
    const layers = sampleAll
      ? toSnapshot(doc).layers
      : [
          {
            ...layerToSnapshot(active),
            visible: true,
            opacity: 1,
            fillOpacity: 1,
            blendMode: 'normal' as const,
          },
        ];
    const job: OpsJob = {
      op: 'colorRange',
      layers,
      size: { width: doc.width, height: doc.height },
      color: [...this.colors.foreground],
      fuzziness,
    };
    return this.runSelectionJob('Color Range', job, 'replace');
  }

  /** A polygon is being drawn: Enter closes it, Esc cancels, Backspace removes the last vertex. */
  get lassoActive(): boolean {
    return this.lassoDraw !== null;
  }

  private lassoDown(e: PointerEvent): void {
    const p = this.docPoint(e);
    const point: Point = [p.x, p.y];
    const kind = this.toolOptions.lasso.kind;
    const d = this.lassoDraw;
    if (kind === 'freehand' || !d) {
      this.lassoDraw = {
        kind,
        op: dragMode(this.toolOptions.lasso.mode, e.shiftKey, e.altKey),
        points: [point],
        hover: null,
        pointerId: kind === 'freehand' ? e.pointerId : null,
      };
      return this.changed();
    }
    // Polygon: a click near the first vertex closes it (a double-click too: see the dblclick listener).
    if (closesPolygon(d.points, point, this.viewport.zoom)) return this.finishLasso();
    d.points.push(point);
    this.changed();
  }

  private lassoMove(e: PointerEvent): void {
    const d = this.lassoDraw!;
    const p = this.docPoint(e);
    if (d.kind === 'freehand') {
      if (e.pointerId !== d.pointerId) return;
      for (const ev of typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]) {
        const q = this.docPoint(ev);
        addPoint(d.points, [q.x, q.y]);
      }
    } else d.hover = [p.x, p.y];
    this.changed();
  }

  /** Closes the lasso outline and applies it in the mode chosen at its first point. */
  finishLasso(): void {
    const d = this.lassoDraw;
    const doc = this.doc;
    this.lassoDraw = null;
    if (!d || !doc) return this.changed();
    const outline = lassoOutline(d.points);
    if (outline.length < 3) {
      // A click without drawing deselects, as with the marquee.
      if (d.op === 'replace' && d.kind === 'freehand') this.deselect();
      return this.changed();
    }
    const shape = polygonMask(outline, doc.width, doc.height, this.toolOptions.lasso.antiAlias);
    const base = doc.selection ?? Mask.empty(doc.width, doc.height);
    this.setSelection(base.combine(d.op, shape), lassoLabel(d.kind));
    this.changed();
  }

  cancelLasso(): void {
    if (!this.lassoDraw) return;
    this.lassoDraw = null;
    this.changed();
  }

  /** Backspace while drawing a polygon: remove the last vertex (the whole outline when it is the only one). */
  removeLassoPoint(): void {
    const d = this.lassoDraw;
    if (!d || d.kind !== 'polygon') return;
    d.points.pop();
    if (d.points.length === 0) this.lassoDraw = null;
    this.changed();
  }

  private beginMarquee(e: PointerEvent): void {
    const p = this.docPoint(e);
    const o = this.toolOptions.marquee;
    const op = dragMode(o.mode, e.shiftKey, e.altKey);
    this.marqueeDrag = {
      pointerId: e.pointerId,
      start: { x: p.x, y: p.y },
      current: { x: p.x, y: p.y },
      op,
      shape: o.shape,
      shiftFree: !e.shiftKey,
      altFree: !e.altKey,
      constrain: false,
      fromCentre: false,
    };
    this.changed();
  }

  private moveMarquee(e: PointerEvent): void {
    const d = this.marqueeDrag!;
    const p = this.docPoint(e);
    // A modifier held since mouse-down only chose the mode; released and pressed again, it shapes the box.
    const shiftFree = d.shiftFree || !e.shiftKey;
    const altFree = d.altFree || !e.altKey;
    // The dragged corner snaps to guides, the canvas and layer edges (FR-NAV-04).
    if (this.viewFlags.snap && this.doc) {
      const targets = this.snapTargetsFor();
      const t = SNAP_PX / this.viewport.zoom;
      p.x += snapOffset([p.x], targets.x, t).offset;
      p.y += snapOffset([p.y], targets.y, t).offset;
    }
    this.marqueeDrag = {
      ...d,
      current: { x: p.x, y: p.y },
      shiftFree,
      altFree,
      constrain: shiftFree && e.shiftKey,
      fromCentre: altFree && e.altKey,
    };
    this.changed();
  }

  private endMarquee(): void {
    const d = this.marqueeDrag;
    const doc = this.doc;
    this.marqueeDrag = null;
    if (!d || !doc) return this.changed();
    const o = this.toolOptions.marquee;
    const rect = marqueeRect(d, o);
    const empty = rect.x1 - rect.x0 < 1 || rect.y1 - rect.y0 < 1;
    if (empty && o.style !== 'size') {
      // A click without a drag deselects (Photoshop), unless it was meant to add to or cut the selection.
      if (d.op === 'replace') this.deselect();
      return this.changed();
    }
    const shape =
      d.shape === 'rect'
        ? rectMask(rect, doc.width, doc.height)
        : ellipseMask(rect, doc.width, doc.height, o.antiAlias);
    const base = doc.selection ?? Mask.empty(doc.width, doc.height);
    this.setSelection(base.combine(d.op, shape), marqueeLabel(d.shape));
    this.changed();
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
  /** Every raster layer's tiles for a pixel job, and its mask under `<id>#mask` (resampled the same way). */
  private layerTiles(): LayerTiles[] {
    return this.doc!.allLayers().flatMap((l) => [
      ...(l.type === 'raster' ? [fromGrid(l.id, l.tiles)] : []),
      // Adjustment layers have only their mask.
      ...(l.type !== 'group' && l.mask ? [fromGrid(`${l.id}#mask`, l.mask.grid)] : []),
    ]);
  }

  /**
   * Runs a pixel job, then turns its result into one command. Editing is blocked meanwhile; if the document
   * changed anyway (another document opened), the result is dropped.
   */
  private async runJob(
    label: string,
    job: OpsJob,
    command: (grids: Map<string, TileGrid>) => Command | null,
  ): Promise<void> {
    await this.runJobFor(label, job, (result) => {
      this.exec(command(new Map(result.map((l) => [l.id, toGrid(l.tiles)]))));
    });
  }

  /**
   * Runs a pixel job and hands its result to `onResult` while the document is still the one it was computed for
   * (if it changed meanwhile, the result is dropped). Editing is blocked until it ends.
   */
  private async runJobFor(
    label: string,
    job: OpsJob,
    onResult: (result: LayerTiles[]) => void,
  ): Promise<void> {
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const doc = this.doc;
    const version = this.version;
    this.job = { label, progress: 0 };
    const started = performance.now();
    this.changed();
    const run =
      this.options.runOps ?? ((j: OpsJob, p: (v: number) => void) => Promise.resolve(runOpsJob(j, p)));
    try {
      const result = await run(job, (progress) => {
        this.job = { label, progress };
        this.changed();
      });
      this.job = null;
      // How long pixel jobs take (NFR-PERF-05 reads 'job:Gaussian Blur').
      performance.measure(`job:${label}`, { start: started, end: performance.now() });
      if (this.doc !== doc || this.version !== version)
        return this.notice(`${label} was cancelled because the document changed.`);
      onResult(result);
    } catch (err) {
      this.job = null;
      this.notice(err instanceof Error ? err.message : `${label} failed.`);
    } finally {
      this.changed();
    }
  }

  /**
   * Image › Trim (FR-TRF-06): crops away the edges that are transparent, or the colour of the top-left or
   * bottom-right pixel, on the chosen sides. Pixels outside the new canvas are deleted.
   */
  trim(
    basis: TrimBasis,
    sides: { top: boolean; bottom: boolean; left: boolean; right: boolean },
  ): Promise<void> {
    const doc = this.doc;
    if (!doc) return Promise.resolve();
    const job: OpsJob = { op: 'trim', layers: toSnapshot(doc).layers, size: this.size(), basis };
    return this.runJobFor('Trim', job, ([result]) => {
      const tiles = new Map<TileKey, NonNullable<ReturnType<typeof maskTile>>>();
      for (const [key, bytes] of result?.tiles ?? []) {
        const t = maskTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        if (t) tiles.set(key, t);
      }
      const b = Mask.fromTiles(tiles, doc.width, doc.height).bounds();
      if (!b) return this.notice('Nothing to trim: the whole image would be removed.');
      const x0 = sides.left ? b.x0 : 0;
      const y0 = sides.top ? b.y0 : 0;
      const x1 = sides.right ? b.x1 : doc.width;
      const y1 = sides.bottom ? b.y1 : doc.height;
      if (x0 === 0 && y0 === 0 && x1 === doc.width && y1 === doc.height)
        return this.notice('Nothing to trim.');
      this.exec(cropDocument(doc, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, true, 'Trim'));
    });
  }

  /** Image › Reveal All (FR-TRF-06): grows the canvas to show every layer's pixels outside it. */
  revealAll(): void {
    const doc = this.doc;
    if (!doc || this.busy) return;
    const b = contentBounds(doc.allLayers().flatMap((l) => (l.type === 'raster' ? [l.tiles] : [])));
    const x0 = Math.min(0, b?.x0 ?? 0);
    const y0 = Math.min(0, b?.y0 ?? 0);
    const x1 = Math.max(doc.width, b?.x1 ?? 0);
    const y1 = Math.max(doc.height, b?.y1 ?? 0);
    if (x0 === 0 && y0 === 0 && x1 === doc.width && y1 === doc.height)
      return this.notice('Every pixel is already on the canvas.');
    this.exec(cropDocument(doc, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, false, 'Reveal All'));
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
    if (this.transform) return this.transformDown(e);
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
    if (tool === 'marquee') return this.beginMarquee(e);
    if (tool === 'lasso') return this.lassoDown(e);
    if (tool === 'wand') return void this.magicWand(e);
    if (tool === 'bucket') return void this.paintBucket(e);
    if (tool === 'gradient') return this.beginGradient(e);
    if (tool === 'clone') return this.beginClone(e);
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
    if (this.quickMask) return this.beginQuickMaskStroke(e, tool, layer.id);
    if (layer.type === 'group') return this.notice('Select a layer to paint on (groups have no pixels).');
    if (!layer.visible) return this.notice('This layer is hidden. Show it to paint on it.');
    // An adjustment layer has no pixels: painting always edits its mask (docs/03 §5.2).
    if (layer.type === 'adjustment' && !layer.mask)
      return this.notice('This adjustment layer has no mask to paint. Add one with Layer › Layer Mask.');
    const onMask =
      (this.editingMask || layer.type === 'adjustment') && layer.mask ? this.maskPaintValue(tool) : null;
    if (layer.locks.all || (onMask === null && layer.locks.pixels))
      return this.notice('This layer is locked.');
    const settings = this.strokeSettings(tool, onMask === null ? layer.locks.transparency : false);
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
      mask: onMask === null ? null : { value: onMask },
      quick: null,
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
        blendMode: 'normal', // the eraser has no mode
      };
    }
    return { ...o[tool], aliased: tool === 'pencil', mode: 'paint', color: foreground };
  }

  private beginMove(e: PointerEvent, toggleAutoSelect: boolean): void {
    const doc = this.doc!;
    const p = this.docPoint(e);
    // A guide under the pointer is dragged instead (FR-NAV-04).
    const guide = this.guideAt(p);
    if (guide) {
      const position = doc.meta.guides[guide.orientation][guide.index]!;
      this.guideDrag = { ...guide, position, pointerId: e.pointerId, targets: this.guideSnapTargets() };
      return this.changed();
    }
    const { autoSelect, autoSelectMode } = this.toolOptions.move;
    if (autoSelect !== toggleAutoSelect) {
      const hit = layerAt(doc, p.x, p.y, autoSelectMode);
      if (hit && hit !== doc.activeLayerId) this.setActiveLayer(hit);
    }
    const id = doc.activeLayerId;
    // The active layer, or all selected ones when it is part of the selection (FR-LAY-08).
    const ids = topSelected(doc, this.selectedIds());
    const blocker = ids.map((x) => moveBlocker(doc, x)).find(Boolean);
    if (blocker) return this.notice(blocker);
    const rasterIds = new Set(ids.flatMap((x) => movedRasters(doc, x).map((l) => l.id)));
    const moved = contentBounds(ids.flatMap((x) => movedRasters(doc, x).map((l) => l.tiles)));
    this.moveSnap =
      this.viewFlags.snap && moved ? { bounds: moved, targets: this.snapTargetsFor(rasterIds) } : null;
    this.moving = {
      layerId: id,
      layerIds: ids,
      rasterIds,
      start: { x: p.x, y: p.y },
      dx: 0,
      dy: 0,
      pointerId: e.pointerId,
    };
  }

  // ---- Free Transform (Ctrl+T, FR-TRF-04) -------------------------------------------------------

  /** The layers a transform acts on (the active one, or every selected one) and their content box. */
  /**
   * The layers a transform acts on (the active one, or every selected one) and their content box. With a
   * selection, only the selected pixels move: they are lifted off their layers.
   */
  private transformTarget(): TransformTarget | string {
    const doc = this.doc;
    if (!doc) return 'No document.';
    const layerIds = topSelected(doc, this.selectedIds());
    const blocker = layerIds.map((id) => moveBlocker(doc, id)).find(Boolean);
    if (blocker) return blocker;
    const rasters = layerIds.flatMap((id) => movedRasters(doc, id));
    if (rasters.some((l) => l.locks.pixels)) return 'This layer’s pixels are locked.';
    const rasterIds = new Set(rasters.map((l) => l.id));
    const selection = doc.selection;
    if (!selection) {
      const box = contentBounds(rasters.map((l) => l.tiles));
      if (!box) return 'Nothing to transform: the layer is empty.';
      return { layerIds, rasterIds, box, floating: null };
    }
    const parts = new Map(rasters.map((l) => [l.id, splitBySelection(l.tiles, selection)] as const));
    const box = contentBounds([...parts.values()].map((p) => p.lifted));
    if (!box) return 'Nothing to transform: the selected area is empty.';
    const floating = {
      parts,
      selection,
      preview: floatingPreview(doc, parts),
      liftedIds: new Set([...parts.keys()].map(liftedId)),
    };
    return { layerIds, rasterIds, box, floating };
  }

  /** What the canvas shows for the open (or just applied) transform. */
  private transformShown(): TransformShown | null {
    const t = this.transform;
    if (!t) return this.transformPreview;
    const matrix = transformMatrix(t.box, t.params);
    return t.floating
      ? { layerIds: t.floating.liftedIds, matrix, doc: t.floating.preview }
      : { layerIds: t.rasterIds, matrix, doc: null };
  }

  /** Edit › Free Transform: shows the box and handles; nothing changes until it is applied. */
  beginTransform(): void {
    if (!this.doc || this.transform) return;
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const target = this.transformTarget();
    if (typeof target === 'string') return this.notice(target);
    this.transform = { ...target, params: NO_TRANSFORM, drag: null, hover: null };
    this.changed();
  }

  get transforming(): boolean {
    return this.transform !== null;
  }

  /** Options bar fields (and Edit › Transform while the box is open). */
  setTransformParams(patch: Partial<TransformParams>): void {
    const t = this.transform;
    if (!t || t.drag) return;
    const next = { ...t.params, ...patch };
    if (!Object.values(next).every(Number.isFinite) || next.sx === 0 || next.sy === 0) return;
    this.transform = { ...t, params: next };
    this.changed();
  }

  /** Esc: closes the box without changing anything. */
  cancelTransform(): void {
    if (!this.transform) return;
    this.transform = null;
    this.changed();
  }

  /** Enter: re-rasterizes the layers (and their linked masks) in the ops worker, as one undo step. */
  async commitTransform(): Promise<void> {
    const t = this.transform;
    if (!t || t.drag) return;
    this.transform = null;
    await this.applyTransform('Free Transform', t, transformMatrix(t.box, t.params));
  }

  /**
   * Edit › Transform › Flip / Rotate: changes the open box, or applies at once to the active (or selected)
   * layers about their centre.
   */
  transformStep(step: 'flipHorizontal' | 'flipVertical' | 'rotate180' | 'rotate90cw' | 'rotate90ccw'): void {
    const turn = { rotate180: Math.PI, rotate90cw: Math.PI / 2, rotate90ccw: -Math.PI / 2 } as const;
    const change = (p: TransformParams): TransformParams =>
      step === 'flipHorizontal'
        ? { ...p, sx: -p.sx }
        : step === 'flipVertical'
          ? { ...p, sy: -p.sy }
          : { ...p, angle: p.angle + turn[step] };
    if (this.transform) return this.setTransformParams(change(this.transform.params));
    if (!this.doc) return;
    if (this.busy) return this.notice(`Wait for ${this.job?.label ?? 'the current action'} to finish.`);
    const target = this.transformTarget();
    if (typeof target === 'string') return this.notice(target);
    const labels = {
      flipHorizontal: 'Flip Horizontal',
      flipVertical: 'Flip Vertical',
      rotate180: 'Rotate 180°',
      rotate90cw: 'Rotate 90° Clockwise',
      rotate90ccw: 'Rotate 90° Counter Clockwise',
    } as const;
    void this.applyTransform(labels[step], target, transformMatrix(target.box, change(NO_TRANSFORM)));
  }

  private async applyTransform(label: string, target: TransformTarget, m: Affine): Promise<void> {
    const doc = this.doc;
    const matrix = snapExact(m);
    if (!doc || isIdentity(matrix)) return this.changed();
    try {
      invert(matrix);
    } catch {
      this.notice('The transform has no area. Nothing was changed.');
      return this.changed();
    }
    const layers: LayerTiles[] = [];
    const inverted: string[] = [];
    const beneath: LayerTiles[] = [];
    const floating = target.floating;
    if (floating) {
      // The selected pixels move and go back over the rest; the selection moves with them. Masks stay.
      for (const [id, part] of floating.parts) {
        layers.push(fromGrid(id, part.lifted));
        beneath.push(fromGrid(id, part.rest));
      }
      layers.push(fromGrid(SELECTION_JOB_ID, selectionToGrid(floating.selection)));
    } else
      for (const id of target.rasterIds) {
        const l = doc.raster(id);
        layers.push(fromGrid(id, l.tiles));
        // A linked mask transforms with its layer; a reveal-all one transforms inverted (see invertAlpha).
        if (l.mask?.linked) {
          layers.push(fromGrid(`${id}#mask`, l.mask.grid));
          if (l.mask.background === 255) inverted.push(`${id}#mask`);
        }
      }
    // Keep showing the result until the job's pixels replace it.
    this.transformPreview = floating
      ? { layerIds: floating.liftedIds, matrix, doc: floating.preview }
      : { layerIds: target.rasterIds, matrix, doc: null };
    const job: OpsJob = { op: 'affine', layers, size: this.size(), matrix, inverted, beneath };
    try {
      await this.runJob(label, job, (grids) => {
        if (!floating) return replaceLayers(label, grids);
        const moved = grids.get(SELECTION_JOB_ID);
        grids.delete(SELECTION_JOB_ID);
        return replaceLayers(label, grids, moved ? gridToSelection(moved, doc.width, doc.height) : null);
      });
    } finally {
      this.transformPreview = null;
      this.changed(); // the selection's ants come back
    }
  }

  private transformDown(e: PointerEvent): void {
    const t = this.transform!;
    const p = this.docPoint(e);
    const from: [number, number] = [p.x, p.y];
    const hit = hitTransform(t.box, t.params, from, TRANSFORM_HANDLE_SLOP / this.viewport.zoom);
    this.transform = { ...t, drag: { pointerId: e.pointerId, hit, start: t.params, from }, hover: hit };
    this.changed();
  }

  private transformMove(e: PointerEvent): void {
    const t = this.transform!;
    const p = this.docPoint(e);
    const at: [number, number] = [p.x, p.y];
    if (t.drag && e.pointerId === t.drag.pointerId) {
      const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
      const params = dragTransform(t.box, t.drag.start, t.drag.hit, t.drag.from, at, mods);
      this.transform = { ...t, params };
      this.changed();
      return;
    }
    if (t.drag) return;
    const hover = hitTransform(t.box, t.params, at, TRANSFORM_HANDLE_SLOP / this.viewport.zoom);
    if (hover !== t.hover) {
      this.transform = { ...t, hover };
      this.changed();
    }
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
      // Snapping: the moved content's edges or centre onto guides, the canvas and other layers.
      const snap = this.moveSnap;
      if (snap) {
        const t = SNAP_PX / this.viewport.zoom;
        const b = snap.bounds;
        if (!e.shiftKey || dx !== 0)
          dx += Math.round(
            snapOffset([b.x0 + dx, b.x1 + dx, (b.x0 + b.x1) / 2 + dx], snap.targets.x, t).offset,
          );
        if (!e.shiftKey || dy !== 0)
          dy += Math.round(
            snapOffset([b.y0 + dy, b.y1 + dy, (b.y0 + b.y1) / 2 + dy], snap.targets.y, t).offset,
          );
      }
      if (dx !== this.moving.dx || dy !== this.moving.dy) {
        this.moving = { ...this.moving, dx, dy };
        this.requestRender(e.timeStamp);
      }
      return;
    }
    if (this.transform) return this.transformMove(e);
    if (this.guideDrag && e.pointerId === this.guideDrag.pointerId)
      return this.dragGuideTo(e.clientX, e.clientY);
    if (!e.buttons && this.doc && this.effectiveTool(this.modifiers) === 'move') {
      const hover = this.guideAt(this.docPoint(e))?.orientation ?? null;
      if (hover !== this.guideHover) {
        this.guideHover = hover;
        this.changed();
      }
    }
    if (this.sampling && e.pointerId === this.sampling.pointerId) return this.sample(e);
    if (this.marqueeDrag && e.pointerId === this.marqueeDrag.pointerId) return this.moveMarquee(e);
    if (this.gradientDrag && e.pointerId === this.gradientDrag.pointerId) return this.moveGradient(e);
    if (this.cloneStroke && e.pointerId === this.cloneStroke.pointerId) return this.moveClone(e);
    if (this.lassoDraw) return this.lassoMove(e);
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
    if (this.transform?.drag && e.pointerId === this.transform.drag.pointerId) {
      this.transform = { ...this.transform, drag: null };
      this.changed();
    }
    if (this.cropDrag && e.pointerId === this.cropDrag.pointerId) this.endCrop();
    if (this.marqueeDrag && e.pointerId === this.marqueeDrag.pointerId) this.endMarquee();
    if (this.gradientDrag && e.pointerId === this.gradientDrag.pointerId) void this.endGradient();
    if (this.cloneStroke && e.pointerId === this.cloneStroke.pointerId) this.endClone();
    if (this.lassoDraw?.kind === 'freehand' && e.pointerId === this.lassoDraw.pointerId) this.finishLasso();
    if (this.guideDrag && e.pointerId === this.guideDrag.pointerId) this.endGuideDrag();
    if (this.moving && e.pointerId === this.moving.pointerId) {
      const { layerIds, dx, dy } = this.moving;
      this.moving = null;
      this.moveSnap = null;
      if (this.doc && (dx !== 0 || dy !== 0))
        this.exec(
          translateMoves(
            this.doc,
            layerIds.map((id) => ({ id, dx, dy })),
          ),
        );
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
    if (stroke.quick) return this.commitQuickMaskStroke(stroke, doc);
    const layer = doc.masked(stroke.layerId);
    const preserveAlpha = layer.locks.transparency;
    const before = new Map<TileKey, Tile | undefined>();
    const after = new Map<TileKey, Tile | undefined>();
    const selection = doc.selection;
    const layerMask = stroke.mask ? layer.mask : null;
    for (const key of this.strokeBuffer.keys()) {
      const [tileX, tileY] = parseTileKey(key);
      const old = layer.type === 'raster' ? layer.tiles.get(key) : undefined;
      // Painting only reaches selected pixels, in proportion to their coverage (FR-SEL-06).
      const mask = selection?.tile(key);
      if (selection && !mask) continue;
      const coverage = this.strokeBuffer.readCoverage(key);
      if (mask && !mask.full) for (let i = 0; i < coverage.length; i++) coverage[i]! *= mask.data[i]! / 255;
      if (layerMask && stroke.mask) {
        const oldMask = layerMask.grid.get(key);
        const nextMask = applyMaskStroke(
          oldMask,
          layerMask.background,
          coverage,
          stroke.mask.value,
          stroke.settings,
        );
        if (nextMask !== oldMask) {
          before.set(key, oldMask);
          after.set(key, nextMask);
        }
        continue;
      }
      const next = applyStroke(
        old,
        coverage,
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
      this.history.execute(
        new PaintTilesCommand(label, layer.id, before, after, layerMask ? 'mask' : 'pixels'),
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
    const quick = this.quickMask && this.stroke?.quick ? this.stroke : null;
    const preview =
      this.stroke && !quick
        ? {
            buffer: this.strokeBuffer,
            layerId: this.stroke.layerId,
            settings: this.stroke.settings,
            preserveAlpha: strokeLayer?.locks.transparency ?? false,
            selection: this.doc?.selection ?? null,
            onMask: this.stroke.mask ? { target: this.stroke.mask.value / 255 } : null,
          }
        : undefined;
    const move = this.moving
      ? { layerIds: this.moving.rasterIds, dx: this.moving.dx, dy: this.moving.dy }
      : undefined;
    const shown = this.transformShown();
    this.compositor.render(
      shown?.doc ?? this.clonePreview ?? this.adjustPreview ?? this.filterPreview ?? this.doc,
      this.viewport,
      { cssWidth, cssHeight, width, height, dpr },
      preview,
      move,
      {
        pixelGrid: this.pixelGrid,
        transform: shown,
        quickMask: this.quickMask
          ? {
              selection: this.doc.selection,
              stroke: quick
                ? { buffer: this.strokeBuffer, settings: quick.settings, target: quick.quick!.value / 255 }
                : null,
            }
          : null,
      },
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
    for (const t of this.pendingAdjustTimes.splice(0))
      performance.measure('adjust-latency', { start: t, end: now });
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
/** Changes when a mask's tiles or background change (thumbnail cache key). */
function maskKey(mask: NonNullable<RasterLayerOf['mask']>): string {
  let sum: number = mask.background;
  for (const [key, tile] of mask.grid.entries()) {
    let h = tile.id;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    sum = (sum + h) | 0;
  }
  return `m${mask.grid.size}:${sum}`;
}

/** The document with one raster layer's tiles replaced, for a preview only (the document is not touched). */
function withLayerTiles(doc: Document, id: string, tiles: TileGrid): Document {
  const swap = (list: readonly Layer[]): Layer[] =>
    list.map((l): Layer => {
      if (l.type === 'group') return { ...l, children: swap(l.children) };
      return l.id === id && l.type === 'raster' ? { ...l, tiles } : l;
    });
  const preview = new Document(doc.width, doc.height, swap(doc.layers));
  preview.selection = doc.selection;
  return preview;
}

/** A layer mask's RGBA grid showing `shown` (coverage in alpha); tiles equal to `background` are left out. */
function maskGridOf(shown: Mask, doc: Document, background: 0 | 255): TileGrid {
  const grid = new TileGrid();
  for (const key of tileKeysInRect(0, 0, doc.width, doc.height)) {
    const t = shown.tile(key);
    if ((background === 0 && !t) || (background === 255 && t?.full)) continue;
    const data = new Uint8ClampedArray(TILE_BYTES);
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) data[i * 4 + 3] = t ? t.data[i]! : 0;
    grid.set(key, createTile(data));
  }
  return grid;
}

function contentKey(layer: Layer): string {
  if (layer.type === 'group')
    return `g(${layer.children.map((c) => `${c.visible ? '' : '!'}${c.opacity}${c.blendMode}${contentKey(c)}`).join(',')})`;
  if (layer.type === 'adjustment') return `a${JSON.stringify(layer.adjustment)}`;
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
        adjustment: l.type === 'adjustment' ? l.adjustment.kind : null,
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
        clipped: l.type !== 'group' && l.clipped && i > 0,
        mask:
          l.type !== 'group' && l.mask
            ? { enabled: l.mask.enabled, linked: l.mask.linked, key: maskKey(l.mask) }
            : null,
      });
      if (l.type === 'group' && !l.collapsed) visit(l.children, depth + 1, l.id);
    }
  };
  visit(layers, 0, null);
  return rows;
}
