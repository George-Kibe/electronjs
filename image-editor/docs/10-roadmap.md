# 10 — Roadmap: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

Estimates assume one full-time developer. The engine (M0–M1) is the riskiest part, so it comes first as a
vertical slice. Recalibrate after M1.

| Milestone | Theme | Est. |
| --- | --- | --- |
| M0 | Foundations & engine spike | 3 wks |
| M1 | Core editor MVP: open/save/export, layers, brush/eraser, crop/resize, undo | 6–8 wks |
| M2 | Selections, masks, transforms, adjustments & filters | 6–8 wks |
| M3 | Text, shapes, fill/gradient/clone, layer styles, PSD | 6 wks |
| M4 | Batch processing + on-device AI + customisation | 5 wks |
| M5 | Hardening, accessibility, i18n, v1.0 | 4 wks |

## M0 — Foundations & engine spike

- [x] Documentation set (this folder)
- [x] Rename `image-resizer` → `image-editor`. Retire the legacy code (git history keeps it).
- [x] Scaffold `app/` (Electron 44, electron-vite 5, React 19, TS 6). `app://` protocol with COOP/COEP
      (`crossOriginIsolated`) and CSP. Security baseline. codec-host utilityProcess with sharp, streaming
      pixels to the renderer over a direct MessagePort. zod-validated IPC router.
- [x] **Engine vertical slice:** immutable sparse tiles → WebGL2 compositor (Normal blend, layer opacity,
      mipmapped tile textures) → viewport pan/zoom → round brush and eraser with a tiled RGBA16F stroke
      buffer → exact CPU commit → `PaintTiles` command → undo/redo/history panel. Also layers
      (add/delete/visibility/opacity) and open/new document.
- [x] Spike measurements recorded in ADR-0003 follow-ups (software GL). Real-GPU numbers pending on the matrix.
- [x] CI (`image-editor-ci.yml`): check (unit + GPU conformance in headless Chromium) and e2e (built +
      packaged app) on Linux, Windows and macOS. All 4 journeys green on all 6 targets (image-editor-ci
      run 36366432344, 2026-09-28).

**Exit:** on all 3 OSes you can open a JPEG, paint on a new layer at 60 fps, and undo, with the spike numbers
meeting the NFR-PERF-02/03 budgets or a documented plan to meet them. ✅ **Met on 2026-09-28.** Brush
latency p95 on CI runners: Linux 12.2/12.3 ms and Windows 9.2/8.6 ms (SwiftShader), macOS 25.9/19.2 ms
(paravirtual Metal VM) (dev/packaged). The macOS VM and the full NFR-PERF-02/03 workloads (200 px brush on
6000×4000, pan/zoom on 24 MP × 20 layers) move to the `pnpm bench` harness and the release hardware matrix in
M1 (ADR-0003 follow-ups).

## M1 — Core editor MVP

FR-DOC-01..06, 09..12 · FR-NAV-01, 02, 06 · FR-LAY-01 (raster/group), 02, 03 (Normal + 8 common modes), 06 ·
FR-TRF-01..03, 07 · FR-PNT-01, 02, 06, 07 · FR-HIS-01, 02 · FR-GEN-01..05, 07, 08

Progress (built in vertical slices, each E2E-tested on 3 OSes):

- [x] **Slice 1 — files:** `.iep` save/open (FR-DOC-04) with the v1 golden fixture; Export As with live size
      estimate and before/after preview, all 7 formats, resize on export (FR-DOC-05); Quick Export PNG
      (FR-DOC-06); metadata policy for JPEG/PNG (FR-DOC-09); unsaved-changes guard on close/quit/open/new
      and Revert (FR-DOC-11); BMP open (built-in codec); native File/Edit/View menu.
- [x] Slice 2 — layers: groups (pass-through and isolated), duplicate, rename, reorder by drag, show/hide,
      locks (all/pixels/transparency; position is enforced by the Move tool in slice 3), merge down, merge
      visible, flatten; opacity and fill; Normal + 8 blend modes (Darken, Multiply, Lighten, Screen, Overlay,
      Soft Light, Hard Light, Difference — the most used; the other 9 of FR-LAY-03 arrive in M2 and render as
      Normal until then); live thumbnails. "Rasterize" applies to text/shape layers and arrives with them (M3).
- [x] Slice 3 — painting: brush options (tip presets Round/Chalk/Charcoal/Sponge, size, hardness, opacity,
      flow, spacing, pulled-string smoothing, pen pressure → size/opacity) (FR-PNT-01); pencil, and the eraser
      in brush or pencil mode, painting the background colour on transparency-locked layers (FR-PNT-02);
      eyedropper with point/3×3/5×5 and current/all layers, Alt from the brush or pencil (FR-PNT-06); colour
      picker (HSB/RGB/hex), foreground/background swatches, X, D, recent colours, Swatches panel (FR-PNT-07);
      Move tool with auto-select (layer/group), align to the canvas, arrow-key nudges, the position lock and
      Ctrl as a temporary Move tool; pixels moved off the canvas are kept (FR-TRF-07). **Distribute** needs
      several selected layers, so it arrives with multi-selection (FR-LAY-08, M2). Swatches are stored per
      user in local storage until Preferences (slice 6). E2E green on Linux, Windows and macOS (dev and
      packaged; image-editor-ci run 38247201219, 2026-10-12).
- [x] Slice 4 — transforms: Crop tool (C) with ratio presets, numeric X/Y/W/H, rule-of-thirds while
      dragging, Straighten (draw a line: rotate + crop to the largest clean rectangle, one undo step) and
      "Delete cropped pixels" (FR-TRF-01); Image Size with bicubic/bilinear/nearest/Lanczos and constrained
      proportions, Canvas Size with a 3×3 anchor (FR-TRF-02); rotate 90°/180° (bit-exact) and arbitrary
      angles (bicubic, the canvas grows), flip horizontal/vertical (FR-TRF-03); Image menu and Ctrl+Alt+I /
      Ctrl+Alt+C. Resampling runs on the CPU in the ops worker; the GPU path of docs/02 §5.6 is a later
      optimisation. E2E green on Linux, Windows and macOS (image-editor-ci run 38276056672, 2026-10-12).
- [x] Slice 5 — navigation and history: zoom 1–6400 % with Photoshop's Zoom In/Out steps and a typed zoom in
      the status bar, pixel grid at ≥ 800 % (View › Pixel Grid) (FR-NAV-01); scrollbars (FR-NAV-02); status
      bar with colour under the cursor, a memory meter (amber at 80 %) and job progress (FR-NAV-06); history
      limit 20–1000 steps in the engine (its control arrives with Preferences, slice 6), Ctrl+Alt+Z step
      backward (FR-HIS-01); snapshots, including an automatic one of the document as opened; restoring is an
      undoable step; snapshots last for the session and are not saved in `.iep` (FR-HIS-02). T-HIS-01 covers
      every command kind. E2E green on Linux, Windows and macOS (image-editor-ci run 38310262376,
      2026-10-13).
- [x] Slice 6 — app shell, in parts:
  - [x] 6.1 Preferences (Ctrl+, / ⌘,): theme light/dark/system, interface scale, canvas surround, painting
        cursor, history steps, memory budget (automatic = a quarter of RAM, 1–8 GB), GPU off (FR-GEN-02/04).
        Settings store in main (docs/05 §3). E2E launches now use a fresh profile each.
  - [x] 6.2 Recent files (Welcome grid with thumbnails, File › Open Recent, OS recent documents) and the
        full New document form with presets, saved presets, resolution and background (FR-GEN-08,
        FR-DOC-01/02). E2E green on 3 OSes (run 38314544932).
  - [x] 6.3 Clipboard: Paste as a new layer (centred in view) or a new document when none is open; Paste
        as New Document; Copy (active layer) and Copy Merged as PNG with transparency (FR-DOC-02/12).
        Decoding and encoding run in the file worker (Chromium, sandboxed); main never touches clipboard
        pixels. Cut and copying a selection arrive with selections (M2). E2E green on 3 OSes (run 38614784061).
  - [x] 6.4 Autosave recovery: a project snapshot every 2 minutes (Preferences › Files: 1–10 or off) while a
        document has unsaved changes, discarded when it is saved, replaced or closed; after a crash the
        Welcome screen offers Recover / Discard; a recovered document stays unsaved until saved (FR-DOC-10,
        T-REC-01 in E2E with a real SIGKILL). E2E green on 3 OSes (run 38615698011).
  - [x] 6.5 Document tabs (FR-DOC-03): open, new and paste add a tab (opening an open file switches to it);
        each tab keeps its history, snapshots and view; Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+W, middle-click; the
        window's close asks about each tab with unsaved changes; autosave covers every dirty tab; new
        documents are numbered (Untitled-1, -2…). E2E green on 3 OSes (run 38618226424).
  - [x] 6.5b A tab moves to its own window by dragging it out of the window or with Window › Move Tab to
        New Window (FR-DOC-03): main manages several windows (a close guard each, menu commands to the
        focused one), the document travels as `.iep` bytes with its file, id and unsaved state; undo history
        stays behind. E2E green on 3 OSes (run 38622991684).
  - [x] 6.6 Auto-update and opt-in crash reports (FR-GEN-05/07): electron-updater checks 10 s after
        start and every 4 h, downloads in the background and installs at the next quit; the banner's
        Restart Now is refused while any window has unsaved changes; Help › Check for Updates; Stable/Beta
        channel (docs/08 §3). Crash reports are opt-in (Preferences › Privacy), scrubbed of paths, file
        names and user data, sent as Sentry envelopes to a build-time DSN, without minidumps (ADR-0009).
        Updates come from this repo's `image-editor-v*` releases, found through the GitHub API (ADR-0010).
        E2E covers the update flow with a scripted feed and the crash reports with a local ingest server.
        The release workflow, code signing and the DSN secret remain for the M1 exit. E2E green on 3 OSes
        (run 44807850616).
  - [x] 6.7 Panel dock and workspaces (FR-GEN-01): collapsible panels, reorder by dragging a header or
        Alt+↑/↓, resize between panels and the dock's width, show/hide from the Window menu, Essentials and
        Photography presets, Reset Workspace, Tab hides the interface (from the canvas only, so keyboard
        focus still moves); the layout is saved in settings. Photography gains Histogram, Navigator and
        Adjustments with those panels (M2); floating panels are M4. E2E green on 3 OSes (run 38620435825).

**Exit:** journeys 1–2 (minus adjustments) pass E2E on 3 OSes. T-HIS-01, T-GPU-01, T-IO-01..04, T-REC-01
green. Signed installers with auto-update. 10 testers use it for a week with no data loss.

M1 exit status:

- [x] Journeys 1–2 without the later-milestone steps (text: M3, adjustments: M2), end to end with the
      exported file checked: `e2e/journeys.spec.ts`. Green on 3 OSes, dev and packaged (run 44811768362).
- [x] Critical tests in CI: T-HIS-01 (`history.test.ts`), T-GPU-01 (context loss in `gpu.gpu.test.ts`),
      T-IO-01 (`decode.test.ts`, `exif.test.ts`), T-IO-02 (`encode.test.ts`, `files.spec.ts`), T-IO-03
      (`iep.test.ts` with the v1 golden fixture), T-IO-04 (`atomic-write.test.ts`, new), T-REC-01
      (`recovery.spec.ts`). Green in the same run.
- [x] Auto-update in the app (slice 6.6).
- [x] Release workflow (docs/08 §3.1): signed, draft-first releases with update manifests. The unsigned
      dry run builds, checks and smoke-tests every installer on 3 OSes (run 44811768359).
- [ ] **Maintainer:** signing certificates and the secrets in docs/08 §3.1, the crash-report project and
      its DSN, then a first tagged release, and an update from it to a second one on each OS (docs/07 §8).
- [ ] **Maintainer:** 10 testers use it for a week with no data loss.

## M2 — Selections, masks, transforms, adjustments & filters

FR-SEL-01..06 · FR-LAY-03 (all modes), 04, 05, 08 · FR-TRF-04, 06 · FR-ADJ-01..03 · FR-FLT-01 ·
FR-NAV-04, 05 · FR-HIS-03

**Exit:** T-BLD-01, T-SEL-01, T-TRF-01, T-HIS-02 green. The full golden set is baselined. NFR-PERF-04/05 met on the matrix.

Progress (vertical slices, each E2E-tested on 3 OSes):

- [ ] Slice 1 — selections (FR-SEL-01..06), in parts:
  - [x] 1a Selection model (8-bit mask tiles, shared full tiles, never off the canvas), Rectangular and
        Elliptical Marquee (M, Shift+M) with new/add/subtract/intersect (options bar, Shift/Alt at
        mouse-down), Shift to constrain and Alt from the centre, fixed ratio and fixed size, ellipse
        anti-aliasing; Select › All / Deselect / Reselect / Inverse; marching ants (still with reduced
        motion); painting and erasing reach only selected pixels, in proportion to their coverage (GPU
        preview and CPU commit agree); Edit › Clear (Delete). Canvas changes drop the selection (undo
        restores it). The selection is not yet saved in `.iep`, recovery snapshots or a moved tab. E2E green
        on 3 OSes (run 44815064333).
  - [x] 1b Lasso and Polygonal Lasso (L, Shift+L: freehand closes on release; polygon by clicks, closed
        with Enter, a double-click or a click on the first point; Esc cancels, Backspace removes the last
        point; anti-aliased edges) and Magic Wand (W) in the ops worker: tolerance 0–255 compared on
        premultiplied colour (all transparent pixels match each other), contiguous (scanline flood fill)
        or not, anti-alias, active layer or all layers (T-SEL-01). Every selection tool takes the four modes. E2E
        green on 3 OSes (run 44817086962).
  - [ ] 1c Select › Modify in the ops worker, linear in pixels at any radius: Feather (Shift+F6, three-box
        Gaussian), Expand / Contract (exact Euclidean distance transform; the canvas edge counts as
        unselected), Border (a soft band), Smooth (majority vote); Select › Color Range (basic: closeness to
        the foreground colour with a fuzziness falloff, one layer or all); Copy / Copy Merged / Cut take only
        the selection (the file worker masks the composite); Image › Crop to the selection; T-HIS-01 includes
        selections.
  - [ ] 1d The selection is saved in `.iep` (`document.selection` → one-channel `selection/tiles.bin`;
        optional and additive, so no version bump; a missing or damaged entry only loses the selection),
        and so it also survives recovery snapshots and a tab moved to its own window. Quick Mask (Q) moves
        to slice 2: it paints into a mask exactly like layer masks do.
- [ ] Slice 2 — layer masks and clipping masks (FR-LAY-04/05), Quick Mask (FR-SEL-06), multi-layer
      selection (FR-LAY-08), in parts:
  - [ ] 2a Layer masks on raster layers: Layer › Layer Mask › Reveal All / Hide All / Reveal Selection /
        Hide Selection (and the panel's Add layer mask button), Delete, Apply (baked into the pixels'
        alpha), Disable / Enable (Shift-click the thumbnail), Link / Unlink; click the mask thumbnail to
        paint it (the brush and pencil paint the foreground colour's grey, the eraser the background's;
        the selection clips it); Ctrl+I inverts it. Stored as RGBA tiles with coverage in alpha, so moves,
        crops, rotations, flips and resampling transform masks with their layers; saved in `.iep` as
        one-channel `masks/<n>/tiles.bin`. GPU preview and CPU commit agree (conformance tests). Masks on
        groups, Alt-click to view the mask, and density/feather properties are later.
  - [x] 2b Clipping masks (FR-LAY-05): Layer › Create / Release Clipping Mask (Ctrl+Alt+G); a clipped layer
        shows only where the nearest unclipped layer below it in the same group has pixels (its alpha × its
        mask × its opacity), several layers can share one base, and a hidden base hides them. As built this
        multiplies each clipped layer by the base on its own, which matches Photoshop wherever the base is
        opaque; Photoshop's isolated clipping group (base opacity and mode applied to the whole group) needs
        source-atop blend modes in `blend.glsl`/`blend.ts`, a golden-image area, and is a follow-up. Groups
        as bases clip nothing yet. E2E green on 3 OSes (run 44848140590).
  - [x] 2b′ Quick Mask (Q, the toolbar's ◩): the unselected area shows under 50 % red instead of marching
        ants, and the brush, pencil and eraser paint the selection itself (white selects, black deselects,
        greys in between); each stroke is one selection step in History, so leaving Quick Mask needs no
        conversion. With no selection everything counts as selected. GPU overlay and CPU commit agree. E2E
        green on 3 OSes (run 44848795338).
  - [x] 2c Several layers at once (FR-LAY-08): Ctrl/⌘-click toggles a layer in the selection and Shift-click
        selects a range in the Layers panel; the Move tool, arrow-key nudges, Layer › Align (to each other
        with several, to the canvas with one), Layer › Distribute (three or more: the outer two stay), Group
        (Ctrl+G) and Delete act on all of them, each as one undo step. A group and a layer inside it never
        both act. The layer selection is UI state, like the active layer. E2E green on 3 OSes (run
        44849927215).
- [x] Slice 3 — free transform of a layer or selection, trim / reveal all (FR-TRF-04/06), T-TRF-01
  - [x] 3a Free Transform of layers (Ctrl+T): the active layer or every selected layer (linked masks too)
        gets a box with 8 handles. Drag inside to move, a corner to scale in proportion (Shift: free, Alt:
        from the centre; docs/03 §5.4), an edge to stretch, outside to rotate (Shift: 15° steps), Ctrl+edge
        to skew; arrows nudge the box. The options bar shows centre X/Y,
        W/H %, angle and skew, Flip H/V, Cancel (Esc) and Apply (Enter). The preview runs on the GPU and the
        commit runs in the ops worker as one undo step. Edit › Transform › Rotate 180°/90° and Flip
        Horizontal/Vertical apply at once, bit-exact. T-TRF-01 (affine half) is covered by unit and GPU tests.
        E2E green on 3 OSes (run 44884832669).
  - [x] 3b Transforming a selection: with a selection, Ctrl+T (and Edit › Transform) move only the selected
        pixels of the active or selected layers. They are lifted off (a soft edge splits each pixel by its
        coverage), drawn through the matrix in a preview-only copy of the document, and put back over what
        stayed (source-over) on Apply. The selection moves with them, and undo restores both. Layer masks
        stay where they are. Preview and commit agree to ±1/255 (GPU test). E2E green on 3 OSes (run
        44884832669).
  - [x] 3c Image › Trim… crops away edges that are transparent, or the colour of the top-left or bottom-right
        pixel of the composite, on the chosen sides (the ops worker finds them; pixels outside are deleted).
        Image › Reveal All grows the canvas to show every layer's pixels outside it. Each is one undo step.
        E2E green on 3 OSes (run 44884835490).
- [x] Slice 4 — adjustments as layers and commands, auto tone/contrast/colour, Histogram panel
      (FR-ADJ-01..03), NFR-PERF-04
  - [x] 4a Adjustment layers: all 12 kinds of FR-ADJ-01 (Brightness/Contrast, Levels, Curves, Exposure,
        Vibrance, Hue/Saturation with Colorize, Color Balance, Black & White with Tint, Photo Filter, Invert,
        Posterize, Threshold) from Layer › New Adjustment Layer or the Layers panel's ◑ button. The new
        Properties panel changes them live, and a slider drag is one undo step. They carry a mask (the
        selection, if any, else reveal-all) that the brush paints, plus opacity, blend mode and clipping.
        They are saved in `.iep` (docs/05 schema, range-checked), merge down, duplicate, and follow
        crop/resize/rotate. The GPU pass (`adjust.frag`) matches the CPU reference (`ops/adjust.ts`) within
        ±2/255 for every kind. E2E green on 3 OSes (run 44937126939).
  - [x] 4b Image › Adjustments as destructive commands: a dialog with the Properties controls previews on
        the canvas (Preview toggles it), and OK replaces the active layer's pixels in the ops worker, within
        the selection by its coverage, as one undo step. Ctrl+L Levels, Ctrl+M Curves, Ctrl+U Hue/Saturation,
        Ctrl+B Color Balance, Ctrl+Alt+Shift+B Black & White; Ctrl+I inverts at once. Alt-choosing in the ◑
        menu applies the adjustment instead of adding a layer (docs/03 §5.2). Minimize moves to
        Ctrl/⌘+Alt+M, so Ctrl/⌘+M is Curves. E2E green on 3 OSes (run 44938357278).
  - [x] 4c Image › Auto Tone (Shift+Ctrl+L), Auto Contrast (Alt+Shift+Ctrl+L) and Auto Color (Shift+Ctrl+B)
        compute Levels from the active layer's histogram (within the selection) and apply it as one step
        (FR-ADJ-02). Auto Tone stretches each channel, Auto Contrast all together, and Auto Color also meets
        the channels' midtones; all clip 0.1 %. The Histogram panel (Window › Histogram; on top in
        Photography) shows RGB, luminosity or one channel of the image or the selected layer, with mean,
        std dev, median and pixel count, recomputed in the ops worker after each change (FR-ADJ-03). Levels
        shows the histogram behind its sliders and has an Auto button. NFR-PERF-04: an `adjust-latency`
        measure (change → frame) is recorded by E2E on a 24 MP document. Locally the p95 is 14–22 ms on
        Intel Iris Xe (≥ 45 fps). E2E green on 3 OSes (run 44940099057).
- [ ] Slice 5 — filters with live preview, respecting the selection (FR-FLT-01), NFR-PERF-05, journey 4
  - [x] 5a The filter framework and the blur and sharpen family: Filter › Blur › Gaussian Blur… and Box
        Blur…, Filter › Sharpen › Sharpen and Unsharp Mask…, and Filter › Last Filter (Ctrl+Alt+F). A dialog
        previews on the tiles in view (Preview toggles it), and OK applies to the active layer, within the
        selection by its coverage, as one undo step. Canvas edges repeat, blurs work in premultiplied alpha,
        and transparency lock keeps alpha. Journey 4 (marquee → feather → Gaussian blur inside the
        selection) is E2E-tested. NFR-PERF-05 is measured by E2E: Gaussian r = 50 on 24 MP takes 1.2 s on a
        4-core laptop, on the CPU (worker pool). That is not yet under 1 s; see 5c.
        E2E green on 3 OSes (run 44944116530).
  - [x] 5b The rest of FR-FLT-01: Filter › Blur › Motion Blur…, Noise › Add Noise… (uniform or Gaussian,
        monochromatic; deterministic, so the preview is the result) and Reduce Noise… (a median, by Huang's
        sliding histogram), Pixelate › Mosaic… (canvas-aligned cells), Stylize › Emboss… and Find Edges
        (Sobel), and Render › Vignette…. They share 5a's dialog, preview, selection and worker pool, through a
        window-per-tile driver (`ops/window-filters.ts`). E2E green on 3 OSes (run 44944120863).
  - [x] 5c NFR-PERF-05: the CPU path made faster instead of a GPU path. The vertical box stages slide in one
        pass, rows are no longer copied back after blurring, and the pool's bands travel as one transferred
        buffer each instead of cloned tiles. Gaussian r = 50 on 24 MP now takes 1.0 s (0.99–1.05 s) on the
        4-core development laptop (Intel Iris Xe class, like the slowest machine of the matrix), down from
        1.2 s. CI's shared runners take 1.2–1.3 s (macOS, 3 threads), 1.5–1.6 s (Ubuntu) and 2.3 s (Windows);
        they are not the budget's hardware (docs/07 §6). E2E green on 3 OSes (run 45140037930). Slice 5
        stays open until the release matrix confirms NFR-PERF-05; a GPU path (docs/02 §5.5) is the fallback.
- [ ] Slice 6 — the other 9 blend modes (FR-LAY-03, T-BLD-01 full), the full golden set
- [x] Slice 7 — rulers, guides, snapping, grid and the Navigator panel (FR-NAV-04/05)
  - [x] 7a Rulers, guides and snapping:
        - View › Rulers (Ctrl+R) shows rulers along the top and left, in px, in, cm or % (right-click a
          ruler; saved as a preference).
        - Drag out of a ruler to make a guide. The Move tool drags a guide, and dropping it off the canvas
          deletes it. Each change is an undo step. View › New Guide…, Clear Guides, Guides (Ctrl+;) and
          Lock Guides (Ctrl+Alt+;).
        - View › Snap (Ctrl+Shift+;) makes Move-tool drags (the content's edges and centre), marquee
          corners and guides snap to guides, the canvas edges and centre, and other layers' edges, within
          8 screen px. E2E green on 3 OSes (run 44945203411).
  - [x] 7b View › Grid (Ctrl+'): gridlines every 100 px with 4 subdivisions (preferences), and snapping uses
        them when shown. The Navigator panel (Window › Navigator; on top in Photography, FR-NAV-05) shows
        the image with the part in view outlined; click or drag in it to move the view, and its slider
        zooms. The thumbnail fits the panel's size. E2E green on 3 OSes (run 45138641802).
- [ ] Slice 8 — history beyond the RAM budget spills to OPFS (FR-HIS-03, T-HIS-02)

## M3 — Text, shapes, painting extras, PSD

FR-LAY-01 (text/shape), 07 · FR-TXT-01..03 · FR-PNT-03..05, 08, 10 · FR-DOC-07, 08

**Exit:** journey 5 passes. The PSD fixture corpus passes (T-IO-05). A PSD round trip opens correctly in
Photoshop/GIMP/Photopea (manual checklist).

## M4 — Batch, AI, customisation

FR-BAT-01..05 · FR-AI-01..05 · FR-SEL-07, 08 · FR-TRF-05 · FR-FLT-02 · FR-NAV-03 · FR-GEN-03 (custom keymap) ·
floating panels · offline installer variant (Q3)

**Exit:** T-AI-01, T-BAT-01 green. NFR-PERF-06 met. The model license gate passes. The model is chosen
(Q2) and recorded in ADR-0006.

## M5 — Hardening & v1.0

FR-GEN-06 (Swahili) · accessibility audit (WCAG 2.2 AA on chrome) · codec-host OS sandboxing ([Security §2](06-security.md#2-isolation-design)) ·
external security review · performance pass on every NFR · optional linear-light resampling · distribution
(winget, Homebrew, Flathub)

**Exit:** every "Must" requirement is done. Every NFR is verified on the hardware matrix. No open
Critical/High security findings. v1.0.0.

## Future

Healing/spot-healing brush, smart filters, warp text, HEIC and SVG import, 16-bit mode, wide-gamut working
spaces, a plugin/scripting API built on the Command API, animation frames, and generative fill using an
on-device model if a suitably licensed one exists.
