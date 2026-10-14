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
- [ ] Slice 6 — app shell, in parts:
  - [x] 6.1 Preferences (Ctrl+, / ⌘,): theme light/dark/system, interface scale, canvas surround, painting
        cursor, history steps, memory budget (automatic = a quarter of RAM, 1–8 GB), GPU off (FR-GEN-02/04).
        Settings store in main (docs/05 §3). E2E launches now use a fresh profile each.
  - [x] 6.2 Recent files (Welcome grid with thumbnails, File › Open Recent, OS recent documents) and the
        full New document form with presets, saved presets, resolution and background (FR-GEN-08,
        FR-DOC-01/02). E2E green on 3 OSes (run 38314544932).
  - [ ] 6.3 Clipboard: paste as new document/layer, copy merged (FR-DOC-02/12)
  - [ ] 6.4 Autosave recovery: a project snapshot every 2 minutes (Preferences › Files: 1–10 or off) while a
        document has unsaved changes, discarded when it is saved, replaced or closed; after a crash the
        Welcome screen offers Recover / Discard; a recovered document stays unsaved until saved (FR-DOC-10,
        T-REC-01 in E2E with a real SIGKILL).
  - [ ] 6.5 Document tabs (FR-DOC-03)
  - [ ] 6.6 Auto-update and opt-in crash reports (FR-GEN-05/07)
  - [ ] 6.7 Collapsible panels and workspaces (FR-GEN-01)

**Exit:** journeys 1–2 (minus adjustments) pass E2E on 3 OSes. T-HIS-01, T-GPU-01, T-IO-01..04, T-REC-01
green. Signed installers with auto-update. 10 testers use it for a week with no data loss.

## M2 — Selections, masks, transforms, adjustments & filters

FR-SEL-01..06 · FR-LAY-03 (all modes), 04, 05, 08 · FR-TRF-04, 06 · FR-ADJ-01..03 · FR-FLT-01 ·
FR-NAV-04, 05 · FR-HIS-03

**Exit:** T-BLD-01, T-SEL-01, T-TRF-01, T-HIS-02 green. The full golden set is baselined. NFR-PERF-04/05 met on the matrix.

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
