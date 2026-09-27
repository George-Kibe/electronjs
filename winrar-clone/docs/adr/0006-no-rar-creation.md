# ADR-0006: Do not support creating RAR archives

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** Non-goals §1.2

## Context

Users may expect a "WinRAR clone" to create `.rar` files. The RAR compression algorithm is proprietary.
The unRAR license explicitly forbids using its code to re-create RAR compression, and the only legal RAR
creator is RARLAB's licensed `rar`/WinRAR.

## Decision

WinrarClone extracts RAR but does not create it. For creation it offers ZIP (maximum compatibility) and 7z
(better compression, AES-256 with encrypted names). The UI explains this in the Create dialog's help tooltip.

## Consequences

- Legally clean. No dependency on RARLAB licensing.
- Some users will miss RAR creation. The 7z format covers the technical use cases (solid compression,
  strong encryption, split volumes).
