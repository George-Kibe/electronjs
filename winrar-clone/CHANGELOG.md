# Changelog

All notable changes to WinrarClone are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- M0 app scaffold (`app/`): Electron 44 + electron-vite + React 19 + TypeScript, hardened window (sandbox,
  context isolation, strict CSP, navigation and permission guards), zod-validated IPC with sender checks.
- 7-Zip engine adapter: pinned 7-Zip 26.03 fetched and hash-verified per platform, streaming `-slt` listing
  parser, progress and error classifiers, first-volume resolution for multi-part archives, password entry
  through stdin (never on the command line).
- Open an archive by dialog or drag and drop, enter a password for encrypted headers, and browse folders
  with sorting, filtering and breadcrumbs. Bidi-override characters in names are shown visibly.
- CI workflow on Linux, Windows and macOS. RAR4/RAR5 test fixtures from the libarchive test suite.
- Project documentation: requirements, architecture, UI/UX design, IPC & engine contract, data model,
  security, testing, CI/CD, platform integration, roadmap, ADRs 0001–0006.
