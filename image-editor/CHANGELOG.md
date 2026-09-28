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
- M0 app (`app/`): open images (PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF) with EXIF orientation and ICC → sRGB
  conversion, or create a new document. Brush and eraser with size, hardness, opacity, flow and colour.
  Layers (add, delete, show/hide, opacity), undo/redo with a History panel, pan/zoom, Photoshop-style shortcuts.
- WebGL2 tile engine with GPU preview and exact CPU commit. The codec runs in an isolated process. The app
  is served from a cross-origin-isolated `app://` origin with a strict CSP.
- Tests: engine unit and property tests, GPU conformance tests (shaders vs CPU reference), Electron E2E on
  Linux, Windows and macOS against the built and the packaged app.
- The canvas recovers when the graphics driver resets (WebGL context loss) without losing the document or
  history.

### Changed
- Renamed the project from `image-resizer` to `image-editor`. Removed the legacy plain-JS resizer
  (available in git history at `3eadc27`). Its batch-resize purpose lives on as the Batch feature.

### Added
- Project documentation: requirements, architecture, UI/UX design, IPC & command API, data model,
  security, testing, CI/CD, file formats & colour, roadmap, ADRs 0001–0008.
