# ADR-0007: Native project format `.iep` (zip + JSON manifest + sparse tiles)

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-DOC-04, FR-DOC-10, NFR-REL-01

## Context

We need a project format that preserves everything, loads fast, can be versioned and inspected, and
tolerates growth. PSD cannot represent our model exactly and is complex to use as a native format.

## Options considered

1. **PSD as native:** interoperable, but lossy for our model (text, adjustments mapping) and complex.
2. **SQLite file:** great for incremental saves, but opaque and has a heavier dependency in the renderer.
3. **ZIP container with JSON manifest + binary tiles (chosen):** the pattern used by OpenRaster/ORA,
   Krita (.kra), ODF and Sketch. Inspectable, and streams well.

## Decision

`.iep` = ZIP (`mimetype` first, stored) + `manifest.json` (zod-validated, versioned) + per-layer `tiles.bin`
(sparse, deflate-compressed raw tiles, straight alpha) + `preview.png`. Fonts are referenced, not embedded.
Writes are atomic (temp + fsync + rename). The extension is a placeholder until the product rename.

## Consequences

- Full rewrite on every save. That is acceptable at our targets (< 3 s for a 24 MP, 10-layer document).
  Incremental saves are Future.
- We can additionally export OpenRaster (`.ora`) later for GIMP/Krita interoperability at low cost, because the structure is similar.
