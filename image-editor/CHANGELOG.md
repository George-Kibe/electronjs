# Changelog

All notable changes to ImageEditor are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Selections: Rectangular and Elliptical Marquee (M, Shift+M) with New, Add (Shift), Subtract (Alt) and
  Intersect (Shift+Alt), Shift for a square or circle, Alt to draw from the centre, a fixed ratio or size,
  and smooth ellipse edges. Select › All (Ctrl+A), Deselect (Ctrl+D), Reselect (Ctrl+Shift+D) and Inverse
  (Ctrl+Shift+I). The selection shows as marching ants. Brush, pencil and eraser paint only inside it, and
  Delete clears the selected pixels.
- Lasso (L) and Polygonal Lasso (Shift+L): draw around an area, or click its corners and press Enter. Magic
  Wand (W) selects similar colours, touching the click or anywhere in the image, from the active layer or
  all layers, with an adjustable tolerance.
- Select › Modify: Feather (Shift+F6), Expand, Contract, Border and Smooth. Select › Color Range selects
  colours close to the foreground colour. Copy, Copy Merged and Cut (Ctrl+X) take only the selection, and
  Image › Crop crops to it.
- Layer masks: Layer › Layer Mask › Reveal All, Hide All, Reveal Selection or Hide Selection (or the Add
  layer mask button), then click the mask thumbnail and paint: black hides, white shows. Shift-click the
  thumbnail to turn the mask off, Ctrl+I inverts it, and Apply bakes it into the layer. Masks move, crop,
  rotate and resize with their layers and are saved in the project.
- Select several layers with Ctrl/⌘-click or Shift-click in the Layers panel, then move, nudge, align,
  distribute (Layer › Distribute), group (Ctrl+G) or delete them together.
- Quick Mask (Q): the selection shows as a red overlay on what is not selected, and painting changes it:
  white adds, black removes. Press Q again to see the selection as marching ants.
- Clipping masks: Layer › Create Clipping Mask (Ctrl+Alt+G) shows a layer only where the layer below it has
  pixels; Release Clipping Mask undoes it.
- Free Transform (Ctrl+T): drag inside the box to move the layer, drag a corner to scale it in proportion
  (Shift scales freely, Alt scales from the centre) or an edge to stretch it, drag outside to rotate it
  (Shift: 15° steps), or Ctrl-drag an edge to skew it. You can also
  type the position, size, angle and skew in the options bar. Enter applies and Esc cancels. It works on
  several selected layers at once, and masks follow their layers. Edit › Transform rotates by 180° or 90° and
  flips the layer straight away. With a selection, only the selected pixels are transformed, and the
  selection moves with them.
- Adjustment layers: Layer › New Adjustment Layer (or the ◑ button in Layers) adds Brightness/Contrast,
  Levels, Curves, Exposure, Vibrance, Hue/Saturation, Color Balance, Black & White, Photo Filter, Invert,
  Posterize or Threshold above the active layer. They change everything below without touching its pixels.
  Their settings are in the new Properties panel. Paint on an adjustment layer to hide it in places, or
  make a selection first so it applies only there. They have opacity and blend modes, can be clipped to the
  layer below, and are saved in projects.
- Image › Adjustments applies the same adjustments directly to the active layer, or to the selection. A
  dialog shows the result on the canvas as you change it (Preview turns that off), and OK applies it.
  Shortcuts: Ctrl+L Levels, Ctrl+M Curves, Ctrl+U Hue/Saturation, Ctrl+B Color Balance, Ctrl+Alt+Shift+B
  Black & White, and Ctrl+I to invert. Alt-click an item in the Layers panel's ◑ menu to apply it
  directly. Minimize Window is now Ctrl+Alt+M.
- Image › Auto Tone, Auto Contrast and Auto Color fix a dull or tinted photo in one step, from the layer's
  histogram (Shift+Ctrl+L, Alt+Shift+Ctrl+L, Shift+Ctrl+B).
- Histogram panel (Window › Histogram, shown in the Photography workspace): the image's or the layer's
  RGB, luminosity or single-channel histogram, with mean, standard deviation, median and pixel count.
  Levels shows the histogram too, and its Auto button sets the levels for you.
- Filter menu: Gaussian Blur, Box Blur, Sharpen and Unsharp Mask. The dialog shows the result on the
  canvas as you change it, and OK applies it to the layer, or only to the selection (soft edges blend).
  Filter › Last Filter (Ctrl+Alt+F) repeats the last one. Also Motion Blur, Add Noise, Reduce Noise,
  Mosaic, Emboss, Find Edges and Vignette.
- Rulers and guides: View › Rulers (Ctrl+R), then drag from a ruler to place a guide. Drag a guide with
  the Move tool, or drag it off the canvas to remove it. Right-click a ruler to switch between pixels,
  inches, centimetres and percent. With View › Snap (Ctrl+Shift+;), layers, selections and guides line
  up with guides, the canvas edges and centre, and other layers' edges.
- View › Grid (Ctrl+') shows a grid that things snap to. The Navigator panel (Window › Navigator) shows
  the whole image with the part in view outlined; click or drag in it to move around, and use its slider
  to zoom.
- Image › Trim… removes transparent edges, or edges of the same colour as the top-left or bottom-right
  pixel, from the sides you choose. Image › Reveal All enlarges the canvas so that everything moved off the
  edge is visible again.
- Automatic updates: new versions download in the background and install when you quit, or straight away
  with Restart Now. An update never restarts the app while a document has unsaved changes. Help › Check for
  Updates, and a Stable or Beta channel in Preferences › Updates.
- Optional crash reports (Preferences › Privacy, off by default). A report holds the error and where it
  happened in the code, the app version and your operating system. It never holds images, file names or
  anything from your documents. The app collects no usage statistics.
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
- Panels can be collapsed, reordered (drag the title, or Alt+↑/↓), resized and hidden (Window menu);
  Window › Workspace › Essentials / Photography / Reset Workspace. Press Tab to hide the toolbar, options
  bar and panels. Your layout is remembered.
- Drag a tab out of the window (or Window › Move Tab to New Window) to work on it in its own window.
- Document tabs: open several images and projects at once. Ctrl+Tab switches, Ctrl+W closes (asking about
  unsaved changes), and closing the window asks about each unsaved document. New documents are numbered
  (Untitled-1, Untitled-2…).
- Crash recovery: while a document has unsaved changes it is saved in the background every 2 minutes
  (Preferences › Files). If the app or computer crashes, the Welcome screen offers to recover it.
- Clipboard: paste an image as a new layer (or as a new document when none is open), Edit › Paste as New
  Document, copy the active layer (Ctrl+C) or the visible image (Copy Merged, Ctrl+Shift+C) with
  transparency.
- Welcome screen with your recent files as thumbnails, and File › Open Recent. Clear the list or remove a
  file at any time.
- New document: presets (Instagram, A4 at 300 ppi, 1080p, 4K), your own saved presets, resolution and
  background (white, black, transparent or the background colour).
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
