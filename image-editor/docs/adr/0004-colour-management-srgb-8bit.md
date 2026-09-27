# ADR-0004: 8-bit sRGB working space, ICC conversion on import, gamma-space blending

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** NFR-QUAL-01, NFR-QUAL-03, FR-DOC-02, FR-DOC-05

## Context

Most user images come from phones (Display-P3) and the web (sRGB). Our target users are hobbyists and
everyday users. Full colour-managed, high-bit-depth pipelines add major complexity.

## Options considered

1. **Ignore ICC:** simplest, but phone photos look desaturated or wrong. Rejected.
2. **8-bit sRGB working space with ICC → sRGB on import (chosen).**
3. **Wide-gamut / 16-bit working space:** more accurate, but doubles memory, complicates every shader and
   codec path, and exceeds the "primary features" scope.

## Decision

- Convert to sRGB (relative colorimetric + BPC via LittleCMS in libvips) on import. Embed sRGB on export.
- Blend, adjust and resample in gamma-encoded sRGB (Photoshop default, W3C formulas). Use RGBA16F
  intermediates to reduce banding. Dither on quantisation.
- Let Chromium colour-manage the canvas to the display.

## Consequences

- Wide-gamut colours outside sRGB are clipped on import (the status bar informs the user).
- The data model keeps `colorSpace` and channel-depth fields to allow a future ADR to add P3/16-bit.
