# ADR-0004: App stack: Electron + electron-vite + React + TypeScript

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Cross-platform desktop app. The user chose Electron, TypeScript and React. We want one toolchain across
both new projects in this repo.

## Options considered

- **Electron + React + TS (electron-vite):** mature, same stack as WhatsappClone, fast HMR, good security
  guidance. Cost: larger install size (~100 MB).
- **Tauri:** much smaller binaries, Rust backend. Rejected because the user chose Electron and the repo is
  Electron-focused.

## Decision

Electron (latest stable, within the 3 supported majors), electron-vite, React 19, TypeScript strict,
Tailwind v4, Zustand for UI state, TanStack Virtual for large tables, zod for IPC validation,
electron-store, electron-log, electron-updater, electron-builder, Vitest and Playwright.

## Consequences

- Shared conventions and design tokens with WhatsappClone.
- Installer size is about 90–110 MB (NFR-SIZE-01).
