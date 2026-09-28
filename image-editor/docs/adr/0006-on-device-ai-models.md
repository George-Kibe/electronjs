# ADR-0006: On-device AI with onnxruntime-web and permissively licensed models

- **Status:** Proposed. Model selection is finalised at the start of M4 (requirements Q2).
- **Date:** 2026-09-27
- **Related requirements:** FR-AI-01..05, FR-SEL-08, FR-BAT-05, NFR-PERF-06

## Context

We want background removal and "Select subject" that are private, offline and free to run. The model
license must allow commercial redistribution, because the app is MIT and may be sold or used commercially.

## Options considered

**Runtime**
1. **onnxruntime-web in a renderer worker (chosen):** WebGPU execution provider with a WASM (SIMD + threads)
   fallback. No native module. The same code works on all OSes. Needs cross-origin isolation for threads
   (provided by the `app://` COOP/COEP headers).
2. onnxruntime-node in a utilityProcess: faster on CPU (with DirectML/CoreML execution providers), but it
   adds large native binaries per platform. Keep it as a fallback if WebGPU/WASM performance misses the targets.
3. Cloud API: rejected (privacy, cost, offline).

**Model candidates (license gate: MIT / Apache-2.0 / BSD only)**

| Model | License | Notes |
| --- | --- | --- |
| BiRefNet (lite variants) | MIT | High-quality dichotomous segmentation. Larger model. |
| IS-Net (DIS) | Apache-2.0 | Good general-purpose results |
| U²-Net / U²-Netp | Apache-2.0 | Small (u2netp is only a few MB), lower quality. A good fallback/"fast" option. |
| MODNet | Apache-2.0 | Portrait-specialised matting |
| ~~RMBG-1.4 / RMBG-2.0~~ | ~~CC BY-NC / non-commercial~~ | **Excluded** (non-commercial license) |

## Decision (proposed)

onnxruntime-web in an AI worker. Primary model: a BiRefNet-lite variant (MIT), exported to ONNX, fp16
where WebGPU supports it. Fast/fallback model: U²-Netp. Both are downloaded on demand from a URL we
control (a GitHub Release asset), with their SHA-256 and license pinned in `models.json`.

## Consequences

- The first-use download is tens to hundreds of MB. We show the size and ask for consent. An offline
  installer variant is also available.
- Quality and speed must be benchmarked in M4 on the fixture set (T-AI-01) before we commit.
- CI enforces the model license allowlist.
