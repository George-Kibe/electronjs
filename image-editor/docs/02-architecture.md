# 02 — Architecture: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Related | [Requirements](01-requirements.md) · [IPC & Command API](04-ipc-command-api.md) · [Data Model](05-data-model.md) · [File Formats & Color](09-file-formats-color.md) · [ADRs](adr/) |

## 1. Architectural drivers

| Driver | Consequence |
| --- | --- |
| Smooth editing of large, many-layer documents (G2, NFR-PERF-*) | Sparse **tiled** document + **WebGL2** compositor + GPU brush/filters ([ADR-0003](adr/0003-tiled-document-webgl2-engine.md)) |
| Non-destructive editing and deep undo (G3) | Adjustment layers/masks evaluated at composite time. Command-based history over **immutable tiles** with disk spill ([ADR-0005](adr/0005-non-destructive-model-and-history.md)). |
| Untrusted image files | Decoders isolated in a utilityProcess (sharp) and workers (PSD, zip) ([ADR-0008](adr/0008-codec-host-utility-process.md)) |
| Private, offline AI | onnxruntime-web in a worker (WebGPU → WASM), models downloaded on demand ([ADR-0006](adr/0006-on-device-ai-models.md)) |
| Correct colour on phone/camera images | Convert to sRGB 8-bit on import, tag on export ([ADR-0004](adr/0004-colour-management-srgb-8bit.md)) |
| Same stack as the rest of the repo | Electron + electron-vite + React + TypeScript ([ADR-0002](adr/0002-app-stack-electron-react.md)) |

## 2. Process model

```mermaid
flowchart TB
    subgraph Electron app
      subgraph Renderer[Renderer - one per window, sandboxed, served from app://]
        UI[React UI<br/>panels, dialogs, options bar]
        ENG[Engine - main thread<br/>document, tools, WebGL2 compositor, history]
        W1[[Worker: CPU ops<br/>flood fill, histogram, auto-levels]]
        W2[[Worker: files<br/>PSD ag-psd, .iep fflate]]
        W3[[Worker: AI<br/>onnxruntime-web WebGPU/WASM]]
        W4[[Worker: scratch<br/>OPFS history spill]]
        UI <--> ENG
        ENG <--> W1 & W2 & W3 & W4
      end
      P[Preload<br/>window.api]
      M[Main process<br/>windows, menus, dialogs, recent files,<br/>atomic writes, autosave dir, updates, model downloads]
      C[[utilityProcess: codec-host<br/>sharp/libvips: decode, ICC→sRGB, orient,<br/>encode, batch pipeline]]
    end
    Renderer <--> P <--> M
    M -- MessagePort brokered --> C
    C <-. direct MessagePort (pixels) .-> Renderer
```

| Process | Responsibility | Why here |
| --- | --- | --- |
| **Main** | App lifecycle, windows, native menus, file dialogs, recent files, reads/writes file bytes (atomic save), autosave directory, auto-update, AI model download + hash check, registering `app://` protocol with COOP/COEP headers | Privileged. **Never parses image content.** |
| **Renderer** | UI + the engine. WebGL2 needs a web context, and running on the UI thread gives the lowest input latency. | Sandboxed. Only accesses files through refs from main. |
| **Workers** (dedicated, per renderer) | CPU-heavy or untrusted parsing: flood fill, histograms, PSD, `.iep` zip, AI inference, history spill to OPFS | Keep the UI thread free. Contain parser bugs. |
| **codec-host** (Electron `utilityProcess`) | sharp/libvips: decode common formats → straight RGBA8 sRGB, encode exports, run batch jobs | Native module that parses untrusted input, kept out of main and renderer. A crash only kills this process, and main restarts it. |

**`app://` protocol + cross-origin isolation.** The renderer is served from a privileged custom scheme
`app://editor/` (standard, secure, supportFetchAPI). Its handler adds `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp`, so `crossOriginIsolated === true`. That enables
`SharedArrayBuffer` (multi-threaded WASM for onnxruntime-web) and a secure-context OPFS for scratch storage.

## 3. Engine overview (renderer, framework-free)

```
engine/
├── doc/          Document, LayerTree, Layer subclasses, Selection, Guides, Commands
├── tiles/        Tile, TileGrid (sparse), TilePool, tile ops (copy, fill, blit)
├── gpu/          GL context manager, TextureCache (tile → texture LRU), Programs, FramebufferPool, readback (PBO + fence)
├── render/       Compositor (layer tree → framebuffer), Viewport (pan/zoom/rotate), Overlays (ants, guides, handles, brush cursor)
├── tools/        Tool interface + implementations (state machines driven by pointer/keyboard events)
├── brush/        Dab generator (spacing, pressure, smoothing), stroke buffer, brush presets
├── ops/          Adjustments (GPU), Filters (GPU/worker), Resample, Transform
├── history/      History stack, memory accounting, spill manager
├── io/           Importers/exporters orchestration (calls workers / codec-host)
└── events.ts     Typed event bus → UI (Zustand stores subscribe)
```

### 3.1 Document model (summary; full schema in [05](05-data-model.md))

```
Document { id, width, height, ppi, layers: LayerTree, selection: Mask | null, guides, activeLayerId, colorProfile: 'sRGB' }
Layer    { id, name, visible, opacity, fillOpacity, blendMode, locks, mask?: Mask, clipped: boolean }
 ├── RasterLayer     { pixels: TileGrid, offset }
 ├── GroupLayer      { children: Layer[], passThrough: boolean }
 ├── AdjustmentLayer { kind: 'levels'|'curves'|..., params }            -- no pixels, evaluated in the compositor
 ├── TextLayer       { runs[], box?, transform, cachedRaster: TileGrid } -- re-rasterized when edited
 └── ShapeLayer      { path, fill, stroke, transform, cachedRaster }
Mask     { pixels: TileGrid (A8, stored as R channel), defaultValue: 0|255, enabled, linked }
```

## 4. Tiles & memory

- **Tile** = 256×256 pixels, `Uint8Array` RGBA8, **straight (unpremultiplied) alpha**, **immutable**. A
  write produces a new Tile, so history holds references instead of copies.
- **TileGrid** = a sparse map `(tx, ty) → Tile | Uniform(color)`. Empty tiles are not allocated. Solid-colour
  tiles are stored as a single colour. A 24 MP layer that is 30 % painted uses about 30 % of 96 MB.
- **TilePool** recycles buffers. It tracks bytes by owner: live document vs history-only.
- **Memory budget** (preference, default = min(40 % of RAM, 6 GB)): when it is exceeded, the history spill
  manager compresses (fflate level 1) the least-recently-used **history-only** tiles and writes them to an
  OPFS scratch file through the scratch worker (`createSyncAccessHandle`). Only a handle stays in memory.
  Undo reloads them transparently (async, with a spinner if it takes more than 100 ms).
- Masks and selection use 1-byte tiles.

## 5. GPU pipeline (WebGL2)

### 5.1 Principles

- **CPU tiles are the source of truth. GPU textures are a cache** (LRU, bounded by a VRAM budget estimated
  from `MAX_TEXTURE_SIZE` and a conservative default of 1 GB). This makes context loss recoverable
  (NFR-REL-02): on `webglcontextrestored`, the cache is dropped and re-uploaded lazily.
- Tile textures are `RGBA8`. Intermediate framebuffers use `RGBA16F` when `EXT_color_buffer_float` is
  available (it is on ANGLE and SwiftShader). Otherwise they use `RGBA8` with dithering.
- The compositor works in **premultiplied alpha** internally (converting on texture sample), and blends in
  **gamma-encoded sRGB space** to match Photoshop's default and the W3C formulas (see [ADR-0004](adr/0004-colour-management-srgb-8bit.md)).

### 5.2 Compositing

1. The viewport determines the visible tile range at the current zoom level. Below 50 % zoom, the
   compositor uses **mip levels** (per-tile downsampled textures generated lazily) to cap the texture
   bandwidth.
2. It walks the layer tree bottom-up per visible region, rendering into a ping-pong framebuffer pair:
   - Raster/Text/Shape: sample the layer texture → apply the mask → apply opacity → blend-mode shader against the backdrop.
   - Adjustment: a fullscreen pass applying the adjustment (a LUT texture for Levels/Curves/Hue-Sat, uniforms
     for the others) to the backdrop, then mixing by the adjustment layer's mask and opacity.
     *As built (M2 slice 4a):* `adjust.frag` redraws each visible tile of the current target from a copy
     of it, so an adjustment inside an isolated group changes only that group. Per-channel adjustments
     (Brightness/Contrast, Levels, Curves, Exposure, Invert, Posterize) are baked into one 256×1 RGBA8
     table, re-uploaded when the layer's adjustment object is replaced. The channel-mixing ones (Threshold,
     Hue/Saturation, Vibrance, Color Balance, Black & White, Photo Filter) are functions on 16 packed
     floats. The result is blended with the backdrop by the layer's blend mode and mixed in by opacity ×
     mask (× the clipping base), keeping the backdrop's alpha. `engine/ops/adjust.ts` is the CPU reference,
     used by flatten, merge and export. Its formulas follow GIMP's operations where Photoshop's are not
     published.
   - Group: pass-through groups composite children directly. Non-pass-through groups render into their own
     buffer, then blend.
   - Clipping: a clipped layer uses the base layer's alpha as an extra mask.
3. The result is drawn to the canvas with the view transform, plus a checkerboard for transparency and overlays.
4. **Dirty-rect rendering:** commands and tool previews report dirty rectangles, and only those are re-composited.
   A cache of the composite of layers below the active one ("below cache") speeds up painting on upper layers.

### 5.3 Brush engine

- Pointer events use `getCoalescedEvents()` for full tablet resolution, and optional
  `getPredictedEvents()` for drawing ahead of the pointer.
- The dab generator interpolates along the path with spacing = `max(1, size × spacing%)`. Pressure maps to
  size and opacity. Smoothing uses a lazy-mouse / pulled-string algorithm.
- Dabs render (instanced quads, procedural round tip or brush-tip texture) into a **stroke buffer**
  (R16F coverage). Flow accumulates per dab, and opacity caps the whole stroke (Photoshop semantics).
- Preview: the compositor draws `layer ⊕ strokeBuffer` live, so the layer itself is untouched during the stroke.
- **Commit on pointer-up:** the stroke buffer's coverage tiles are read back and the new layer tiles are
  computed **on the CPU** (`brush.ts applyStroke`) → new immutable tiles → `PaintTilesCommand` with the
  old and new tile refs → history. GPU textures are premultiplied (for correct mipmapping), and a GPU commit
  would round-trip low-alpha pixels the stroke never touched. The CPU path is exact and doubles as the
  reference that the preview shader is tested against. It measured about 17–22 ms per stroke in the M0 spike.
  An async PBO readback remains an optimisation option (ADR-0003 follow-ups).
- Eraser = the same pipeline with a destination-out blend. Clone stamp samples a source texture with an offset.

### 5.4 Selections

- The selection is a `Mask` (A8 tiles). Marquee and lasso shapes rasterize on the GPU (anti-aliased polygon fill).
- Magic wand and paint bucket use a **scanline flood fill** in the CPU-ops worker over the relevant tiles
  (transferred), with tolerance in RGB distance.
- Feather = separable Gaussian on the mask (GPU). Grow/shrink = distance-transform-based morphology (worker).
- Marching ants: an edge-detect shader on the mask with an animated dash, drawn in the overlay pass.

**As built (M2 slice 1a):** `engine/doc/selection.ts` keeps the mask as immutable 256 px A8 tiles (fully
selected tiles share one buffer; coverage outside the canvas is always 0). Marquee shapes rasterize on the
CPU, row by row into tiles: rectangles are exact, the ellipse and (1b) lasso polygons use 5 sub-scanlines
with exact horizontal span coverage, so no canvas-sized buffer is allocated. This is the CPU reference the
GPU path will be checked against if it is ever needed. The selection is saved in `.iep` (docs/05 §2), so it
also survives recovery snapshots and a tab moved to another window. The marching ants are an SVG path of the pixel
edges at 50 % coverage (`selection-outline.ts`) under the view transform, recomputed only when the mask
changes. Painting is clipped twice in the same way: `layer.frag` multiplies the stroke preview's coverage
by the tile's R8 mask texture, and `Editor.commitStroke` multiplies the read-back coverage by the same
mask (`gpu.gpu.test.ts` checks that they agree). Measured on a 6000 × 4000 canvas (Node 24, one core): a full-canvas ellipse
rasterizes in about 190 ms and its outline takes about 130 ms, both on the UI thread; moving them to the
ops worker is the next step if larger selections feel slow.

**Layer masks as built (M2 slice 2a):** a raster layer's `mask` keeps its coverage in the alpha channel of
ordinary RGBA tiles (RGB 0), with a 0/255 background outside them. That way every tile operation (move,
crop, rotate, flip, resample in the ops worker) transforms masks with their layers, at 4× the memory of
one-channel tiles. `.iep` stores them as one channel. `layer.frag` multiplies the layer by the mask before
opacity and blending (the CPU reference is `flatten.ts`); mask painting moves coverage toward the target
grey in the preview and in `applyMaskStroke` alike.

**Clipping masks as built (M2 slice 2b):** `flatten.ts` and `layer.frag` both multiply a clipped layer by
its base's alpha, mask and opacity (base tile and mask on texture units 6–7). This approximates Photoshop's
isolated clipping group: identical where the base is opaque, different where a semi-transparent base would
be covered by the clipped layer (see the roadmap for the exact model).

**Quick Mask as built (M2 slice 2b′):** a red overlay pass (`quickmask.frag`) after the composite tints
unselected pixels; a Quick Mask stroke previews coverage moving toward the painted grey and commits through
`applySelectionStroke` into a new immutable selection (`Mask.withTiles`), one SetSelectionCommand per stroke.

**Magic wand as built (slice 1b):** `engine/ops/wand.ts` runs as an `OpsJob` in the ops worker. It
composites the sampled layers tile by tile (`compositeTile`), marks pixels within tolerance of the seed
in a one-byte canvas bitmap (worker memory only), flood-fills it with a 4-connected scanline fill (or
keeps every match), and returns one-byte mask tiles. "Sample all layers" sends the document's layers as
a snapshot (a structured copy per click; caching the composite in the worker is a later optimisation).

### 5.5 Filters & adjustments

| Kind | Implementation |
| --- | --- |
| Adjustments (Levels, Curves, Hue/Sat, Color Balance, B&W, Photo Filter, Exposure, Vibrance, Invert, Posterize, Threshold, Brightness/Contrast) | GPU fragment shaders. Curve and level adjustments are baked into 256×1 LUT textures. Used both as adjustment layers and as destructive commands (render into new tiles). |
| Gaussian/Box/Motion blur, Sharpen, Unsharp mask, Emboss, Find edges, Pixelate, Vignette, Add noise | GPU multi-pass shaders (separable where possible) over tiles with an apron (radius padding from neighbour tiles) |
| Median (reduce noise), auto-levels, histogram | CPU worker (histogram via GPU reduction later if needed). *As built (M2 4c):* `engine/ops/histogram.ts` composites tile by tile in the ops worker (within the selection), and the editor runs it without blocking editing, dropping stale results; Auto Tone/Contrast/Color turn it into Levels (`autoLevels`) applied like Image › Adjustments. |

Destructive filters produce a `FilterCommand` (old/new tiles within the selection bounds). Previews run
on a downscaled proxy while a slider is being dragged, then at full resolution on release.

*As built (M2 slice 5a):* filters run on the CPU, in `engine/ops/filters.ts`, which is the reference for
a later GPU path. They act on the canvas area of the active layer, with edges repeated, and mix with the
original by the selection's coverage.
- **Separable blurs** (Gaussian, Box, and the Unsharp Mask/Sharpen blur) stream the rows. Each row is
  blurred along itself, then fed through running-sum stages down the columns, so every pixel is blurred
  once per direction. Gaussian is three boxes (Kovesi) above radius 3, and an exact kernel below.
- **Parallelism:** `lib/ops.ts` splits filter jobs into bands of tile rows across a pool of up to 4 ops
  workers, started when the page is idle. Each band gets only the tiles it reads.
- **Preview:** the full-resolution result for the tiles in view (no proxy yet), recomputed 120 ms after
  the last change, one job at a time, with stale results dropped. The commit is `replaceLayers` (one
  undo step); there is no separate `FilterCommand`.
- **Timing:** Gaussian radius 50 on 24 MP took 1.2 s on a 4-core i7-1185G7 in slice 5a. Slice 5c brought
  it to 1.0 s on the CPU: single-pass vertical stages, no row copies, and each band transferred as one
  buffer. A GPU path stays open if the release matrix needs it.
- **Window filters** (slice 5b: Motion Blur, Add Noise, Reduce Noise, Mosaic, Emboss, Find Edges,
  Vignette) compute each output tile from a window of the tile plus the filter's reach, with edges
  repeated (`engine/ops/window-filters.ts`). They are split across the pool the same way.

### 5.6 Transforms & resampling

- Free transform: a live preview as a textured quad with an affine (later projective) matrix. On commit,
  it re-rasterizes into tiles with bicubic sampling in the shader.
  *As built (M2 slice 3a):* the preview draws each tile of the transformed layers through a `u_transform`
  matrix in `tile.vert`, sampled bilinear (nearest from 200 %); the other layers and the blend stack are
  unchanged. The commit runs on the CPU in the ops worker (`engine/ops/affine.ts`). It inverse-maps each
  destination pixel and samples bicubic in premultiplied alpha. For reductions it widens the kernel by the
  inverse scale along each source axis, so the result does not alias. Flips and quarter turns at 100 % are
  snapped to whole-pixel offsets, so they are exact copies. A linked mask is transformed with its layer.
  A reveal-all mask is inverted before and after the transform, so its missing tiles stay revealed. A GPU
  commit path is a later optimisation, as for Image Size.
  *Selections (slice 3b):* `engine/doc/float.ts` splits each layer by the selection's coverage. Whole tiles
  are shared, and only the tiles along the edge are computed on the UI thread. The preview renders a
  preview-only `Document` in which each layer is an isolated group: what stays (with the layer mask)
  under the lifted part (drawn through the matrix). The group carries the layer's blend mode and opacity,
  so it combines the parts exactly as the commit does. The job transforms the lifted pixels and the
  selection (as RGBA coverage), puts the pixels over what stayed, and `replaceLayers` sets the new
  selection in the same undo step (`TreeEdit.selection`).
- Trim and Reveal All (FR-TRF-06, slice 3c) are crops. For Trim, the ops worker composites tile by tile
  (`engine/ops/trim.ts`) and returns the pixels to keep as a mask, and the editor crops to its bounds,
  deleting what falls outside. Reveal All crops to the union of the canvas and every raster layer's
  content bounds, keeping all pixels.
- Image size: Lanczos3 / bicubic / bilinear / nearest, as two-pass separable resampling in premultiplied
  gamma space, widened when downscaling, edges extended at the canvas. M1 runs it on the CPU in the ops
  worker (`engine/ops/resample.ts`, band by band so memory follows the output width); a GPU path for
  sizes within the VRAM budget is a later optimisation. Arbitrary rotation inverse-maps each output pixel
  with Catmull-Rom bicubic in the same worker. 90° rotations and flips are exact tile copies.

### 5.7 Text & shapes

- Text: laid out and rendered with `OffscreenCanvas` 2D (`fillText`, letter spacing via `canvas.letterSpacing`,
  runs drawn sequentially) at document resolution into the layer's `cachedRaster`. Chromium does the
  shaping, so complex scripts, RTL and emoji work. Fonts are enumerated through `queryLocalFonts()`.
  Editing on the canvas uses a positioned, transparent `contenteditable` overlay, synchronised with the
  layer model (IME-friendly).
- Shapes: `Path2D` rendered by Canvas2D into `cachedRaster` (anti-aliased), with parameters kept for re-editing.

## 6. History

- Every document mutation is a `Command { label, do(doc), undo(doc), dirtyRect, sizeBytes }`.
- Tile-based commands hold `{ layerId, tileKeys, before: TileRef[], after: TileRef[] }`. Because tiles are
  immutable, do/undo only swaps references, in O(tiles).
- Structural commands (add/delete/reorder layer, change blend mode, edit adjustment params, text edit) store
  small property diffs.
- **Coalescing:** slider drags merge into one command. Continuous nudges within 500 ms merge.
- **Limits:** the max step count (default 100) *and* the memory budget. The oldest steps drop first, but
  tiles still referenced by the live document are never dropped.
- Snapshots = named, pinned history states (they never expire). They share tiles but own copies of the layer
  objects and tile maps (paint commands update a layer's map in place). Restoring one is a new undoable
  step, so it never discards history. The first snapshot is the document as opened.
- Tabs (FR-DOC-03): the Editor shows one document on its canvas; the others are background sessions
  (document, history, file state, view, snapshots). Switching swaps them; GPU textures rebuild lazily from
  the tiles, and the document version changes so caches keyed by it (the export flatten) never serve
  another document.
- The view (zoom/pan) is a separate store from the editor snapshot: overlays such as scrollbars and the crop
  box subscribe to it, so panning at 60 fps never re-renders the panels.

## 7. File I/O flows

### 7.1 Open (raster)

```mermaid
sequenceDiagram
    participant UI as Renderer
    participant M as Main
    participant C as codec-host (sharp)
    UI->>M: api.file.open() → dialog
    M->>M: user picks file → create FileRef, open MessagePort pair
    M->>C: decode {path, limitInputPixels: 400 MP} + port A
    M-->>UI: {docRequestId} + port B
    C->>C: sharp(path).rotate() (EXIF) .toColourspace('srgb') (ICC convert) .ensureAlpha().raw()
    C-->>UI: via port: {width, height, metadata, iccName} + RGBA8 buffer (transferred in 16 MB chunks)
    UI->>UI: slice into tiles → new Document → render
```

### 7.2 Save `.iep` and export

- **Save `.iep`:** the file worker serialises the manifest plus sparse tiles (deflate) and a preview PNG into a
  zip (fflate) → bytes to main → main writes `<name>.iep.tmp` → `fsync` → `rename` (atomic, NFR-REL-01).
- **Export (PNG/JPEG/…):** the compositor renders the flattened image in tile bands → straight RGBA8 buffer
  → codec-host encodes (quality, metadata policy, sRGB ICC embed) → bytes → main writes atomically.
- **PSD import/export:** main reads bytes → file worker (ag-psd) ↔ document model mapping ([09 §3](09-file-formats-color.md#3-psd-mapping)).
- **Autosave recovery:** every N minutes, if the document is dirty, write an `.iep` snapshot to
  `<userData>/recovery/<docId>.iep` (low priority, in chunks so the UI doesn't stall). Deleted on a clean
  save or close.

### 7.3 Batch

A separate **Batch window** (its own renderer) builds a pipeline spec. Main hands it to codec-host, which
runs sharp pipelines with a concurrency of `min(cores − 1, 4)` and streams progress events back. The AI
batch step (background removal) runs in the Batch window's AI worker, per image, between the decode and
encode steps.

## 8. AI (on-device)

- The **AI worker** loads `onnxruntime-web`: first the WebGPU execution provider, falling back to WASM
  (SIMD + threads, needs cross-origin isolation, see §2).
- Pipeline: the layer's composite region → resize to the model's input size (e.g. 1024²) → normalize →
  infer → alpha matte → upscale (guided by the original image) → Mask tiles → `AddMaskCommand` or selection.
- Models are downloaded by main (after consent), verified by SHA-256, stored in `<userData>/models/`, and
  served to the renderer through `app://models/<name>` (read-only).

## 9. Proposed folder structure (`app/`)

```
app/
├── electron.vite.config.ts        # renderer + preload + main + codec-host entry points
├── electron-builder.yml
├── src/
│   ├── main/        (index.ts, windows.ts, menu.ts, protocol.ts, files.ts, recovery.ts, models.ts, updater.ts, ipc/)
│   ├── codec-host/  (index.ts, decode.ts, encode.ts, batch.ts, metadata.ts)
│   ├── preload/     (index.ts)
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/{engine/, ui/, state/, workers/, i18n/, main.tsx}
│   └── shared/      (ipc-contract.ts, schemas.ts, formats.ts, iep-schema.ts)
├── test/
│   ├── unit/ golden/ fixtures/ fuzz/
└── e2e/
```

## 10. Technology choices

| Decision | Choice | ADR |
| --- | --- | --- |
| Decision records | Markdown ADRs | [0001](adr/0001-record-architecture-decisions.md) |
| App stack | Electron + electron-vite + React + TS + Tailwind + Zustand | [0002](adr/0002-app-stack-electron-react.md) |
| Rendering engine | Sparse immutable tiles + WebGL2 compositor, CPU source of truth | [0003](adr/0003-tiled-document-webgl2-engine.md) |
| Colour | 8-bit sRGB working space, ICC → sRGB on import, gamma-space blending | [0004](adr/0004-colour-management-srgb-8bit.md) |
| Editing model | Adjustment layers + masks, command history over immutable tiles, OPFS spill | [0005](adr/0005-non-destructive-model-and-history.md) |
| AI | onnxruntime-web in a worker, permissive models, on-demand download | [0006](adr/0006-on-device-ai-models.md) |
| Project format | `.iep` = zip(manifest.json + deflated sparse tiles + preview.png) | [0007](adr/0007-native-project-format-iep.md) |
| Codecs | sharp in a utilityProcess. ag-psd and fflate in workers. | [0008](adr/0008-codec-host-utility-process.md) |

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Engine complexity (tiles + GPU + history) underestimated | High | High | M0 spike builds the vertical slice first: tiles → composite → brush → undo. Golden tests from day one. |
| GPU driver bugs / blocklisted GPUs | Medium | Medium | CPU is the source of truth. SwiftShader fallback. Nightly tests on 3 GPU vendors (manual matrix before release). |
| Readback stalls hurt brush commit latency | Medium | Medium | Async PBO readback. Commit only the dirty tiles. |
| Memory blow-up with big documents | Medium | High | Sparse tiles, budgets, spill, a warning dialog above 500 MP total |
| PSD edge cases | High | Low | Documented support matrix. Rasterize the unknown with a notice. Fixture corpus. |
| AI model licensing | Medium | High | License gate in ADR-0006. Legal check before shipping a model. |
| Photoshop trade-dress similarity | Low | Medium | Our own icons, brand colour and layout details. Shortcuts are functional and not protected. |
