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
| Golden images | Vitest (node), `pnpm test:golden` | Render fixture documents (every blend mode × opacity × mask, every filter/adjustment at 3 parameter sets, text samples) → compare with baselines. *As built (M2):* rendered by the CPU reference, which the GPU conformance tests tie the shaders to; see §5 | PR (full set, 3 OS) |
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
| T-HIS-02 | Memory budget exceeded → tiles spill to OPFS. Undo past the spill restores pixels exactly. As built: `history.test.ts` ("history spill"): undo/redo past spilled steps with the tiles read back and with them still in memory, a property test over every command kind with budgets of 0, 1 and 4 tiles, and the failure and race cases (failed write → drop oldest instead; failed read → document unchanged, unreachable steps removed; undo during a write; a write finishing during a restore). Also `scratch-file.test.ts` (slots, damage detection, full disk), `scratch.browser.test.ts` (real OPFS and worker; a crashed session's file is removed, an open window's is kept) and `e2e/history-spill.spec.ts` (8 Inverts of 24 MP over a 512 MB budget, garbage collection, then undo reads the disk) |
| T-HIS-03 | Slider drag with 60 updates → 1 history entry |
| T-GPU-01 | Simulated `WEBGL_lose_context` mid-stroke → context restored. Document pixels identical to CPU truth. The stroke is either committed or cleanly cancelled. |
| T-BLD-01 | All 18 blend modes (Dissolve with a fixed noise seed) × opacity {0.3, 1} × mask on/off match the CPU reference within ±2/255. As built: `gpu.gpu.test.ts` ("T-BLD-01, all 18 modes"). Dissolve's noise is a hash of the document pixel, not a seed. Five modes amplify the GPU's 8-bit premultiplied tiles (a colour at alpha α is known to about ±0.5/α levels) and RGBA16F backdrop: Dissolve (translucent pixels shown at full strength), Color Burn and Color Dodge (divide by Cs or 1 − Cs), Hue and Saturation (stretch near-greys). For them 99 % of samples are within ±2/255 with opaque sources and ±4/255 with translucent ones, and none is more than 16/255 off. The other 13 meet ±2/255 everywhere |
| T-BRU-01 | Brush stroke with pressure 0→1 produces a size taper. Spacing is consistent at zoom levels 25 %–800 %. |
| T-SEL-01 | Magic wand tolerance 32 contiguous vs non-contiguous against a fixture with known regions. As built: `engine/ops/wand.test.ts` (exact areas for contiguous, non-contiguous, tolerance 0/32/80, transparent pixels, anti-aliasing) and the wand journey in `e2e/selections.spec.ts` |
| T-TRF-01 | Rotate 90° × 4 = identity (bit-exact). Free transform scale 50 % then 200 % stays within the bicubic tolerance. |
| T-IO-01 | JPEG with EXIF orientation 6 opens upright. Display-P3 fixture converts to sRGB with ΔE < 2 against a reference conversion (LittleCMS). |
| T-IO-02 | Export JPEG with "Remove location": output has no GPS tags and has an sRGB ICC profile |
| T-IO-03 | `.iep` round trip of a document containing every layer type → identical model and pixels. v1 fixture files load forever. |
| T-IO-04 | Atomic save: kill the process during write → the original file is intact. As built: `main/services/atomic-write.test.ts` SIGKILLs a separate Node process running the real `writeAtomic` at 8 moments of a 32 MB save; the file is always exactly the old or the new bytes |
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

Layer masks (M2 slice 2a): `e2e/masks.spec.ts` adds a mask, paints it to hide part of a layer, disables
and re-enables it, applies and undoes it, and hides a selection.

Selections (M2 slice 1a): `e2e/selections.spec.ts` drags marquees in every mode, paints across the edge of
a selection, clears it with Delete, and drives the Select menu and its keys.

As built for the M1 exit: `e2e/journeys.spec.ts` runs journey 1 without the text step (M3) and journey 2
without the Levels adjustment layer (M2), and checks the exported files' pixels, size and metadata. Journey
2 includes the Levels adjustment layer since M2 slice 4. Journey 4 (marquee → feather → Gaussian blur
inside the selection) is in `journeys.spec.ts` since M2 slice 5a. The same file records NFR-PERF-05
(`job:Gaussian Blur`, r = 50 on 6000×4000, first and warm runs) as an annotation.

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
  *As built (M2):* the baselines are rendered by the CPU reference (plain TypeScript, the same bits on every
  OS), not the GPU, so they need no CI runner to generate. `test/golden/golden.test.ts` renders three
  contact sheets (`blend-modes.png`, `adjustments.png`, `filters.png`) and compares them cell by cell within
  ±2/255. A failure names the cells and writes `__diff__/<name>.actual.png` and `<name>.diff.png` (red: out
  of tolerance, amber: changed within it), uploaded as a CI artifact. A missing baseline is written locally
  and fails in CI. `pnpm test:golden --update` rewrites them, only after the visual change has been
  reviewed. The `update-goldens` workflow is not needed while the baselines come from the CPU reference.

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

*As built (M2):* E2E records `brush-latency` (pointer → frame) and `adjust-latency` (adjustment change →
frame, NFR-PERF-04, `adjustments.spec.ts` on a 6000×4000 document) as test annotations on every OS. They
assert only that frames were measured, since CI uses SwiftShader. A Linux laptop with Intel Iris Xe
measured `adjust-latency` p95 of 14–22 ms (≥ 45 fps).

## 7. Coverage gates

engine `doc/` + `history/` + `tiles/` 90 % · CPU references 95 % · renderer overall 70 % · main 70 % · codec-host 80 %.

## 8. Release QA checklist (each OS)

- [ ] Install/upgrade. File associations for `.iep`, `.psd`, `.png`, `.jpg` (as "Open with").
- [ ] Tablet pressure (Wacom / Apple Pencil via Sidecar / Surface Pen) on at least one device per OS
- [ ] Journeys 1–7 manually on real GPUs
- [ ] GPU-off mode (Preferences) still works
- [ ] Recovery after a forced kill
- [ ] Auto-update from the previous release (signed build): banner, Restart Now blocked while a document
      has unsaved changes, install on Restart Now and on quit; Beta channel offers the pre-release
- [ ] Crash reports: off on a fresh install; after opting in, a forced renderer crash (`chrome://crash` from
      a debug build) reaches the crash-report project with no paths or file names
- [ ] Drag a document tab out of the window: it opens in a new window at the drop point (E2E covers
      Window › Move Tab to New Window; the drag gesture leaves the browser, so it is checked by hand)
- [ ] AI model download → offline use afterwards (network disabled)
- [ ] Screen reader smoke on the Layers panel, dialogs and menus
