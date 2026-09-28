# 04 — IPC & Command API: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Source of truth | `app/src/shared/ipc-contract.ts`, `schemas.ts` (zod); `app/src/renderer/src/engine/doc/commands/*`. If this doc disagrees with them, the code wins. |

This project has two interface layers:

1. **Process IPC:** renderer ↔ main ↔ codec-host (security boundary, zod-validated).
2. **Engine Command API:** in-renderer, how tools, UI, importers and (later) scripting mutate documents.

## 1. Renderer ↔ main IPC

Same principles as the other projects: `invoke`/`handle` per `domain.action` channel, sender-frame check,
zod on both request and response, and **file refs** instead of arbitrary paths.

```ts
interface Api {
  app: {
    getInfo(): Promise<{ version: string; platform: string; arch: string; gpu: GpuInfo }>;
    getLaunchFiles(): Promise<FileRef[]>;                           // file associations / argv
    onOpenFiles(cb: (refs: FileRef[]) => void): Unsubscribe;       // second-instance, macOS open-file
    setDocumentEdited(docId: string, edited: boolean): void;       // macOS close-button dot, quit guard
  };
  file: {
    showOpenDialog(): Promise<FileRef[]>;
    showSaveDialog(opts: { suggestedName: string; formats: ExportFormat[] }): Promise<FileRef | null>;
    registerDropped(paths: string[]): Promise<FileRef[]>;          // preload only (webUtils.getPathForFile)
    readBytes(ref: FileRef): Promise<ArrayBuffer>;                 // .iep / .psd → workers (main doesn't parse)
    writeAtomic(ref: FileRef, data: ArrayBuffer): Promise<void>;   // tmp + fsync + rename
    recent: { list(): Promise<RecentItem[]>; add(ref: FileRef, thumbPng?: ArrayBuffer): Promise<void>; clear(): Promise<void> };
    reveal(ref: FileRef): Promise<void>;
  };
  codec: {
    // Returns a MessagePort (transferred via ipcRenderer.postMessage) streaming decode results from codec-host
    decode(ref: FileRef): Promise<{ requestId: string }>;           // port arrives on 'codec.port' event
    encode(req: EncodeRequest): Promise<{ requestId: string }>;    // pixels sent over the port; bytes returned
    cancel(requestId: string): Promise<void>;
  };
  recovery: {
    write(docId: string, data: ArrayBuffer, meta: RecoveryMeta): Promise<void>;
    list(): Promise<RecoveryItem[]>;
    read(id: string): Promise<ArrayBuffer>;
    discard(id: string): Promise<void>;
  };
  models: {
    status(name: ModelName): Promise<{ installed: boolean; sizeBytes: number; version: string }>;
    download(name: ModelName): Promise<void>;                       // progress via 'models.progress' event
    remove(name: ModelName): Promise<void>;
    // renderer loads installed models from app://models/<name>.onnx (read-only protocol route)
  };
  batch: {
    run(spec: BatchSpec): Promise<{ batchId: string }>;
    cancel(batchId: string): Promise<void>;
    onProgress(cb: (p: BatchProgress) => void): Unsubscribe;
    presets: { list(): Promise<BatchPreset[]>; save(p: BatchPreset): Promise<void>; remove(id: string): Promise<void> };
  };
  settings: { get(): Promise<Settings>; update(patch: DeepPartial<Settings>): Promise<Settings> };
  // fonts: no IPC. The renderer calls queryLocalFonts() directly; main grants 'local-fonts' to the app:// origin only.
  menu: { onCommand(cb: (commandId: string) => void): Unsubscribe; setState(state: MenuState): void }; // native menu ↔ command registry
}
```

**As built (M1 slice 1)** — `app/src/shared/ipc-contract.ts` is the source of truth:

| Channel | Purpose |
| --- | --- |
| `app.getInfo`, `app.getLaunchFiles` | App info; files from argv/file associations (handed out once) |
| `app.setDocumentEdited(boolean)` | Unsaved-changes state for the close/quit guard and the macOS close-button dot |
| `app.closeWindow()` | Close after the renderer resolved Save / Don't Save (main event `app.closeRequested` asks first) |
| `dialog.openImage()` | Images and `.iep` projects |
| `dialog.saveAs({ suggestedName, kind })` | `kind` = `'project'` or an export format; adds the extension; returns a **writable** ref |
| `file.readBytes(ref)` | Bytes of a chosen file (≤ 2 GiB), parsed in the file worker |
| `file.writeAtomic(ref, bytes)` | Temp + fsync + rename; only save-dialog refs or an opened `.iep` (else `FORBIDDEN`) |
| `codec.decode(ref)`, `codec.encode()` | Open a codec session; the MessagePort arrives via `codec.port` |

Main also sends `menu.command` (a `MenuCommandId` from `shared/menu.ts`) for native menu clicks. Menu
accelerators are displayed but not registered; the renderer's keymap handles keys.

### 1.1 codec-host messages (over the brokered MessagePort)

**Encode as built:** the file worker (not the UI thread) flattens the document and posts `encode-start`
(`width`, `height`, zod-validated `ExportOptions`, source EXIF), then 16 MB `chunk`s, then `encode-end`; the
reply is `encoded { bytes }` or `error`. Chunks are structured-cloned, not transferred: Electron's
`MessagePortMain` cannot receive transferred `ArrayBuffer`s (found by E2E).


```ts
// renderer → codec-host
type CodecRequest =
  | { type: 'decode'; requestId: string; limitInputPixels: number }             // path is bound by main, not sent by renderer
  | { type: 'encode'; requestId: string; width: number; height: number; format: ExportFormat;
      options: EncodeOptions; metadata: MetadataPolicy }                        // followed by 'chunk' messages with RGBA8
  | { type: 'chunk'; requestId: string; offset: number; data: ArrayBuffer }     // transferred
  | { type: 'cancel'; requestId: string };

// codec-host → renderer
type CodecResponse =
  | { type: 'decoded-header'; requestId: string; width: number; height: number; hasAlpha: boolean;
      sourceProfile?: string; orientationApplied: number; exif?: ExifSummary }
  | { type: 'chunk'; requestId: string; offset: number; data: ArrayBuffer }     // straight RGBA8 sRGB, row-major
  | { type: 'encoded'; requestId: string; bytes: ArrayBuffer; sizeBytes: number }
  | { type: 'error'; requestId: string; code: CodecErrorCode; message: string };

type CodecErrorCode = 'UNSUPPORTED_FORMAT' | 'CORRUPT_IMAGE' | 'TOO_LARGE' | 'OUT_OF_MEMORY' | 'CANCELLED' | 'INTERNAL';
```

Main binds the file path to the request when it creates the port pair, so the renderer never passes a path
to codec-host. For encode, codec-host returns bytes and main performs `writeAtomic`. Codec-host never
writes to user files except in **batch** mode, where main passes it a validated output directory.

## 2. Engine Command API

### 2.1 Command interface

```ts
interface Command {
  readonly id: string;                         // for coalescing
  readonly label: string;                      // i18n key shown in History panel
  do(doc: Document): CommandResult;            // must be deterministic given doc state
  undo(doc: Document): CommandResult;
  sizeBytes(): number;                         // memory accounting (tile refs owned exclusively by history)
  mergeWith?(next: Command): Command | null;   // coalescing (slider drags, nudges)
}
interface CommandResult { dirty: DirtySet }   // { layerIds, rect } → compositor invalidation
```

The only entry point is `doc.execute(cmd)`. It runs `do`, pushes to history (or merges), emits
`doc.changed { dirty }`, and marks the document edited.

### 2.2 Command catalogue (v1)

| Area | Commands |
| --- | --- |
| Layers | `AddLayer`, `DeleteLayers`, `DuplicateLayers`, `ReorderLayer`, `SetLayerProps` (name, visible, opacity, fill, blendMode, locks, clipped), `GroupLayers`, `UngroupLayer`, `MergeDown`, `MergeVisible`, `Flatten`, `RasterizeLayer` |
| Pixels | `PaintTiles` (brush, eraser, clone, fill, gradient: carries before/after tile refs), `FilterLayer`, `ApplyAdjustment` (destructive), `ClearSelection`, `FillSelection` |
| Masks | `AddMask`, `DeleteMask`, `ApplyMask`, `SetMaskProps` (enabled, linked, inverted), `PaintTiles` targeting the mask |
| Selection | `SetSelection` (holds before/after mask tile refs), `TransformSelection` |
| Transform | `TransformLayers` (matrix, resampling), `CropDocument`, `ResizeImage`, `ResizeCanvas`, `RotateCanvas`, `FlipCanvas`, `Trim` |
| Adjustment layers | `AddAdjustmentLayer`, `SetAdjustmentParams` (coalescing) |
| Text/shape | `AddTextLayer`, `EditText` (runs diff), `SetTextStyle`, `AddShapeLayer`, `EditShape` |
| Document | `SetGuides`, `SetDocumentProps` (ppi) |
| Composite | `Batch` (a macro wrapping several commands as one undo step, e.g. Remove background = AddMask + PaintTiles) |

### 2.3 Tool interface

```ts
interface Tool {
  readonly id: ToolId;                         // 'brush' | 'marquee-rect' | ...
  options: ToolOptions;                        // zod-validated, persisted per tool
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onPointerDown(e: CanvasPointerEvent): void;  // document-space coordinates, pressure, tilt, buttons, modifiers
  onPointerMove(e: CanvasPointerEvent): void;
  onPointerUp(e: CanvasPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): boolean;       // return true if handled
  cursor(state: CursorState): CursorSpec;
  overlay?(r: OverlayRenderer): void;          // handles, previews
}
```

Tools never mutate the document directly. They build previews (a stroke buffer, a transform preview) and
emit a Command on commit.

### 2.4 Engine events → UI

`doc.changed`, `doc.selectionChanged`, `doc.activeLayerChanged`, `history.changed`, `view.changed`
(zoom/pan), `tool.changed`, `tool.optionsChanged`, `gpu.contextLost|Restored`, `memory.pressure`,
`task.progress` (filters, AI, export). Zustand stores subscribe and throttle updates to the next animation
frame. Stroke events never trigger React renders.

### 2.5 Command registry (menus, shortcuts, palette)

Every user-invokable action is registered once:

```ts
registerCommand({ id: 'image.adjustments.levels', title: 'Levels…', keybinding: 'mod+l',
                  when: 'doc.hasRasterTarget', run: (ctx) => openDialog('levels') });
```

The native menu, the keymap, the command palette and the toolbar all read from the registry. Main builds
the native menu from the renderer's `menu.setState` (labels, enabled, checked) and forwards clicks back as
`menu.onCommand(id)`.
