# 08 — CI/CD & Release: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

This project follows the repository-wide conventions ([WhatsappClone CI/CD](../../whatsapp-clone/docs/08-ci-cd-release.md)
has the full description): trunk-based development, Conventional Commits with scope `image-editor`,
release-please component `image-editor` (tags `image-editor-vX.Y.Z`), GitHub environments for signing
secrets, and Actions pinned by SHA. Only the differences are listed here.

## 1. Workflows (`.github/workflows/`, `paths: image-editor/**`)

### `image-editor-ci.yml` (PR, push to main)

| Job | Runner | Steps |
| --- | --- | --- |
| `check` | ubuntu | install → lint → typecheck → unit (engine, CPU references, codec-host) → coverage gates |
| `gpu-conformance` | ubuntu + xvfb | Vitest browser mode with Chromium/SwiftShader: shader vs CPU reference |
| `golden-core` | ubuntu + xvfb | Build app → golden core set. Diffs uploaded as an artifact on failure. |
| `e2e-smoke` | ubuntu + xvfb | Playwright `_electron`, journeys 1–3 |
| `fuzz-smoke` | ubuntu | 60 s per fuzz target |
| `security` | ubuntu | CodeQL, `pnpm audit --prod`, gitleaks, Electronegativity, model-license check |

### `image-editor-nightly.yml`

Full golden set, E2E on `{windows-latest, macos-latest, macos-15-intel, ubuntu-latest, ubuntu-24.04-arm}`,
fuzzing for 30 min, the benchmark suite (results pushed to a `bench-history` branch as JSON and charted),
and memory soak tests. Failures open an issue.

### `image-editor-update-goldens.yml` (manual dispatch)

Regenerates the golden baselines in CI and opens a PR that shows before/after/diff images in the PR body,
for human visual review. This is the **only** way baselines change.

### `image-editor-release.yml` (release-please tag)

| Job | Output |
| --- | --- |
| `win` | NSIS x64 + arm64, signed with Azure Artifact Signing. sharp's prebuilt `@img/sharp-win32-*` is included for the target arch. |
| `mac` | DMG + ZIP for x64 and arm64 (separate builds, because sharp prebuilds are per-arch; no universal build), hardened runtime, `libvips-cpp` dylibs signed, notarized, stapled |
| `linux` | AppImage, deb, rpm for x64 and arm64 |
| `offline-variant` | (M4+) Same installers with the AI model under `resources/models/`, marked `-offline` |
| `publish` | Draft GitHub Release + update manifests + SBOM + checksums + license bundle |

## 2. electron-builder specifics

```yaml
# app/electron-builder.yml (excerpt)
appId: com.georgekibe.imageeditor           # placeholder until rename
productName: ImageEditor
asar: true
asarUnpack:
  - "**/node_modules/sharp/**"
  - "**/node_modules/@img/**"               # native libvips binaries must live outside asar
fileAssociations:
  - { ext: iep, name: ImageEditor Project, role: Editor, icon: build/iep-doc, mimeType: application/x-imageeditor-project }
  - { ext: [png, jpg, jpeg, webp, avif, gif, bmp, tif, tiff, psd], name: Image, role: Editor, rank: Alternate }
mac:
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist   # no JIT entitlement needed beyond Electron's defaults
  target: [{ target: dmg, arch: [x64, arm64] }, { target: zip, arch: [x64, arm64] }]
win:
  target: [{ target: nsis, arch: [x64, arm64] }]
linux:
  target: [AppImage, deb, rpm]
  category: Graphics
  mimeTypes: [application/x-imageeditor-project, image/png, image/jpeg, image/webp, image/avif, image/gif, image/bmp, image/tiff, image/vnd.adobe.photoshop]
publish: { provider: github }
```

Installing sharp for each target platform and arch uses `pnpm install --config.supportedArchitectures`
(os/cpu/libc lists) so that cross-arch builds get the right `@img/sharp-*` package. The CI verifies that
codec-host starts and decodes a fixture in the **packaged** app (post-package smoke test) on every OS and arch.

## 3. Auto-update

Same as the other projects (electron-updater, latest/beta channels, staged rollout). Additionally:
- An update is never installed while documents have unsaved changes. The prompt says "Save your work to
  restart", and the update is applied on the next quit.
- AI models are **not** part of app updates. They update independently through `models.json`, when a new
  app version pins a new model hash.

## 4. Distribution (later)

winget, Homebrew cask, Flathub (the portal file chooser fits this app well), and possibly the Microsoft
Store (MSIX). Tracked in the roadmap.
