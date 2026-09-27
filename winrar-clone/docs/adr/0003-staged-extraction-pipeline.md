# ADR-0003: Staged, validated extraction pipeline

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-SAFE-01..08, NFR-REL-01

## Context

Archive extractors have a long history of path traversal, symlink escape, ADS abuse and MotW bypass
vulnerabilities, including in 7-Zip itself (CVE-2025-11001/11002). Relying only on the engine's own
protections is not enough. Users also expect cancelled or failed extractions to leave no debris.

## Decision

Every extraction follows **list → pre-validate → extract selected entries into a staging dir on the
destination volume → post-validate (lstat walk) → resolve collisions → atomic move → cleanup**:

- Blocked entries are never passed to 7-Zip (`-i@listfile -spd`).
- Post-validation deletes anything unexpected or escaping (defence in depth against engine bugs).
- Moves use `rename` on the same volume. Cancel or failure deletes only the staging dir.

## Consequences

- There is a small overhead: one extra listing pass, plus a directory walk (a few percent on large archives).
  The ≤ 5 % performance budget must hold.
- Staging requires write access to the destination's volume, which is always true for a valid destination.
- The overwrite and collision logic lives in our code (not 7-Zip's `-ao*`), which lets us report every decision.
