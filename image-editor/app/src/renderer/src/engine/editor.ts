import { applyStroke, DabGenerator, DEFAULT_BRUSH, type BrushSettings, type Dab } from './brush/brush';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  PaintTilesCommand,
  SetActiveLayerCommand,
  SetLayerPropsCommand,
} from './doc/commands';
import { createRasterLayer, Document } from './doc/document';
import { Compositor } from './gpu/compositor';
import { StrokeBuffer } from './gpu/stroke-buffer';
import { History, type HistoryEntry } from './history/history';
import { Viewport } from './render/viewport';
import { parseTileKey, TileGrid, type Tile, type TileKey } from './tiles/tile';

export type Tool = 'brush' | 'eraser' | 'hand' | 'zoom';

export type EditorSnapshot = {
  doc: { width: number; height: number; name: string; sourceProfile: string | null } | null;
  /** Top → bottom, as shown in the Layers panel. */
  layers: Array<{ id: string; name: string; visible: boolean; opacity: number }>;
  activeLayerId: string | null;
  history: { entries: HistoryEntry[]; position: number; canUndo: boolean; canRedo: boolean };
  zoom: number;
  tool: Tool;
  brush: BrushSettings;
  cursor: { x: number; y: number } | null;
  gpu: string;
};

type ActiveStroke = { layerId: string; settings: BrushSettings; generator: DabGenerator; pointerId: number };

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

  constructor(private readonly canvas: HTMLCanvasElement) {
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
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), { signal });
    canvas.addEventListener('webglcontextrestored', () => this.onContextRestored(), { signal });
    this.resizeObserver = new ResizeObserver(() => {
      if (this.autoFit && this.doc) this.fitToScreen();
      else this.requestRender();
    });
    this.resizeObserver.observe(canvas);
  }

  private initGpu(): void {
    this.compositor = new Compositor(this.gl);
    this.strokeBuffer = new StrokeBuffer(this.gl, this.compositor.quad);
  }

  /** NFR-REL-02: pixels live in CPU tiles, so a lost GPU context only needs re-uploading. */
  private onContextRestored(): void {
    this.stroke = null; // an in-progress stroke is cancelled
    this.initGpu();
    this.requestRender();
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
    name: string,
    sourceProfile: string | null,
  ): void {
    const doc = new Document(
      width,
      height,
      createRasterLayer('Background', TileGrid.fromRgba(width, height, rgba)),
      {
        name,
        sourceProfile,
      },
    );
    this.open(doc);
  }

  private open(doc: Document): void {
    this.stroke = null;
    this.strokeBuffer.clear();
    this.doc = doc;
    this.history = new History(doc, { maxSteps: 100, maxBytes: 2 * 1024 ** 3 }, () => this.changed());
    this.fitToScreen();
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
      doc: doc ? { width: doc.width, height: doc.height, ...doc.meta } : null,
      layers: doc
        ? [...doc.layers].reverse().map(({ id, name, visible, opacity }) => ({ id, name, visible, opacity }))
        : [],
      activeLayerId: doc?.activeLayerId ?? null,
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
      gpu: debug ? String(this.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'WebGL2',
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

  addLayer(): void {
    const doc = this.doc;
    if (!doc || !this.history) return;
    const name = `Layer ${doc.layers.length}`;
    this.history.execute(new AddLayerCommand(name, doc.indexOf(doc.activeLayerId) + 1));
  }

  deleteActiveLayer(): void {
    if (!this.doc || !this.history || this.doc.layers.length <= 1) return;
    this.history.execute(new DeleteLayerCommand(this.doc.activeLayerId));
  }

  setLayerVisible(id: string, visible: boolean): void {
    this.history?.execute(new SetLayerPropsCommand(id, { visible }));
  }

  /** Call repeatedly while dragging, then `endCoalesce()` on release: one undo step per drag. */
  setLayerOpacity(id: string, opacity: number): void {
    this.history?.execute(new SetLayerPropsCommand(id, { opacity }), { coalesce: true });
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
    if (!layer.visible) return; // painting on a hidden layer is refused (FR-LAY-02 conventions)
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
    const start = performance.now();
    const layer = doc.layer(stroke.layerId);
    const before = new Map<TileKey, Tile | undefined>();
    const after = new Map<TileKey, Tile | undefined>();
    for (const key of this.strokeBuffer.keys()) {
      const [tileX, tileY] = parseTileKey(key);
      const old = layer.tiles.get(key);
      const next = applyStroke(old, this.strokeBuffer.readCoverage(key), stroke.settings, {
        tileX,
        tileY,
        docWidth: doc.width,
        docHeight: doc.height,
      });
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
    const preview = this.stroke
      ? { buffer: this.strokeBuffer, layerId: this.stroke.layerId, settings: this.stroke.settings }
      : undefined;
    this.compositor.render(this.doc, this.viewport, { cssWidth, cssHeight, width, height, dpr }, preview);
    // NFR-PERF-02: pointer event → frame submitted. Read by the benchmark/E2E via the Performance API.
    const now = performance.now();
    for (const t of this.pendingInputTimes.splice(0))
      performance.measure('brush-latency', { start: t, end: now });
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.strokeBuffer.clear();
    this.compositor.dispose();
  }
}
