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
      packaged app) on Linux, Windows and macOS.

**Exit:** on all 3 OSes you can open a JPEG, paint on a new layer at 60 fps, and undo, with the spike numbers
meeting the NFR-PERF-02/03 budgets or a documented plan to meet them.

## M1 — Core editor MVP

FR-DOC-01..06, 09..12 · FR-NAV-01, 02, 06 · FR-LAY-01 (raster/group), 02, 03 (Normal + 8 common modes), 06 ·
FR-TRF-01..03, 07 · FR-PNT-01, 02, 06, 07 · FR-HIS-01, 02 · FR-GEN-01..05, 07, 08

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
