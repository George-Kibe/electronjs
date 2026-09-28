# Electron Desktop Apps

A collection of cross-platform desktop applications built with [Electron](https://www.electronjs.org/).
Each project lives in its own independent folder with its own dependencies, docs and release process.

| Project | Status | Description |
| --- | --- | --- |
| [`image-editor/`](image-editor/) | In development (M1 in progress) | Photoshop-style raster editor: layers, selections, masks, adjustments, painting, text, PSD, batch, on-device AI. Formerly `image-resizer`. |
| [`whatsapp-clone/`](whatsapp-clone/) | Planning | Real-time messaging platform: desktop client + Node.js backend. 1:1 and group chat, media, E2EE, voice/video calls. |
| [`winrar-clone/`](winrar-clone/) | In development (M0 done, M1 next) | Archive manager: extract RAR/ZIP/7z/tar, create ZIP/7z/tar, browse, test, OS shell integration. |

> **Naming:** `ImageEditor`, `WhatsappClone` and `WinrarClone` are working names only. They will be renamed before any
> public release. We must not ship with "WhatsApp" or "WinRAR" in product names, icons or store listings,
> because both are registered trademarks (the same care applies to "Photoshop" and Adobe's icons). See [ADR guidance in each project](whatsapp-clone/docs/adr/).

## Repository layout

```
.
├── README.md                 # You are here
├── AGENTS.md                 # Instructions for AI coding agents (all tools)
├── CLAUDE.md                 # Claude Code specific instructions (imports AGENTS.md)
├── CONTRIBUTING.md           # How to contribute: branching, commits, reviews
├── SECURITY.md               # How to report vulnerabilities
├── LICENSE                   # MIT
├── .github/                  # PR template, CI workflows (per-project, path-filtered)
├── image-editor/
│   ├── app/                  # Electron + React + WebGL2 app      (to be scaffolded)
│   └── docs/                 # Requirements, architecture, design, ADRs...
├── whatsapp-clone/
│   ├── desktop/              # Electron + React client        (to be scaffolded)
│   ├── server/               # NestJS API + realtime gateway  (to be scaffolded)
│   ├── protocol/             # Shared wire types / zod schemas (to be scaffolded)
│   └── docs/                 # Requirements, architecture, design, ADRs...
└── winrar-clone/
    ├── app/                  # Electron + React app           (to be scaffolded)
    └── docs/                 # Requirements, architecture, design, ADRs...
```

## Documentation map

Each project has the same documentation set so they are easy to navigate:

| # | Document | ImageEditor | WhatsappClone | WinrarClone |
| --- | --- | --- | --- | --- |
| 01 | Requirements (PRD) | [link](image-editor/docs/01-requirements.md) | [link](whatsapp-clone/docs/01-requirements.md) | [link](winrar-clone/docs/01-requirements.md) |
| 02 | Architecture | [link](image-editor/docs/02-architecture.md) | [link](whatsapp-clone/docs/02-architecture.md) | [link](winrar-clone/docs/02-architecture.md) |
| 03 | UI/UX design | [link](image-editor/docs/03-ui-ux-design.md) | [link](whatsapp-clone/docs/03-ui-ux-design.md) | [link](winrar-clone/docs/03-ui-ux-design.md) |
| 04 | Interfaces (API / IPC) | [IPC & command API](image-editor/docs/04-ipc-command-api.md) | [API & realtime protocol](whatsapp-clone/docs/04-api-protocol.md) | [IPC & engine contract](winrar-clone/docs/04-ipc-engine-contract.md) |
| 05 | Data model | [Model & `.iep` format](image-editor/docs/05-data-model.md) | [link](whatsapp-clone/docs/05-data-model.md) | [Settings & state](winrar-clone/docs/05-data-model.md) |
| 06 | Security & threat model | [link](image-editor/docs/06-security.md) | [link](whatsapp-clone/docs/06-security.md) | [link](winrar-clone/docs/06-security.md) |
| 07 | Testing & QA strategy | [link](image-editor/docs/07-testing-strategy.md) | [link](whatsapp-clone/docs/07-testing-strategy.md) | [link](winrar-clone/docs/07-testing-strategy.md) |
| 08 | CI/CD & release | [link](image-editor/docs/08-ci-cd-release.md) | [link](whatsapp-clone/docs/08-ci-cd-release.md) | [link](winrar-clone/docs/08-ci-cd-release.md) |
| 09 | Domain-specific | [Formats & colour](image-editor/docs/09-file-formats-color.md) | [Deployment & ops](whatsapp-clone/docs/09-deployment-operations.md) | [OS integration](winrar-clone/docs/09-platform-integration.md) |
| 10 | Roadmap | [link](image-editor/docs/10-roadmap.md) | [link](whatsapp-clone/docs/10-roadmap.md) | [link](winrar-clone/docs/10-roadmap.md) |
| — | ADRs | [link](image-editor/docs/adr/) | [link](whatsapp-clone/docs/adr/) | [link](winrar-clone/docs/adr/) |

## Shared engineering baseline

All three projects share these conventions. The per-project docs go into detail.

- **Language:** TypeScript (strict), ESM.
- **Desktop:** Electron (latest stable) + [electron-vite](https://electron-vite.org/) + React + Tailwind CSS.
- **Packaging:** electron-builder; Windows (NSIS), macOS (DMG, notarized), Linux (AppImage, deb, rpm).
- **Updates:** electron-updater backed by GitHub Releases.
- **Quality:** ESLint, Prettier, Vitest (unit), Playwright (Electron E2E), GitHub Actions on all 3 OSes.
- **Runtime:** Node.js 24 LTS for tooling and the server.
- **Package manager:** pnpm, one lockfile per independent package.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/). **Versioning:** SemVer per project.

## License

[MIT](LICENSE) © 2026 George Kibe. Third-party components keep their own licenses. See each project's
`THIRD_PARTY_NOTICES.md`.
