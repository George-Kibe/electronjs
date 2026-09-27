# ADR-0005: Single-instance app with CLI intent forwarding and batching

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-INT-02..05

## Context

File managers invoke context-menu verbs by starting the executable, often once per selected file (Windows
classic verbs), which would spawn N Electron instances.

## Decision

- `app.requestSingleInstanceLock()`. Secondary instances forward argv + cwd through `second-instance`
  and quit immediately.
- Intents that arrive within 500 ms are merged into one batch and one job group.
- Headless mode shows only a compact jobs window when the main window is closed.
- Optional background-ready mode keeps the primary instance alive for instant response.

## Consequences

- Fast, coherent UX for multi-select operations.
- Secondary instance start-up cost (~150–300 ms of Electron boot) remains unless background mode is on. A
  future native launcher stub could forward through a named pipe/socket without booting Electron.
