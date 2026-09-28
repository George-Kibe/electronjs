# 07 — Testing & QA Strategy: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

## 1. What makes this app hard to test, and how we handle it

| Challenge | Approach |
| --- | --- |
| Output is pixels, not text | **Golden-image tests** with perceptual/tolerance diffs (pixelmatch + per-channel max error) |
| GPU differences between machines | CI renders with SwiftShader (deterministic). Baselines are generated in CI, not on dev machines. A tolerance of ±2/255 absorbs driver rounding. |
| Formula correctness (blend modes, adjustments) | Every shader has a **CPU reference implementation** in TypeScript, written from the spec. Tests compare GPU and CPU on randomised inputs (property tests). |
| Undo correctness | Round-trip invariants: `do → undo` restores tiles exactly (same references), and `do → undo → redo` equals `do` |
| Interaction-heavy tools | Playwright drives real pointer events on the canvas, including pressure through CDP `Input.dispatchMouseEvent` with `force`, then asserts on engine state and pixels |
| Performance regressions | Benchmarks with budgets, tracked over time |

## 2. Test pyramid

| Layer | Tooling | Scope | Runs |
| --- | --- | --- | --- |
| Unit: engine core | Vitest (node) | TileGrid, TilePool refcounts, commands do/undo, history budget/coalescing, selection math, dab generator, colour math, `.iep` schema | PR |
| Unit: CPU references | Vitest + fast-check | Blend modes vs the W3C formulas, adjustments, resampling kernels | PR |
| GPU conformance | Vitest browser mode (Playwright Chromium, SwiftShader) | Each shader vs its CPU reference on random tiles (±1/255 target, ±2 max) | PR |
| Golden images | Playwright + Electron | Render fixture documents (every blend mode × opacity × mask, every filter/adjustment at 3 parameter sets, text samples) → compare with baselines | PR (core set) · nightly (full) |
| Import/export | Vitest (node) + codec-host in-process | Decode fixtures (ICC profiles, EXIF orientations 1–8, 16-bit PNG → 8-bit, CMYK JPEG → sRGB), encode round trips, metadata policy | PR |
| PSD | Vitest | Fixture PSDs (made in Photoshop, GIMP and Photopea) → model assertions + composite ΔE. Export → re-import → equality. | PR |
| E2E | Playwright `_electron` | User journeys (below) | PR smoke (Linux) · nightly (3 OS) |
| Fuzz | fast-check, Jazzer.js | PSD reader, `.iep` reader, codec-host decode | PR smoke 60 s · nightly 30 min |
| Performance | Custom bench harness (`pnpm bench`) in Electron | NFR-PERF-* | Nightly + before release |
| Memory | Scripted long sessions + `process.getProcessMemoryInfo()` + TilePool stats | NFR-MEM-* | Nightly |

## 3. Critical scenarios

| ID | Scenario |
| --- | --- |
| T-HIS-01 | 500 random commands (property-based) then undo all → document equals the initial state (tile refs and pixels) |
| T-HIS-02 | Memory budget exceeded → tiles spill to OPFS. Undo past the spill restores pixels exactly. |
| T-HIS-03 | Slider drag with 60 updates → 1 history entry |
| T-GPU-01 | Simulated `WEBGL_lose_context` mid-stroke → context restored. Document pixels identical to CPU truth. The stroke is either committed or cleanly cancelled. |
| T-BLD-01 | All 18 blend modes (Dissolve with a fixed noise seed) × opacity {0.3, 1} × mask on/off match the CPU reference within ±2/255 |
| T-BRU-01 | Brush stroke with pressure 0→1 produces a size taper. Spacing is consistent at zoom levels 25 %–800 %. |
| T-SEL-01 | Magic wand tolerance 32 contiguous vs non-contiguous against a fixture with known regions |
| T-TRF-01 | Rotate 90° × 4 = identity (bit-exact). Free transform scale 50 % then 200 % stays within the bicubic tolerance. |
| T-IO-01 | JPEG with EXIF orientation 6 opens upright. Display-P3 fixture converts to sRGB with ΔE < 2 against a reference conversion (LittleCMS). |
| T-IO-02 | Export JPEG with "Remove location": output has no GPS tags and has an sRGB ICC profile |
| T-IO-03 | `.iep` round trip of a document containing every layer type → identical model and pixels. v1 fixture files load forever. |
| T-IO-04 | Atomic save: kill the process during write → the original file is intact |
| T-IO-05 | PSD fixture corpus: groups, masks, clipping, text and blend modes are preserved. Unsupported features are listed in the notice. |
| T-REC-01 | Kill the app with unsaved changes → the next launch offers recovery with ≤ 2 min of lost edits |
| T-AI-01 | Remove background on 5 fixture photos → mask IoU ≥ 0.9 vs a stored reference matte (WASM provider in CI) |
| T-BAT-01 | Batch of 50 images including 1 corrupt file → 49 outputs + 1 reported error. Cancel mid-way leaves no partial output files. |
| T-SEC-01 | Bomb PNG (100k × 100k header) → `TOO_LARGE` without large allocation. Codec-host crash → auto restart, app keeps running. |

## 4. E2E user journeys (Playwright)

1. New document → brush strokes → add layer → text → export PNG → verify file pixels.
2. Open photo → crop 4:5 → Levels adjustment layer → export JPEG with metadata policy.
3. Open photo → Remove background → paint on the mask → save `.iep` → reopen → layer and mask intact.
4. Marquee → feather → Gaussian blur inside the selection only.
5. Open PSD → edit a text layer → export PSD → reopen.
6. Batch: folder of 10 → resize + WebP → outputs verified.
7. Undo/redo via the History panel. Snapshot and restore.

**Harness note (M0):** `app://` is cross-origin isolated, so the window's first navigation swaps renderer
processes. If that swap races Playwright's attach to the new window, the `firstWindow()` Page can stay on
the pre-swap document. This happened in about 1 in 10 packaged launches on Linux and most on Windows. The
page itself rendered fine. `e2e/app.ts` therefore waits for the main process to report the page loaded,
then attaches a second CDP client that sees the real page. `launch()` returns a `close()` that disconnects
that client before quitting. Don't replace it with `firstWindow()` or with retries.

## 5. Fixtures

- `test/fixtures/images/`: small (≤ 512 px) images covering every format, alpha, ICC profiles (sRGB,
  Display-P3, Adobe RGB, grey, CMYK JPEG), EXIF orientations 1–8, 16-bit PNG, animated GIF, progressive
  JPEG. All are generated by a script or public domain, with a source README.
- `test/fixtures/psd/`: a curated set with their origin and license noted. We never commit copyrighted
  artwork, only synthetic test compositions.
- `test/fixtures/iep/v1/`: golden project files (backward compatibility).
- `test/golden/`: baseline PNGs, generated **only in CI** (`update-goldens` workflow that opens a PR with
  the diffs attached for visual review).

## 6. Performance budgets (nightly bench, Linux CI + manual matrix on real GPUs before release)

| Metric | Budget |
| --- | --- |
| Open 24 MP JPEG → first render | < 1.5 s |
| Brush latency p95 (200 px, 6000×4000) | < 16 ms |
| Pan/zoom frame time p95 (24 MP, 20 layers) | < 16.7 ms |
| Adjustment slider preview (24 MP) | ≥ 30 fps |
| Gaussian blur r=50 (24 MP, GPU) | < 1 s |
| AI background removal (12 MP) | < 4 s WebGPU / < 15 s WASM |
| Save `.iep` (24 MP, 10 layers) | < 3 s |

CI runners have no real GPU, so the GPU budgets are validated on the **release hardware matrix**: a
Windows laptop with Intel Iris Xe, a Windows desktop with an NVIDIA GPU, a MacBook Air M1, and a Linux
laptop with AMD graphics. Results are recorded in the release checklist.

## 7. Coverage gates

engine `doc/` + `history/` + `tiles/` 90 % · CPU references 95 % · renderer overall 70 % · main 70 % · codec-host 80 %.

## 8. Release QA checklist (each OS)

- [ ] Install/upgrade. File associations for `.iep`, `.psd`, `.png`, `.jpg` (as "Open with").
- [ ] Tablet pressure (Wacom / Apple Pencil via Sidecar / Surface Pen) on at least one device per OS
- [ ] Journeys 1–7 manually on real GPUs
- [ ] GPU-off mode (Preferences) still works
- [ ] Recovery after a forced kill
- [ ] AI model download → offline use afterwards (network disabled)
- [ ] Screen reader smoke on the Layers panel, dialogs and menus
