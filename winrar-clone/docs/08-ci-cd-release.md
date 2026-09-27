# 08 — CI/CD & Release: WinrarClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

This project follows the same conventions as [WhatsappClone CI/CD](../../whatsapp-clone/docs/08-ci-cd-release.md)
(trunk-based, Conventional Commits, release-please component `winrar-clone`, tags `winrar-clone-vX.Y.Z`,
GitHub environments for signing). This doc covers only what differs.

## 1. Workflows (`.github/workflows/`, `paths: winrar-clone/**`)

### `winrar-ci.yml` (PR, push to main)

| Job | Runner | Steps |
| --- | --- | --- |
| `check` | ubuntu | install (fetch 7-Zip + verify SHA-256) → lint → typecheck → unit → coverage gates |
| `integration-linux` | ubuntu | fixtures (cached) → engine + jobs integration |
| `e2e-linux` | ubuntu | build → Playwright under xvfb (smoke subset) |
| `security` | ubuntu | CodeQL, `pnpm audit --prod`, gitleaks, Electronegativity |

### `winrar-nightly.yml`

Matrix `{windows-latest, macos-latest (arm64), macos-15-intel (x64), ubuntu-latest, ubuntu-24.04-arm}`: full
integration + E2E + OS-integration scripts + performance benchmark. Failures open an issue.

### `winrar-7zip-watch.yml` (weekly cron)

Checks the latest 7-Zip release against `scripts/7zip-versions.json`. On a new version it opens a PR that
bumps URLs and hashes (hashes computed in CI and cross-checked against upstream-published checksums where
available). The PR is labelled `security` if the upstream changelog mentions a vulnerability.

### `winrar-release.yml` (release-please tag)

| Job | Runner | Output |
| --- | --- | --- |
| `win` | windows-latest | NSIS installer x64 + arm64 (per-user install by default, per-machine optional), signed with Azure Artifact Signing. The bundled `7z.exe`/`7z.dll` keep Igor Pavlov's original signatures if present; otherwise we sign them. |
| `mac` | macos-latest | DMG + ZIP (x64, arm64, or universal). `7zz` is signed with hardened runtime *before* the app bundle is signed. Notarized and stapled. |
| `linux` | ubuntu + ubuntu-arm | AppImage, deb, rpm (x64, arm64) |
| `publish` | ubuntu | Draft GitHub Release with artifacts, update manifests, SBOM, checksums, and the 7-Zip source tarball for the bundled version (LGPL compliance). A human publishes it. |

## 2. electron-builder specifics

```yaml
# app/electron-builder.yml (excerpt)
appId: com.georgekibe.winrarclone        # placeholder until rename
productName: WinrarClone
asar: true
asarUnpack: []                             # 7-Zip ships via extraResources, not inside asar
extraResources:
  - from: vendor/7zip/${platform}-${arch}
    to: 7zip
    filter: ["**/*"]
fileAssociations:
  - { ext: [rar, zip, 7z, tar, gz, tgz, bz2, tbz2, xz, txz, iso, cab, arj, lzh, cpio, wim, "001"], name: Archive, role: Viewer }
win:
  target: [{ target: nsis, arch: [x64, arm64] }]
nsis:
  oneClick: false
  perMachine: false
  allowElevation: true
  include: build/installer.nsh              # context menu registry keys (HKCU\Software\Classes\...)
mac:
  target: [{ target: dmg, arch: [x64, arm64] }, { target: zip, arch: [x64, arm64] }]
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  binaries: [Contents/Resources/7zip/7zz]   # signed individually
  notarize: true
linux:
  target: [AppImage, deb, rpm]
  category: Utility
  mimeTypes: [application/vnd.rar, application/zip, application/x-7z-compressed, application/x-tar, application/gzip, application/x-xz, application/x-bzip2, application/x-iso9660-image]
publish: { provider: github }
```

Build-time tasks: `@electron/fuses` flip, licenses generation, and a check that the 7-Zip binary exists
and runs (`7zz i`) for the target arch (cross-arch is checked via `file` headers).

## 3. Signing & notarization

| OS | Notes |
| --- | --- |
| Windows | Unsigned archive tools are frequently flagged by SmartScreen and AV. Signing is mandatory for public releases. |
| macOS | Every Mach-O inside the bundle (including `7zz`) must be signed with hardened runtime, or notarization fails. `7zz` needs no special entitlements. |
| Linux | SHA-256 checksums published. Optional GPG-signed apt/rpm repository later. |

## 4. Auto-update

electron-updater, GitHub provider, `latest`/`beta` channels, staged rollout percentages, and a "Restart to
update" prompt that is postponed while jobs are running (an update never interrupts an extraction).

## 5. Distribution channels (future, see requirements Q2/Q3)

- **winget** manifest PR on each release (automated with `wingetcreate`).
- **Homebrew cask** (`brew install --cask <name>`) via a tap.
- **Flathub** (needs a Flatpak manifest; portal-based file access limits "extract next to archive". Evaluate later).
- **Microsoft Store (MSIX):** would enable the Windows 11 modern context menu through a packaged COM extension.
