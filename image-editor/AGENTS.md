# AGENTS.md — ImageEditor

The root [`AGENTS.md`](../AGENTS.md) also applies to this project. The rules here are more specific.

## Map

```
image-editor/app/src/
├── main/                 # Electron main: windows, menus, app:// protocol, file dialogs, atomic writes, recovery, updates, model downloads
├── codec-host/           # utilityProcess entry: sharp (decode/encode/ICC/batch). Untrusted raster input is parsed HERE, not in main.
├── preload/              # contextBridge `window.api`
├── renderer/src/
│   ├── engine/           # NO React. Document model, tiles, WebGL2 compositor, shaders, brush engine, history
│   │   ├── doc/          # Document, Layer types, Selection, commands (the ONLY way to mutate a document)
│   │   ├── tiles/        # immutable Tile, sparse TileGrid, TilePool
│   │   ├── gpu/          # compositor, texture cache, stroke buffer, programs, shaders/*.vert|*.frag
│   │   ├── render/       # compositor, viewport, overlays
│   │   ├── tools/ brush/ ops/   # tool state machines, brush engine, adjustments/filters/transforms
│   │   ├── history/      # undo/redo, memory budget, spill to OPFS
│   │   └── io/           # import/export orchestration
│   ├── workers/          # worker entrypoints: cpu-ops (flood fill, histogram), files (ag-psd, fflate), ai (onnxruntime-web), scratch (OPFS)
│   ├── ui/               # React: workspace, panels, options bar, dialogs
│   └── state/            # Zustand stores bridging engine events → UI
└── shared/               # IPC contract + zod schemas, format constants, .iep schema
```

## Commands (inside `image-editor/app`)

`pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm format:check` · `pnpm test` · `pnpm test:gpu` · `pnpm test:e2e` · `pnpm pack:dir` · `pnpm dist`
(golden-image tests and `pnpm bench` arrive in M1/M2.)

- GPU tests (`*.gpu.test.ts`) run in headless Chromium via Vitest browser mode. The config uses
  `/opt/pw-browsers` Chromium when present, and CI runs `playwright install chromium`.
- Every shader has a CPU reference in TypeScript. When you change one, change both and keep the
  conformance test green.

## Architecture rules

1. **Engine is framework-free.** `renderer/src/engine/**` must not import React, Zustand or `ui/`. The UI
   subscribes to engine events. This keeps the engine testable headlessly.
2. **All document mutations are Commands** (`engine/doc/commands.ts`) that implement `do/undo` and report
   the dirty tile set. No ad-hoc pixel writes from tools or UI.
3. **Pixels live in immutable tiles** (256×256 RGBA8, straight/unpremultiplied alpha; see ADR-0003). Never allocate a full-canvas buffer on
   the UI thread. Export renders in bands (docs/02 §7.2).
4. **GPU is a cache, CPU tiles are the source of truth.** Any GPU-side edit must be read back into tiles
   before the command completes (see docs/02 §5).
5. **Untrusted files** are decoded only in the `codec-host` utilityProcess (sharp) or in workers (PSD/zip).
   Main never parses image bytes.
6. **Colour:** the working space is sRGB 8-bit. Convert on import and tag on export (docs/09). Do blend
   math in linear or gamma space exactly as the relevant ADR says. Don't change it ad hoc.
7. Shaders live in `.vert`/`.frag` files with a header comment naming the formula source (e.g. W3C Compositing spec section).

## Sensitive areas (ask a human first)

`engine/history/**` (data loss risk), `.iep` format reader/writer (compatibility), `codec-host/**`
(untrusted input), AI model URLs and hashes, blend-mode shaders (golden-image baselines).

## Testing expectations

- Every command: unit test for do → undo → redo round trip with pixel equality.
- Every filter, adjustment and blend mode: golden-image test, compared with a tolerance (see docs/07).
- Every importer: fixture files + fuzz corpus entry.
