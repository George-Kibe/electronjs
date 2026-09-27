# ADR-0005: Adjustment layers + masks; command history over immutable tiles with OPFS spill

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-LAY-04, FR-ADJ-01, FR-HIS-01..03, FR-AI-01, NFR-MEM-01

## Context

The user chose non-destructive editing. Users also expect a long, reliable undo history even with large
documents.

## Decision

- **Non-destructive primitives:** adjustment layers (evaluated in the compositor), layer masks, clipping
  masks, and text/shape layers that keep their parameters. "Remove background" creates a mask. Filters are
  destructive in v1 (smart filters are Future).
- **History:** the command pattern. Pixel commands hold before/after references to immutable tiles, so
  undo/redo swaps references (no copies). Property commands hold small diffs. Slider and nudge commands coalesce.
- **Memory:** a step limit (default 100) plus a byte budget. History-only tiles beyond the budget are
  compressed and spilled to an OPFS scratch file (a secure-context origin via the `app://` scheme), and
  loaded back on demand. The scratch area is wiped at startup.

## Consequences

- Every mutation must go through a Command (enforced by review and lint rules: the engine exposes no public pixel setters).
- OPFS depends on the `app://` secure origin. If it is unavailable, the app falls back to dropping the oldest history steps, with a notice.
