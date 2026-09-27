# ADR-0002: Rebuild as Electron + electron-vite + React + TypeScript

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

The previous `image-resizer` was a small plain-JS Electron app (Traversy Media tutorial style) with
`nodeIntegration: true` and no build tooling, tests or type safety. The product is now a full image
editor, and the other two projects in the repo standardise on TypeScript + React + electron-vite.

## Options considered

1. **Evolve the existing JS code:** keeps history continuity, but none of the code is reusable for a
   tile/GPU editor, and it would keep insecure defaults.
2. **Fresh app in the repo-standard stack:** consistent tooling, security baseline and shared conventions.

## Decision

Rename the folder to `image-editor/` (a git rename keeps history), remove the legacy code (it stays
reachable at commit `3eadc27`), and scaffold a new app with Electron (latest stable) + electron-vite +
React 19 + TypeScript strict + Tailwind v4 + Zustand + zod + Vitest + Playwright + electron-builder.
The engine (`renderer/src/engine`) is framework-free TypeScript + GLSL.

## Consequences

- The batch-resize purpose of the old app lives on as the Batch feature (FR-BAT).
- React is used only for UI chrome. The canvas hot path never goes through React.
