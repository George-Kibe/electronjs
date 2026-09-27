# ADR-0006: Desktop local store: SQLite + SQLCipher in the main process

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-MSG-03/14, NFR-PERF-03/06, NFR-SEC-03

## Context

The desktop needs offline-first storage for potentially hundreds of thousands of messages, full-text
search, transactional sync, and encryption at rest. After E2EE, it is also the only place history exists.

## Options considered

1. **IndexedDB in the renderer:** no Node dependency, but lives in the least trusted process, has weaker
   query and search features, and cannot be used while the window is closed.
2. **SQLite via `better-sqlite3-multiple-ciphers`** in main: synchronous, fast, FTS5, SQLCipher-compatible
   encryption. Native module, so it needs a rebuild per Electron version and arch.
3. **Realm / PouchDB:** extra sync abstractions we don't need.

## Decision

SQLite with SQLCipher-compatible encryption via `better-sqlite3-multiple-ciphers`, in the main process
(heavy queries go to a `worker_threads` worker if profiling shows main-thread blocking). The DB key is
random, wrapped with Electron `safeStorage` (Keychain / DPAPI / libsecret).

## Consequences

- The renderer accesses data only through IPC. This is good for security and adds a small latency cost (≤ 1 ms per call).
- CI must build and test native modules for x64 and arm64 on 3 OSes. `@electron/rebuild` runs in postinstall.
- On Linux without a keyring, `safeStorage` falls back to a weak backend (`basic_text`). We detect this with
  `safeStorage.getSelectedStorageBackend()` and warn the user, offering a passphrase option.
