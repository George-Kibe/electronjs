# ImageEditor

> Working name. It will be renamed before public release. Product name, app ID and bundle ID live in one
> constants file, so a rename is a single change. Formerly `image-resizer`: that learning project's code
> remains in git history at commit `3eadc27`.

A fast, approachable, cross-platform (Windows, macOS, Linux) raster image editor for hobbyists and everyday
users. It covers the primary features of Photoshop-class software:

- **Layers:** raster, text, shape, adjustment and group layers, with opacity, blend modes and masks
- **Selections:** marquee, lasso, magic wand and AI "Select subject", with feather, grow/shrink and invert
- **Transform & adjust:** crop, resize, rotate, flip, free transform, and non-destructive adjustment layers
  (levels, curves, hue/saturation…), plus filters (blur, sharpen, noise…)
- **Paint & text:** brush, pencil, eraser, fill, gradient, clone stamp, shapes, text, eyedropper
  (pressure-sensitive tablet support)
- **Files:** PNG, JPEG, WebP, AVIF, GIF, BMP and TIFF import/export (ICC-aware), PSD import/export, and a
  native layered project format (`.iep`)
- **Extras:** batch resize/convert/watermark, and on-device AI background removal (private, works offline)

## Layout

```
image-editor/
├── app/     # Electron + React + TypeScript + WebGL2 application (to be scaffolded)
└── docs/    # requirements, architecture, design, ADRs...
```

## Quick start (development)

Requires Node.js 22.12+ (24 recommended) and pnpm 10 (`corepack enable`).

```bash
cd image-editor/app
pnpm install
pnpm dev              # Electron with HMR
pnpm test             # unit tests (engine, codec host, main)
pnpm test:gpu         # GPU conformance: shaders vs CPU reference in headless Chromium
pnpm test:e2e         # Playwright E2E of the real Electron app
pnpm dist             # local installer for the current OS
```

## Documentation

| Doc | Purpose |
| --- | --- |
| [01 Requirements](docs/01-requirements.md) | Goals, feature requirements, non-functional targets, acceptance criteria |
| [02 Architecture](docs/02-architecture.md) | Processes, document model, tiled WebGL2 engine, history, workers |
| [03 UI/UX Design](docs/03-ui-ux-design.md) | Workspace, tools, panels, shortcuts, accessibility |
| [04 IPC & Command API](docs/04-ipc-command-api.md) | Renderer↔main IPC, internal command/document API |
| [05 Data Model](docs/05-data-model.md) | Document model, `.iep` project format, settings |
| [06 Security](docs/06-security.md) | Untrusted image decoding, model downloads, Electron hardening, privacy |
| [07 Testing](docs/07-testing-strategy.md) | Golden images, blend-mode conformance, fuzzing, perf |
| [08 CI/CD & Release](docs/08-ci-cd-release.md) | Pipelines, signing, auto-update |
| [09 File Formats & Color](docs/09-file-formats-color.md) | Codecs, PSD mapping, ICC handling, export options |
| [10 Roadmap](docs/10-roadmap.md) | Milestones and exit criteria |
| [ADRs](docs/adr/) | Architecture Decision Records |

## License

MIT (see the [root LICENSE](../LICENSE)). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
