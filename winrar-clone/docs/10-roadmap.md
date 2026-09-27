# 10 — Roadmap: WinrarClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

Estimates assume one developer working part-time alongside WhatsappClone. Recalibrate after M1.

| Milestone | Theme | Est. |
| --- | --- | --- |
| M0 | Foundations & engine spike | 1–2 wks |
| M1 | Open, browse, extract, test (safe by default) | 4–5 wks |
| M2 | Create archives, preview, drag in/out, batch | 4 wks |
| M3 | OS integration (context menus, CLI), polish, v1.0 | 3–4 wks |
| M4 | Power features & distribution | ongoing |

## M0 — Foundations & engine spike

- [x] Documentation set (this folder)
- [x] Scaffold `app/` (Electron 44, electron-vite 5, React 19, TS 6), with the security baseline (sandbox,
  context isolation, strict CSP, navigation/permission guards) and a zod-validated IPC router
- [x] `scripts/fetch-7zip.ts` + pinned 7-Zip 26.03 hashes for win32-x64/arm64, darwin-x64/arm64, linux-x64/arm64
- [x] **Spike:** password via stdin (works on Linux; CI covers Windows/macOS). List/progress/error output
  fixtures captured (`src/main/engine/__fixtures__/linux-26.03/`). Findings are in ADR-0002 follow-ups.
- [ ] Measure raw 7-Zip throughput baseline (moved to M1, together with extraction, NFR-PERF-01)
- [x] CI check job (`.github/workflows/winrar-ci.yml`, Linux/Windows/macOS). RAR fixtures from the libarchive
  test suite (`app/test/fixtures/rar/`). The generator for other fixtures comes with M1 safety tests.
- [x] Minimal UI: open by dialog or drop, password prompt, folder browser with sort, filter and breadcrumbs

**Exit:** the app lists a ZIP and a RAR5 on all 3 OSes in CI. The spike results are recorded in ADR-0002's
follow-ups.

## M1 — Open, browse, extract, test

FR-BRW-01..05, 08, 09 · FR-EXT-01..03, 05, 06, 08..10 · FR-TST-01 · FR-SAFE-01..04, 06, 07 · FR-INT-01, 05, 07, 09 · FR-GEN-01, 02, 04, 05

**Exit:** T-SAFE-01..09 and T-EXT-01..07 green on all 3 OSes. Signed installers. Auto-update works from M1
beta 1 → beta 2.

## M2 — Create, preview, drag, batch

FR-BRW-06, 07 · FR-EXT-04, 07 · FR-CRT-01..05, 07 · FR-TST-02 · FR-SAFE-05, 08 · FR-INT-06

**Exit:** T-CRT-01/02 green. Created archives verified by independent tools (Python zipfile/py7zr, GNU
tar). NFR-PERF-01/02 met.

## M3 — OS integration & v1.0

FR-INT-02..04, 08 · FR-CRT-06 · FR-EXT-11 · accessibility audit · i18n scaffolding · release QA

**Exit:** the verification matrix in [09 §5](09-platform-integration.md#5-verification-matrix) is fully
green. Every "Must" requirement is done. v1.0.0 published.

## M4 — Power features & distribution

- FR-CRT-08..10 (add/delete in existing archives, convert, profiles), FR-GEN-03 (Swahili)
- Windows 11 modern context menu (sparse package + `IExplorerCommand`)
- macOS Finder Sync extension
- winget, Homebrew cask, possibly Flathub and MSIX (requirements Q2)
- 7-Zip sandboxing ([Security §6](06-security.md#6-future-hardening))
- Optional: SFX creation (requirements Q4), archive comments editing, hash tools (CRC32/SHA-256 of files)
