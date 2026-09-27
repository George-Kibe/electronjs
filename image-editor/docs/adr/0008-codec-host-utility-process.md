# ADR-0008: Decode/encode with sharp in an isolated utilityProcess; PSD and zip in workers

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-DOC-02, FR-DOC-05, FR-BAT-*, NFR-SEC-01

## Context

We need robust decoding/encoding for many formats with ICC conversion, EXIF orientation and metadata
control, plus fast batch processing. Image decoders are a major attack surface.

## Options considered

1. **Browser-native decoding (`createImageBitmap`) + canvas encoding:** sandboxed and free. But it has
   limited export control (no mozjpeg options, no metadata control, no ICC embedding), no TIFF, and
   premultiplied canvas encode loses data at low alpha.
2. **WASM codecs (squoosh/jSquash):** sandboxed and good export control, but many separate modules, no
   unified ICC pipeline, and slower batch processing.
3. **sharp (libvips) in the main process:** fast and complete, but untrusted parsing would happen in the
   most privileged process. Rejected.
4. **sharp in a dedicated `utilityProcess` (chosen):** fast, complete (ICC via LittleCMS, EXIF, AVIF,
   TIFF, mozjpeg), process-isolated from main and the renderer, and restartable on crash.

## Decision

- `codec-host` utilityProcess runs sharp. Main binds file paths to requests and brokers a MessagePort to the
  renderer for pixel streaming. Main never parses image bytes.
- PSD (ag-psd) and `.iep` (fflate) are parsed in renderer workers (memory-safe JS, resource-limited).
- Future hardening: OS-level sandboxing of codec-host (see Security §2).

## Consequences

- sharp's native binaries must be unpacked from asar and signed, and per-arch builds are required (no mac universal build).
- libvips/codec CVEs require fast sharp upgrades (within 14 days for critical fixes).
- BMP export needs a small built-in encoder (sharp has no BMP output).
