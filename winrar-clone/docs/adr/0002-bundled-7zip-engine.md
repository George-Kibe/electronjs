# ADR-0002: Use the bundled official 7-Zip CLI as the archive engine

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-EXT-01, FR-EXT-05, FR-CRT-*, NFR-PERF-01, NFR-SEC-02

## Context

We need RAR4/RAR5 extraction (incl. multi-volume, encrypted headers), plus ZIP/7z/TAR creation and
extraction, at native speed on Windows, macOS and Linux (x64 + arm64).

## Options considered

1. **Official 7-Zip CLI binary as a child process** (`7zz` on macOS/Linux, `7z.exe` + `7z.dll` on Windows)
   - Pros: broadest format support, RAR5 and multi-volume included. Native speed. Actively maintained with
     prompt security fixes. Crash isolation. Easy to update. Not linked into our code, which keeps LGPL
     compliance simple.
   - Cons: we have to parse CLI text output. Password passing needs care. The binary has to be signed and
     bundled per arch.
2. **WASM builds (libarchive.js, unrar.js, 7z-wasm)**
   - Pros: no native binaries.
   - Cons: slower (2–5×). Weaker RAR5 and multi-volume support. Memory limits for large archives. Usually
     lags upstream on security fixes.
3. **Native N-API bindings to libarchive / unrar**
   - Pros: structured API.
   - Cons: native build matrix for every Electron upgrade. libarchive's RAR5 support has gaps (for example
     some encrypted archives). A decoder crash takes down our main process.
4. **Pure JS libraries (yauzl, tar-stream, node-7z wrappers)**
   - Cons: no RAR. node-7z is only a wrapper, and we prefer our own thin, audited adapter.

## Decision

Bundle the official 7-Zip binaries (minimum version 25.01), downloaded at build time and verified by
pinned SHA-256. Drive them through our own `engine/` adapter with argv arrays, a streaming parser and
typed errors.

## Consequences

- We track 7-Zip releases (weekly watch workflow) and ship security updates within 14 days.
- Parser correctness depends on the CLI output format, so we pin versions and use captured-output fixtures.
- The M0 spike must confirm stdin password entry on all OSes (see [04 §2.3](../04-ipc-engine-contract.md#23-password-handling)).

## Follow-ups (M0 spike, 2026-09-27)

- Pinned **7-Zip 26.03** (latest at the time). Official builds are fetched from the SourceForge mirror, with
  7-zip.org as fallback, and verified by SHA-256 (`app/scripts/7zip-versions.json`). Linux ships the static
  `7zzs`. Windows `7z.exe`/`7z.dll` are unpacked from the official installer with a host 7-Zip.
- Password through stdin: **works** on Linux (list/test/extract, 7z with encrypted headers, AES ZIP). EOF at the
  prompt makes 7-Zip exit with 255 ("Break signaled"), so the prompt must be detected on stdout. Windows and macOS are
  covered by the CI matrix.
- 7-Zip does not resolve the first volume itself, so we added `volumes.ts` ([04 §2.7](../04-ipc-engine-contract.md#27-multi-volume-sets)).
- Some fatal errors (e.g. `Missing volume`) are printed on stdout, not stderr, so the classifier reads both.
- On Windows 7-Zip prints CRLF line endings, so the line splitter treats `\r\n` as one newline (regression-tested).
- THIRD_PARTY_NOTICES and the About → Licenses screen must include the 7-Zip license and the unRAR restriction.
