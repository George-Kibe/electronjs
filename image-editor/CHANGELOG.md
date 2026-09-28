# Changelog

All notable changes to ImageEditor are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
