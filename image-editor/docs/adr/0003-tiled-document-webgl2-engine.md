# ADR-0003: Sparse immutable tiles + WebGL2 compositor, CPU as source of truth

- **Status:** Accepted (validated by the M0 spike; record measurements below)
- **Date:** 2026-09-27
- **Related requirements:** NFR-PERF-01..05, NFR-MEM-01, NFR-REL-02, FR-HIS-*

## Context

We need smooth painting and navigation on 24 MP+ documents with 20+ layers, live adjustment previews,
deep undo, and resilience to GPU context loss, all inside an Electron renderer.

## Options considered

1. **Canvas 2D per layer:** simple, but compositing many large layers with custom blend modes and live
   adjustments on the CPU/Skia path cannot hit the frame budgets. Masks and adjustment layers are awkward.
   Memory is a full buffer per layer.
2. **WebGL2 with whole-layer textures:** fast, but limited by `MAX_TEXTURE_SIZE` (often 16384) and VRAM, has
   no sparsity, and context loss loses data if the GPU is the source of truth.
3. **WebGPU:** a modern API with compute shaders, but availability on Linux and older GPUs is uneven in
   Chromium today. It could be adopted later behind the same compositor interface.
4. **Sparse tiles (256²) in CPU memory + WebGL2 compositor/texture cache (chosen):** the approach used by
   professional editors. Sparse memory, arbitrary document size, dirty-region rendering, cheap history
   (immutable tiles), and GPU context loss is recoverable.

## Decision

- Tiles: 256×256, RGBA8 (masks A8), **straight alpha** in storage (preserves colour under low alpha,
  matches PSD/PNG semantics), **immutable** (copy-on-write) and reference-counted.
- GPU: WebGL2 via ANGLE. Tile textures are an LRU cache. RGBA16F intermediates where
  `EXT_color_buffer_float` is available. Premultiplied compositing internally.
- Brush strokes and filters render on the GPU and are read back asynchronously (PBO + fence) into new
  CPU tiles before the command commits.
- The engine runs on the renderer main thread (lowest input latency). CPU-heavy work goes to workers.
  An `OffscreenCanvas` engine worker is a possible future move if UI-thread contention shows up in profiling.

## Consequences

- Readback adds latency at stroke commit (not during the stroke). Keep dirty regions tight.
- Tile-apron handling is needed for convolution filters (sampling neighbour tiles).
- Two implementations of each pixel operation (GPU shader + CPU reference) are needed, but they double as a test oracle.
## Follow-ups (M0 spike, 2026-09-28)

- **Commit on the CPU, preview on the GPU.** Tile textures are uploaded premultiplied with mipmaps, so
  zoomed-out views filter correctly. Committing strokes on the GPU would unpremultiply every pixel of each
  touched tile and change semi-transparent pixels the stroke never covered. The CPU commit
  (`applyStroke`) is exact and leaves untouched pixels byte-identical. The live preview shader uses the
  same formula, and `gpu.gpu.test.ts` checks shader vs CPU within ±2/255 (mutation-tested).
- **Tiled stroke buffer** (RGBA16F per 256² tile) instead of one document-sized texture. It works beyond
  `MAX_TEXTURE_SIZE` (8192 on SwiftShader) and allocates only where the brush goes.
- **Measured (M0, SwiftShader software GL, headless Chromium, 800×600, 30 px brush):** brush latency
  p50 ≈ 11–13 ms, p95 ≈ 15–16 ms, stroke commit ≈ 17–22 ms. The CI e2e job logs the same metric per OS
  (`brush-latency`). Real-GPU numbers on the release hardware matrix are still to be recorded.
- **M0 exit, CI e2e (30 px brush, 480×640 photo, p95):** Linux 12.2 ms, Windows 8.6–9.2 ms (both
  SwiftShader), macOS 19.2–25.9 ms (Apple paravirtual Metal device in a VM). The macOS VM number is above
  the 16 ms budget. That runner has no real GPU, so it does not show whether NFR-PERF-02 is met. **Plan:**
  in M1, `pnpm bench` measures NFR-PERF-02/03 at their real sizes (200 px brush on 6000×4000; pan/zoom on
  24 MP × 20 layers) on the release hardware matrix (docs/07 §6). If the M1 Air misses, profile the
  per-dab draw calls first (batch dabs into one instanced draw per frame).
- **Software fallback:** Chromium no longer falls back to SwiftShader automatically, so main sets
  `--enable-unsafe-swiftshader` (NFR-COMP-01). See docs/06 §4 for why this is acceptable here.
