# Changelog

All notable changes to ImageEditor are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Save and open projects (`.iep`) with every layer, its opacity, blend mode and locks; Save, Save As and
  Revert. Saving is atomic, so a crash never damages the previous file.
- Export As (PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF) with quality and format options, resize on export, a live
  file-size estimate and a before/after preview. Quick Export as PNG.
- Location data (GPS) is removed from exported JPEG and PNG files by default; choose "Keep metadata" or
  "Remove all" instead. Exported images are always upright and tagged sRGB.
- "Save changes?" prompt when closing, quitting, opening another file, creating a new document or reverting
  with unsaved changes. The window title shows the document name and a dot for unsaved changes.
- Open BMP images (they previously failed to open).
- File, Edit, Layer and View menus with the standard shortcuts.
- Layer groups (drag layers in and out, collapse, pass-through or isolated), duplicate (Ctrl+J), group
  (Ctrl+G) and ungroup, bring forward/send backward (Ctrl+] / Ctrl+[), merge down (Ctrl+E), merge visible,
  flatten, rename by double-click, and layer thumbnails.
- Blend modes Darken, Multiply, Lighten, Screen, Overlay, Soft Light, Hard Light and Difference; fill
  opacity; layer locks (lock all, lock pixels, lock transparent pixels).
- Brush options: spacing, smoothing, pen pressure for size and opacity, and textured tips (Chalk, Charcoal,
  Sponge). Each painting tool keeps its own settings; "Reset tool" restores them.
- Pencil (Shift+B): hard-edged, down to single pixels. The eraser has a pencil mode, and paints the
  background colour on layers with locked transparency.
- Eyedropper (I): point, 3×3 or 5×5 average, from the current layer or all layers. Hold Alt with the brush or
  pencil to pick a colour; Alt+click with the eyedropper sets the background colour.
- Foreground and background colours with a colour picker (HSB, RGB and hex), swap (X), default black and
  white (D), recently used colours and a Swatches panel.
- Move tool (V): drag a layer or a whole group, auto-select the layer under the pointer, nudge with the arrow
  keys (Shift for 10 px), align to the canvas (Layer › Align to Canvas), and hold Ctrl/⌘ with a painting
  tool to move. Pixels moved off the canvas are kept, so moving them back restores them. The position lock
  is enforced.
- Crop tool (C): drag the box or its handles, ratio presets (1:1, 4:5, 16:9…), exact X/Y/W/H fields, a
  rule-of-thirds grid while dragging, Straighten (draw along the horizon) and "Delete cropped pixels" (off
  keeps the hidden pixels). Enter crops, Esc resets the box.
- Image › Image Size (Ctrl+Alt+I) with bicubic, bilinear, nearest-neighbour or Lanczos resampling, and Canvas
  Size (Ctrl+Alt+C) with an anchor. Image › Image Rotation: 180°, 90° either way, any angle, and flip
  horizontal/vertical. Large images are processed in the background with progress.
- Zoom In/Out step through standard levels (1 %–6400 %), and the zoom can be typed in the status bar. A pixel
  grid appears from 800 % (View › Pixel Grid). Scrollbars pan the canvas.
- The status bar shows the colour under the pointer, memory use (amber when nearly full) and the progress
  of long operations.
- History snapshots: keep a state with the camera button and return to it later; the document as opened
  is always available. Ctrl+Alt+Z steps backward.
- Preferences (Ctrl+, or ⌘,): light, dark or system theme; interface scale; the grey around the canvas;
  brush-outline or precise cursor; number of history steps and memory for history; turn graphics
  acceleration off.
- The brush shows its outline at the actual size on the canvas. Opacity presets with 1…0 while painting.
- M0 app (`app/`): open images (PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF) with EXIF orientation and ICC → sRGB
  conversion, or create a new document. Brush and eraser with size, hardness, opacity, flow and colour.
  Layers (add, delete, show/hide, opacity), undo/redo with a History panel, pan/zoom, Photoshop-style shortcuts.
- WebGL2 tile engine with GPU preview and exact CPU commit. The codec runs in an isolated process. The app
  is served from a cross-origin-isolated `app://` origin with a strict CSP.
- Tests: engine unit and property tests, GPU conformance tests (shaders vs CPU reference), Electron E2E on
  Linux, Windows and macOS against the built and the packaged app.
- The canvas recovers when the graphics driver resets (WebGL context loss) without losing the document or
  history.

### Fixed
- Dialog fields no longer lose focus while you type.
- On displays with fractional scaling, the canvas could grow beyond the window and hide the document.

### Changed
- Renamed the project from `image-resizer` to `image-editor`. Removed the legacy plain-JS resizer
  (available in git history at `3eadc27`). Its batch-resize purpose lives on as the Batch feature.

### Added
- Project documentation: requirements, architecture, UI/UX design, IPC & command API, data model,
  security, testing, CI/CD, file formats & colour, roadmap, ADRs 0001–0008.
