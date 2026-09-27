# WinrarClone

> Working name. It will be renamed before public release. Product name, app ID and bundle ID live in one
> constants file, so a rename is a single change. This app is not affiliated with WinRAR or RARLAB.

A fast, safe, cross-platform archive manager for Windows, macOS and Linux. It can:

- **Extract** RAR (RAR4 and RAR5, including multi-volume and password-protected), ZIP, 7z, TAR, GZ, BZ2, XZ, ISO, CAB and more
- **Create** ZIP, 7z and TAR (+ .gz / .xz / .bz2) archives with AES-256 encryption, compression levels and split volumes
- **Browse, preview and test** archives without extracting them
- Integrate with the OS: "Extract here" / "Compress" context menus, file associations, drag and drop

The engine is the official **7-Zip** command-line binary, bundled per platform
([ADR-0002](docs/adr/0002-bundled-7zip-engine.md)). Creating `.rar` archives is **not** supported, because
the RAR compression algorithm is proprietary and licensed only through WinRAR.

## Layout

```
winrar-clone/
├── app/        # Electron + React + TypeScript application (to be scaffolded)
│   └── vendor/7zip/<platform>-<arch>/   # pinned 7-Zip binaries, fetched and verified by script (not committed)
└── docs/       # requirements, architecture, design, ADRs...
```

## Quick start (development)

> Not scaffolded yet. These commands describe the target developer experience.

```bash
cd winrar-clone/app
pnpm install            # postinstall runs scripts/fetch-7zip.ts: downloads the pinned 7-Zip build and verifies its SHA-256
pnpm dev                # Electron with HMR
pnpm test               # unit tests
pnpm test:e2e           # Playwright E2E over the fixture archive corpus
pnpm dist               # local installer for the current OS
```

## Documentation

| Doc | Purpose |
| --- | --- |
| [01 Requirements](docs/01-requirements.md) | Goals, functional and non-functional requirements, acceptance criteria |
| [02 Architecture](docs/02-architecture.md) | Processes, components, job pipeline, key flows |
| [03 UI/UX Design](docs/03-ui-ux-design.md) | Screens, interactions, accessibility |
| [04 IPC & Engine Contract](docs/04-ipc-engine-contract.md) | Renderer↔main IPC API, 7-Zip invocation and output parsing |
| [05 Data Model](docs/05-data-model.md) | Settings, job history, archive listing model |
| [06 Security](docs/06-security.md) | Threat model: path traversal, symlinks, zip bombs, MotW, Electron hardening |
| [07 Testing](docs/07-testing-strategy.md) | Test corpus, pyramid, matrix |
| [08 CI/CD & Release](docs/08-ci-cd-release.md) | Pipelines, signing, notarization, auto-update |
| [09 Platform Integration](docs/09-platform-integration.md) | Context menus, file associations, CLI arguments per OS |
| [10 Roadmap](docs/10-roadmap.md) | Milestones and exit criteria |
| [ADRs](docs/adr/) | Architecture Decision Records |

## License

MIT for this project's code (see the [root LICENSE](../LICENSE)). The bundled 7-Zip binaries are licensed
separately (GNU LGPL + BSD-3-Clause + the unRAR license restriction). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
