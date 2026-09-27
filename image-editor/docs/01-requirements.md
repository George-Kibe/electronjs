# 01 — Requirements (PRD): ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Owner | George Kibe |
| Last updated | 2026-09-27 |
| Related | [Architecture](02-architecture.md) · [Roadmap](10-roadmap.md) |

## 1. Purpose & vision

A free, fast, private desktop image editor that covers the **primary** features of Photoshop-class
software: layers, selections, masks, adjustments, painting, text, transforms and PSD compatibility. Its
workspace should be approachable for hobbyists and everyday users (Paint.NET / Photopea level), with
familiar Photoshop shortcuts for those who know them.

### 1.1 Goals

- G1: Everyday edits (crop, resize, adjust colours, remove background, add text, export) take under a minute.
- G2: The app stays smooth on large images (24 MP photos, 20+ layers). Painting feels immediate.
- G3: Non-destructive by default: adjustment layers, masks, and deep undo that doesn't lose work.
- G4: Works offline and privately. Images and AI processing never leave the device.
- G5: Interoperates with the wider world: PSD round-trip of the basics, and correct colour on phone and camera images.

### 1.2 Non-goals (v1)

- Camera RAW development, CMYK/print workflows, 16/32-bit per channel, HDR
- Vector illustration (beyond basic shape layers), animation/timeline, video, 3D
- Content-aware fill/healing with advanced inpainting (the healing brush is "Could"), generative AI
- Plugin system, scripting API
- Cloud storage/collaboration

## 2. Personas

| Persona | Needs |
| --- | --- |
| **Hana — hobby photographer** | Crops and straightens, fixes exposure and colour, exports for Instagram at the right size |
| **Isaac — small-business owner** | Removes product backgrounds, adds text/price tags, batch-resizes 200 product photos |
| **Joy — student/meme maker** | Layers, text, stickers, brush doodles, fun filters. Opens a PSD a friend sent. |

## 3. Functional requirements

Priority: MoSCoW. Milestones: see [Roadmap](10-roadmap.md).

### 3.1 Documents & files (DOC)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-DOC-01 | New document dialog: width, height (px, max 20,000 × 20,000), resolution (PPI metadata), background (white/black/transparent/custom), with presets (Instagram post/story, A4 @300, 1080p, 4K, and custom saved presets). | M | M1 |
| FR-DOC-02 | Open PNG, JPEG, WebP, AVIF, GIF (first frame), BMP, TIFF (first page). Also open by drag and drop, "Open recent", file associations and paste from the clipboard (as a new document). | M | M1 |
| FR-DOC-03 | Multiple documents open in tabs. A document can be dragged out into its own window. | M | M1 |
| FR-DOC-04 | Save/open the native layered project format `.iep`, which preserves everything (layers, masks, adjustment layers, text, guides). | M | M1 |
| FR-DOC-05 | Export: PNG, JPEG (quality, progressive, chroma subsampling), WebP (lossy/lossless), AVIF, GIF, BMP and TIFF, with a live size estimate and a before/after preview. "Export As" can resize on export. | M | M1 |
| FR-DOC-06 | Quick Export as PNG/JPEG with the last settings (shortcut: [03 §6](03-ui-ux-design.md#6-keyboard-shortcuts)). | S | M1 |
| FR-DOC-07 | PSD import: raster layers, groups, opacity, blend modes, visibility, layer masks, text layers (as editable text when the fonts are available, otherwise rasterized), and adjustment layers we support. Everything else is rasterized from the composite and a warning is shown. | M | M3 |
| FR-DOC-08 | PSD export: raster/text/group layers, masks, blend modes, opacity, and a composite image. Adjustment layers we support are exported as PSD adjustment layers. | S | M3 |
| FR-DOC-09 | Metadata: keep EXIF orientation on import (apply it). On export, choose "Keep metadata", "Remove location (GPS)" (default) or "Remove all". | M | M1 |
| FR-DOC-10 | Autosave recovery snapshots every 2 minutes (configurable). After a crash, offer to restore on the next launch. | M | M1 |
| FR-DOC-11 | "Revert" to the last saved version. Warn about unsaved changes on close or quit. | M | M1 |
| FR-DOC-12 | Paste from the clipboard as a new layer. Copy selection / copy merged to the clipboard as PNG (with transparency where the OS supports it). | M | M1 |
| FR-DOC-13 | HEIC/HEIF import. | C | Future ([09 §2](09-file-formats-color.md#2-codecs)) |

### 3.2 Canvas & navigation (NAV)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-NAV-01 | Zoom 1 %–6400 %: scroll + Ctrl/⌘, pinch (trackpad), Z tool, fit to screen, 100 %. Pixel grid shown at ≥ 800 %. | M | M1 |
| FR-NAV-02 | Pan with the Space-drag, the H tool, scrollbars, and two-finger trackpad scroll. | M | M1 |
| FR-NAV-03 | Rotate view (R tool) without changing pixels. | C | M4 |
| FR-NAV-04 | Rulers (px/in/cm/%), guides (drag from rulers), snapping to guides, layer edges and canvas bounds. Optional grid overlay. | S | M2 |
| FR-NAV-05 | Navigator panel with a thumbnail and viewport rectangle. | S | M2 |
| FR-NAV-06 | Status bar: zoom, document size, cursor position, colour under the cursor, memory use. | M | M1 |

### 3.3 Layers (LAY)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-LAY-01 | Layer types: raster, text, shape, adjustment, group. | M | M1 (raster/group), M2 (adjustment), M3 (text/shape) |
| FR-LAY-02 | Operations: new, duplicate, delete, rename, reorder (drag), show/hide, lock (all/pixels/position/transparency), merge down, merge visible, flatten, rasterize. | M | M1 |
| FR-LAY-03 | Opacity and fill (0–100 %). 18 blend modes: Normal, Dissolve, Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge, Linear Dodge (Add), Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity. | M | M1 (Normal + 8 common), M2 (rest) |
| FR-LAY-04 | Layer masks: add (reveal all / hide all / from selection), paint on the mask, disable, apply, invert, link/unlink. Alt-click shows the mask. | M | M2 |
| FR-LAY-05 | Clipping masks (clip a layer to the one below). | S | M2 |
| FR-LAY-06 | Layer thumbnails update live (throttled). | M | M1 |
| FR-LAY-07 | Layer styles: drop shadow, stroke, outer glow (non-destructive, rendered on the GPU). | S | M3 |
| FR-LAY-08 | Select multiple layers to move, transform, group, align and distribute them. | S | M2 |

### 3.4 Selections (SEL)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-SEL-01 | Rectangular and elliptical marquee, with fixed ratio/size and Shift (constrain) / Alt (from centre) modifiers. | M | M2 |
| FR-SEL-02 | Lasso (freehand) and polygonal lasso. | M | M2 |
| FR-SEL-03 | Magic wand: tolerance, contiguous, anti-alias, sample current layer or all layers. | M | M2 |
| FR-SEL-04 | Selection modes: new, add (Shift), subtract (Alt), intersect (Shift+Alt). | M | M2 |
| FR-SEL-05 | Select all/none/inverse, reselect, feather, grow/shrink (expand/contract), border, smooth, and colour range (basic). | M | M2 |
| FR-SEL-06 | Anti-aliased (8-bit) selection mask shown as marching ants. Quick Mask mode (Q) to paint the selection. | S | M2 |
| FR-SEL-07 | Save and load selections as channels in the document. | C | M4 |
| FR-SEL-08 | **Select subject** (AI) creates a selection of the main subject. | S | M4 |

### 3.5 Transform & image operations (TRF)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-TRF-01 | Crop tool: ratio presets, rule-of-thirds overlay, straighten (draw a horizon line), "delete cropped pixels" option. | M | M1 |
| FR-TRF-02 | Image size (resample: bicubic, bilinear, nearest, Lanczos), with a constrain-proportions toggle. Canvas size with anchor. | M | M1 |
| FR-TRF-03 | Rotate canvas 90°/180°/arbitrary. Flip canvas horizontally or vertically. | M | M1 |
| FR-TRF-04 | Free transform (Ctrl+T) on a layer or selection: move, scale, rotate, skew, flip, with numeric entry in the options bar and a live GPU preview. | M | M2 |
| FR-TRF-05 | Distort and perspective transform. | S | M4 |
| FR-TRF-06 | Trim transparent edges. "Reveal all". | S | M2 |
| FR-TRF-07 | Move tool: auto-select layer, align/distribute, and nudge with the arrow keys (Shift = 10 px). | M | M1 |

### 3.6 Adjustments & filters (ADJ / FLT)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-ADJ-01 | Adjustments, available both as **adjustment layers** (non-destructive) and as direct commands: Brightness/Contrast, Levels, Curves (RGB + per channel), Exposure, Vibrance, Hue/Saturation (with colorize), Color Balance, Black & White, Photo Filter, Invert, Posterize, Threshold. | M | M2 |
| FR-ADJ-02 | Auto Tone, Auto Contrast and Auto Color (histogram-based). | S | M2 |
| FR-ADJ-03 | Histogram panel (RGB, luminosity, per channel). | S | M2 |
| FR-FLT-01 | Filters (destructive, with live preview on the canvas and in the dialog; they respect the selection): Gaussian Blur, Box Blur, Motion Blur, Sharpen, Unsharp Mask, Add Noise, Reduce Noise (median), Pixelate (mosaic), Emboss, Find Edges, Vignette. | M | M2 |
| FR-FLT-02 | Repeat the last filter (Ctrl+Alt+F). Fade the last filter (opacity + blend mode). | C | M4 |
| FR-FLT-03 | Smart filters (non-destructive filters on a layer). | C | Future |

### 3.7 Painting & drawing tools (PNT)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-PNT-01 | Brush: size, hardness, opacity, flow, spacing, smoothing. Round and a small set of textured presets. Pen pressure → size/opacity (Pointer Events: Windows Ink, macOS tablets, Wacom on Linux). | M | M1 |
| FR-PNT-02 | Pencil (aliased, 1-px capable) and eraser (brush/pencil modes, erases to transparency or background colour). | M | M1 |
| FR-PNT-03 | Paint bucket: tolerance, contiguous, sample current or all layers, anti-alias. | M | M3 |
| FR-PNT-04 | Gradient: linear, radial, angle, reflected, diamond. Foreground-to-background, foreground-to-transparent and custom presets. Opacity, blend mode, dither. | M | M3 |
| FR-PNT-05 | Clone stamp: Alt-click the source, aligned/non-aligned, sample current/all layers. | M | M3 |
| FR-PNT-06 | Eyedropper: point, 3×3 or 5×5 average, current or all layers. Alt temporarily switches brush tools to the eyedropper. | M | M1 |
| FR-PNT-07 | Colour picker dialog (HSB/RGB/hex), foreground/background swatches, swap (X), default (D), recent colours, Swatches panel. | M | M1 |
| FR-PNT-08 | Shape tools: rectangle, rounded rectangle, ellipse, line/arrow, polygon/star. They create editable shape layers with fill and stroke (colour, width, dash). | M | M3 |
| FR-PNT-09 | Healing brush / spot healing (basic texture-matching blend). | C | Future |
| FR-PNT-10 | Brush modes use the blend modes. "Lock transparent pixels" is respected. | S | M3 |

### 3.8 Text (TXT)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-TXT-01 | Point text and paragraph (box) text layers, editable in place on the canvas. | M | M3 |
| FR-TXT-02 | Font family from **installed system fonts** (Local Font Access API), size, weight/style, colour, alignment, line height, letter spacing, underline/strikethrough. Per-character styling in v1: colour, weight, size. | M | M3 |
| FR-TXT-03 | Complex scripts, emoji and RTL shape correctly (Chromium's text shaping). | M | M3 |
| FR-TXT-04 | Warp text (arc, bulge). | C | Future |

### 3.9 History (HIS)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-HIS-01 | Undo/redo (Ctrl+Z / Ctrl+Shift+Z, plus Ctrl+Y on Windows) for every document change. Default 100 steps, configurable 20–1000, bounded by a memory budget. | M | M1 |
| FR-HIS-02 | History panel: click a state to go back. Snapshots can be taken and restored. | M | M1 |
| FR-HIS-03 | History beyond the RAM budget spills to a disk scratch file instead of being discarded. | S | M2 |

### 3.10 Batch processing (BAT)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-BAT-01 | Batch window: add files/folders (with an optional recursive flag), then build an action chain: Resize (fit/fill/exact, by px or %), Convert format + quality, Rotate/Flip, Auto-orient, Strip metadata, Watermark (text or image, position, opacity), Rename (pattern with `{name}`, `{n}`, `{date}`), Output folder. | M | M4 |
| FR-BAT-02 | Progress with per-file status. Cancel. Errors don't stop the batch. A report is produced at the end. | M | M4 |
| FR-BAT-03 | Save and load batch presets. | S | M4 |
| FR-BAT-04 | Use multiple cores (a concurrency setting). Throughput is ≥ 80 % of raw sharp. | M | M4 |
| FR-BAT-05 | Batch background removal (AI) → transparent PNG/WebP. | S | M4 |

### 3.11 AI tools, on-device (AI)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-AI-01 | **Remove background:** creates a layer mask (non-destructive) that hides the background of the current layer. | M | M4 |
| FR-AI-02 | **Select subject:** converts the model output into a selection (FR-SEL-08). | S | M4 |
| FR-AI-03 | Models run on-device (WebGPU when available, otherwise WASM SIMD with multiple threads). No image data leaves the device. | M | M4 |
| FR-AI-04 | Models download on first use from a pinned URL with SHA-256 verification, with a size shown beforehand, progress and cancel. They can be removed in Settings. An offline installer variant with the model bundled is optional. | M | M4 |
| FR-AI-05 | Only models under a permissive license (MIT/Apache-2.0/BSD) that allows commercial use. | M | M4 |

### 3.12 Workspace & general (GEN)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-GEN-01 | Workspace: toolbar (left), options bar (top), dockable/collapsible panels (right): Layers, Properties/Adjustments, History, Color, Swatches, Navigator, Histogram. Presets: "Essentials" (default, simple) and "Photography". Reset workspace. | M | M1 |
| FR-GEN-02 | Light/dark/system theme. Neutral grey canvas background (adjustable). | M | M1 |
| FR-GEN-03 | Photoshop-compatible default keyboard shortcuts ([03 §6](03-ui-ux-design.md#6-keyboard-shortcuts)). Shortcuts can be customised. | M | M1 (defaults), M4 (customisation) |
| FR-GEN-04 | Preferences: history steps, memory budget, scratch space limit, autosave interval, GPU on/off (fallback), units, cursor style (brush outline/precise), interface scale. | M | M1 |
| FR-GEN-05 | Auto-update (signed) with a restart prompt that never interrupts unsaved work. | M | M1 |
| FR-GEN-06 | i18n-ready. English at launch, Swahili next. | S | M5 |
| FR-GEN-07 | Telemetry off. Opt-in crash reports without image content or file names. | M | M1 |
| FR-GEN-08 | Welcome screen: new, open, recent files with thumbnails, quick-start tips. | S | M1 |

## 4. Non-functional requirements

Reference machine ("mid-range"): 4-core CPU, 8 GB RAM, integrated GPU (Intel Iris Xe / Apple M1 / AMD Vega), 1080p–1440p display.

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-PERF-01 | Performance | Open a 24 MP JPEG and show it in < 1.5 s. Open a 50-layer 4K PSD in < 5 s. |
| NFR-PERF-02 | Performance | Brush latency (pointer event → pixels on screen) < 16 ms p95 for a 200 px brush on a 6000×4000 document. |
| NFR-PERF-03 | Performance | Pan and zoom at 60 fps on a 24 MP, 20-layer document. |
| NFR-PERF-04 | Performance | Adjustment-layer slider preview updates at ≥ 30 fps on a 24 MP document. |
| NFR-PERF-05 | Performance | Gaussian blur radius 50 on a 24 MP layer takes < 1 s (GPU). |
| NFR-PERF-06 | Performance | AI background removal on a 12 MP photo takes < 4 s with WebGPU and < 15 s with WASM. |
| NFR-PERF-07 | Performance | Cold start to welcome screen < 2 s. |
| NFR-MEM-01 | Memory | A 24 MP document with 20 full layers + 100 history steps stays within a 4 GB app budget (tile sparsity + history spill). |
| NFR-MEM-02 | Memory | Idle memory with no document < 250 MB. |
| NFR-REL-01 | Reliability | No work loss: autosave recovery restores to within 2 minutes of a crash. Saves are atomic (temp file + rename). |
| NFR-REL-02 | Reliability | GPU context loss (driver reset, sleep/resume) recovers automatically without losing pixels (the CPU tiles are the source of truth). |
| NFR-REL-03 | Reliability | Crash-free sessions ≥ 99.5 %. |
| NFR-QUAL-01 | Quality | Blend modes match the W3C Compositing & Blending Level 1 formulas within ±1/255 per channel (8-bit). |
| NFR-QUAL-02 | Quality | PSD round trip (import → export → import) of the supported features is visually identical (ΔE < 1 on the composite). |
| NFR-QUAL-03 | Quality | Colour-managed import: an image with Display-P3 or Adobe RGB ICC shows the same as in macOS Preview / Windows Photos (ΔE < 2 after conversion to sRGB). |
| NFR-SEC-01 | Security | Electron hardening baseline. Untrusted images are decoded only in isolated processes/workers ([Security](06-security.md)). |
| NFR-SEC-02 | Security | Works fully offline. Network only for update checks and the opt-in model download. |
| NFR-UX-01 | Accessibility | WCAG 2.2 AA for all UI chrome (panels, dialogs, menus). Every tool and command is reachable by keyboard. The canvas has a text alternative for its state (layer, selection, size). |
| NFR-COMP-01 | Compatibility | Windows 10 22H2+/11 (x64, arm64). macOS 12+ (x64, arm64). Ubuntu 22.04+/Fedora 40+ (x64, arm64). WebGL2 required. When the GPU is blocklisted, the app falls back to software WebGL (SwiftShader) with a warning that it will be slower. |
| NFR-SIZE-01 | Size | Installer < 150 MB without an AI model. |
| NFR-MAINT-01 | Maintainability | Coverage: engine `doc/` and `history/` ≥ 90 %. Shaders are covered by golden tests. Overall renderer ≥ 70 %. |

## 5. Key user stories & acceptance criteria

**US-01 Quick photo fix (FR-DOC-02/05, FR-TRF-01, FR-ADJ-01)**
- *Given* a 24 MP iPhone JPEG (Display-P3 profile, rotated EXIF), *when* Hana opens it, *then* it appears
  upright with correct colours in < 1.5 s.
- She crops to 4:5, adds a Levels adjustment layer, and exports JPEG at quality 85 resized to 1080 px wide
  with "Remove location" on. The export has no GPS EXIF and has an sRGB profile embedded.

**US-02 Product background (FR-AI-01, FR-LAY-04, FR-TXT-01)**
- *Given* a product photo, *when* Isaac clicks "Remove background", *then* a mask is added in < 4 s (WebGPU).
  He can refine it with the brush on the mask, add a text layer "KSh 1,500" in a system font, and save `.iep`.
  Reopening shows the text layer still editable.

**US-03 Undo safety (FR-HIS-01..03, NFR-REL-01)**
- *Given* 150 brush strokes on a 24 MP document with a 100-step history, *then* undo works 100 steps back
  without the app exceeding its memory budget. If the app is killed, the next launch offers recovery with ≤ 2 min loss.

**US-04 PSD from a friend (FR-DOC-07)**
- *Given* a PSD with groups, masks, a text layer and a smart object, *when* Joy opens it, *then* the groups,
  masks and text are preserved, the smart object is rasterized, and a non-blocking notice lists what was rasterized.

**US-05 Batch (FR-BAT-01/02)**
- *Given* 200 JPEGs in a folder, *when* Isaac runs "Resize fit 1200 px → WebP q80 → rename `{name}-web`",
  *then* all are processed with progress, one corrupt file is reported without stopping the batch, and it
  finishes in < 60 s on the reference machine.

## 6. Constraints & assumptions

- WebGL2 is available on all supported OSes through Chromium (ANGLE: D3D11 on Windows, Metal on macOS,
  GL/Vulkan on Linux). WebGPU is used opportunistically for AI only (in v1).
- `MAX_TEXTURE_SIZE` is commonly 16384. Tiling means document size is limited by memory, not texture size.
- HEIC decoding carries HEVC patent and licensing complexity, so it is deferred.
- The Local Font Access API requires a permission prompt in Chromium. Electron grants it through the
  permission handler for our origin only.

## 7. Open questions

| # | Question | Due |
| --- | --- | --- |
| Q1 | Final product name, app ID, project file extension (`.iep` placeholder), icon | Before M1 release |
| Q2 | Which AI segmentation model? Quality vs size (see [ADR-0006](adr/0006-on-device-ai-models.md)) | M4 start |
| Q3 | Ship an "offline" installer variant with the AI model bundled? | M4 |
| Q4 | HEIC import via the OS codec (Windows HEIF extension / macOS ImageIO) as a later feature? | M5 |
