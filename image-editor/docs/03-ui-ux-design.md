# 03 — UI/UX Design: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

## 1. Design principles

1. **Approachable first, powerful underneath.** The default "Essentials" workspace shows the tools and
   panels a hobbyist needs. Everything else is one menu away, never hidden behind modes.
2. **The image is the hero.** Chrome is neutral dark grey (light theme available), compact, and never
   brighter than the canvas. No coloured UI around the image, which would bias colour judgement.
3. **Familiar muscle memory.** Photoshop-compatible single-key tool shortcuts and common commands. Tool
   behaviours follow established conventions: modifier keys, options bar, layer panel semantics.
4. **Live feedback.** Every slider previews live on the canvas, and every tool shows its effect under the
   cursor before committing.
5. **Never lose work.** Autosave recovery, non-destructive defaults ("Remove background" makes a mask, not
   a deletion), and clear unsaved-state markers.

## 2. Visual language

- Design tokens shared with the other repo projects (CSS variables + Tailwind v4 theme). Brand accent:
  `--color-brand: #0CA678` (teal), used only on focus, active tool and primary buttons.
- Chrome greys (dark): `--ui-bg #1E1F22`, `--ui-panel #26282C`, `--ui-raised #2E3035`, `--ui-border #3A3D42`,
  text `#E3E5E8` / muted `#9BA1A8`. Light theme: inverse neutrals. The canvas surround defaults to `#3A3A3A`
  in both themes (user-adjustable).
- Typography: system UI font at 12–13 px in panels (dense), with tabular numbers in numeric fields.
- Icons: a custom 20 px tool icon set drawn to be distinct from Adobe's (Lucide as the base where suitable).
  Each tool icon has a tooltip with its name, shortcut and a short animated hint (optional).
- Numeric fields support scrubby sliders (drag on the label), arrow keys (±1, Shift ±10) and math
  expressions (`1920/2`).

## 3. Workspace layout

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ File  Edit  Image  Layer  Select  Filter  View  Window  Help                (native menu bar) │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🖌 Brush │ Size [ 45 px ▾] Hardness [ 80%] Opacity [100%] Flow [100%] Smoothing [10%] ⤿ ✎ pressure │  ← options bar (per tool)
├──┬───────────────────────────────────────────────────────────────────────┬───────────────────┤
│↖ │ [ photo.jpg ● ] [ banner.iep ]                                         │ ▾ Layers           │
│⬚ │ ┌──────────────── ruler ───────────────────────────────────────────┐ │ Normal ▾  Op 100% │
│ↆ │ │                                                                  │ │ 🔒⬚ ✎ ✥            │
│🪄│ │                                                                  │ │ 👁 [T] Sale 50%     │
│⌗ │ │                    (canvas, checkerboard for                     │ │ 👁 [◐] Levels 1 [▭] │
│✎ │ │                     transparency, 60 fps pan/zoom)               │ │ 👁 [🖼] Product [▭]  │
│🩹│ │                                                                  │ │ 👁 [🖼] Background 🔒│
│⌫ │ │                                                                  │ │ [fx][▭][◐][📁][＋][🗑]│
│🪣│ │                                                                  │ ├───────────────────┤
│▦ │ └──────────────────────────────────────────────────────────────────┘ │ ▸ Properties       │
│T │                                                                        │ ▸ Adjustments      │
│▭ │                                                                        │ ▸ History          │
│✋│                                                                        │ ▸ Color / Swatches │
│🔍│                                                                        │ ▸ Navigator        │
│■□│                                                                        │                   │
├──┴───────────────────────────────────────────────────────────────────────┴───────────────────┤
│ 66.7% │ 6000 × 4000 px · 300 ppi · sRGB │ X 2310 Y 1184 │ #A4C2E1 │ Mem 1.2 / 4 GB │ GPU ✓  │  ← status bar
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Toolbar** (left): single column, tool groups with a flyout (long-press or right-click shows the
  alternatives, as in Photoshop). Foreground/background swatches at the bottom.
- **Options bar** (top): contextual for the active tool. Always shows "Reset tool".
- **Panels** (right): collapsible sections that can be reordered by drag and resized. They can be undocked
  into floating palettes (M4). Workspaces: Essentials (Layers, Properties, History, Color) and Photography
  (+ Histogram, Navigator, Adjustments).
- **Document tabs:** an unsaved-changes dot. Middle-click closes. A tab can be dragged out into a new window.
- **Welcome screen** (no documents open): New, Open, recent files as a thumbnail grid, a few "Try this"
  quick starts (Remove a background, Resize for Instagram, Batch resize a folder).

## 4. Tools (v1)

| Group | Tools (shortcut) | Milestone |
| --- | --- | --- |
| Move/select | Move (V), Rectangular/Elliptical marquee (M), Lasso/Polygonal lasso (L), Magic wand / Select subject (W) | M1 (Move), M2 |
| Crop | Crop (C) | M1 |
| Measure | Eyedropper (I) | M1 |
| Retouch | Clone stamp (S) | M3 |
| Paint | Brush / Pencil (B), Eraser (E), Paint bucket / Gradient (G) | M1 (B, E), M3 (G) |
| Type & shape | Text (T), Shapes: rectangle, ellipse, line, polygon (U) | M3 |
| Navigate | Hand (H, or hold Space), Zoom (Z), Rotate view (R) | M1 (H, Z), M4 (R) |

### Cursor conventions

- Painting tools: the brush outline at the actual size (with a crosshair when the brush is < 4 screen px).
  Caps Lock switches to a precise crosshair.
- Alt with painting tools shows the eyedropper cursor. Ctrl/⌘ temporarily switches to the Move tool.
- On-canvas resize: Alt+right-drag (Win/Linux) or Ctrl+Option-drag (macOS) resizes the brush horizontally
  and changes hardness vertically.

## 5. Key interactions

### 5.1 Layers panel

- Rows: visibility eye, thumbnail (raster/adjustment icon/"T"/shape), mask thumbnail (click to target the
  mask; Alt-click to view it), name (double-click to rename), lock and link badges.
- Drag to reorder or to move into and out of groups. Alt-drag duplicates. Right-click opens a context menu
  with all layer commands.
- Blend mode dropdown: hovering an item previews it live on the canvas (throttled).
- The bottom bar buttons: styles, add mask, new adjustment (menu), new group, new layer, delete.

### 5.2 Adjustments

- Adding an adjustment creates an adjustment layer above the active layer (default). Holding Alt when
  choosing applies it destructively instead (Image → Adjustments menu does the same).
- The Properties panel shows the controls: Levels histogram with black/grey/white input sliders and output
  sliders, and a Curves editor (click to add points, drag off to remove, per-channel tabs, preset dropdown).
  "Auto" button. The eye toggles before/after.

### 5.3 Filters

- A modal dialog with a zoomable preview thumbnail, live on-canvas preview (checkbox), and numeric
  fields plus sliders. Enter to apply, Esc to cancel. Applied to the selection if one exists.

### 5.4 Transform

- Ctrl/⌘+T shows 8 handles plus a rotation zone outside the corners and a reference point. Shift toggles
  proportional scaling (proportional is the default, as in modern Photoshop). Alt scales from the centre.
- The options bar shows X/Y/W/H/angle/skew fields and Commit (Enter) / Cancel (Esc).

### 5.5 Crop

- Handles, ratio presets, a rule-of-thirds overlay while dragging, the straighten tool, and "Delete cropped
  pixels" (off = keep hidden pixels in layers). Enter commits.

### 5.6 Text

- Click for point text, drag for a paragraph box. Editing happens in place. The options bar has font
  (searchable list with live previews), style, size, colour, alignment and letter spacing. Esc or clicking
  outside commits. Double-clicking the layer thumbnail selects all its text.

### 5.7 AI tools

- **Layer → Remove background** (and a button in Properties for raster layers). The first use shows a
  consent dialog: "Download the AI model (≈ N MB)? It runs on your computer. Images never leave your
  device." Progress is inline. The result is a mask plus a toast: "Background hidden with a mask. Paint
  on the mask to refine."
- **Select → Subject**: same model, produces a selection.

### 5.8 Export dialog ("Export As")

- Left: a large before/after preview at 100 % with pan. Right: format, quality, resize (W/H/%),
  metadata (Keep / Remove location / Remove all), colour profile (embed sRGB ✓), transparency
  (matte colour for JPEG), estimated file size (updated live, debounced).

### 5.9 Batch window

- A three-step layout: **1. Inputs** (drop files/folders, list with thumbnails and counts) → **2. Actions**
  (an ordered, reorderable list of action cards with settings) → **3. Output** (folder, naming pattern,
  overwrite policy). Run → per-file progress list plus a summary. Save as preset.

## 6. Keyboard shortcuts

Defaults follow Photoshop where applicable. Ctrl = ⌘ on macOS, Alt = ⌥.

| Action | Shortcut |
| --- | --- |
| New / Open / Save / Save As | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Export As / Quick Export | Ctrl+Alt+Shift+W / Ctrl+Alt+Shift+' |
| Undo / Redo / Step history | Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y on Windows) / Ctrl+Alt+Z |
| Cut / Copy / Copy merged / Paste | Ctrl+X / Ctrl+C / Ctrl+Shift+C / Ctrl+V |
| Free transform | Ctrl+T |
| Deselect / Reselect / Inverse / Select all | Ctrl+D / Ctrl+Shift+D / Ctrl+Shift+I / Ctrl+A |
| New layer / Duplicate (layer via copy) / Group / Merge down | Ctrl+Shift+N / Ctrl+J / Ctrl+G / Ctrl+E |
| Levels / Curves / Hue-Sat / Invert | Ctrl+L / Ctrl+M / Ctrl+U / Ctrl+I |
| Image size / Canvas size | Ctrl+Alt+I / Ctrl+Alt+C |
| Brush size − / + / Hardness − / + | [ / ] / Shift+[ / Shift+] |
| Opacity presets for painting tools | 1…0 (10 %…100 %) |
| Default colours / Swap | D / X |
| Quick mask | Q |
| Zoom in / out / Fit / 100 % | Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+1 |
| Temporary hand / zoom | Space / Ctrl+Space |
| Toggle panels (hide UI) | Tab |
| Command palette (search every command) | Ctrl+K (our addition, helps discoverability) |

Shortcuts are defined in one keymap file. The customisation UI arrives in M4 and flags conflicts.

## 7. Accessibility

- All menus, panels and dialogs are keyboard-operable, with visible focus and screen-reader labels. Layers
  panel: `role="tree"` with `aria-level`, `aria-selected`, and announced names such as
  "Layer 'Product', visible, opacity 100 percent, has mask".
- The canvas has `role="img"` with a live-updated description (document size, active layer, selection
  bounds, tool). Keyboard alternatives to pointer-only actions: nudge with arrows, numeric transform
  fields, "Select → All/None", crop by numeric entry.
- A command palette makes every command discoverable without a pointer.
- Colour pickers show hex/RGB values as text. Contrast of UI chrome meets 4.5:1.
- Honour `prefers-reduced-motion` (no animated marching ants: use a static dashed outline) and `forced-colors`.
- An interface scale setting (90–150 %) on top of the OS scaling.

## 8. States & feedback

| Situation | Treatment |
| --- | --- |
| Long operation (> 300 ms) | Non-blocking progress in the status bar. Cancel where possible (filters, AI, export). |
| GPU unavailable | Banner: "Hardware acceleration unavailable. Some operations will be slower." with a Help link |
| Memory pressure | Status bar memory meter turns amber at 80 %. Suggest reducing history. |
| Unsupported PSD features | Non-blocking notice listing what was rasterized/ignored, with "Details" |
| Recovery available | Welcome screen card: "Recover 2 unsaved documents" with thumbnails |
| Empty states | Layers panel with no document: short hint text. History: "Your edits will appear here." |

## 9. Design deliverables

| Deliverable | When |
| --- | --- |
| Wireframes (this doc) | M0 ✅ |
| Figma: tokens, tool icon set, panel components, key dialogs (New, Export, Levels, Curves, Batch) | M0–M1 |
| Storybook for UI components (+ a11y addon) | M1 onward |
| App icon set + `.iep` document icon | Before first release |
