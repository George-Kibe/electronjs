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

### `image-editor-release.yml` (`image-editor-v*` tag; as built in §3.1)

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
publish: { provider: github, owner: George-Kibe, repo: electronjs, tagNamePrefix: image-editor-v, releaseType: draft }  # ADR-0010
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

**As built (M1 slice 6.6):** `main/services/updater.ts` (`UpdateService`, unit-tested with a fake backend) over
`electron-updater` (loaded on the first check). This repository releases several products, so the stock GitHub
provider cannot find ours. Before each check, `release-feed.ts` picks the newest `image-editor-v*` release for
the channel from the GitHub API, and electron-updater's generic provider reads that release's manifest
([ADR-0010](adr/0010-update-feed-in-a-monorepo.md)).
The first check runs 10 s after startup, then every 4 h; a found update downloads in the background
(`autoDownload`) and installs at the next normal quit (`autoInstallOnAppQuit`), i.e. after every
unsaved-changes prompt. A non-modal banner offers **Restart Now** (disabled, and refused by main, while any
window has unsaved changes) and **Later**. Help › Check for Updates (the app menu on macOS) and
Preferences › Updates show each step. The channel (Stable = `latest`, Beta = pre-releases) is
`updates.channel`; leaving beta never downgrades. Development builds and deb/rpm installs (no `APPIMAGE`)
report "unavailable" and never check: deb/rpm users update through their package manager. E2E scripts the
feed with `E2E_FAKE_UPDATE` (`none` by default in `e2e/app.ts`, so tests never contact GitHub).

### 3.1 Release workflow as built (`image-editor-release.yml`)

- **Trigger:** a pushed tag `image-editor-v<version>`. It must match `app/package.json`, or the build stops.
  Pull requests that change the workflow, `electron-builder.yml` or `scripts/check-packaged.mjs` run the
  same builds **unsigned** as a dry run and publish nothing.
- **Builds:** one job per OS, building every architecture.
  - Windows: one NSIS installer with x64 + arm64 inside, because electron-updater's Windows updater does
    not choose by architecture.
  - macOS: dmg + zip for x64 and arm64 in one run, so `latest-mac.yml` lists both zips (Squirrel.Mac
    installs from the zip).
  - Linux: AppImage, deb and rpm for x64 and arm64.
  - The install step writes a temporary `pnpm-workspace.yaml` with `supportedArchitectures`, so both
    architectures' sharp prebuilds are present. `scripts/check-packaged.mjs` then fails the job if any
    packaged app lacks `@img/sharp-<platform>-<arch>`. A packaged smoke test (decode a fixture, security
    baseline) runs on the native architecture.
- **Signing:** on tag builds only. Signing secrets are empty in every other run, so pull-request code never
  sees them, and a tag build without them fails.
  - Windows uses Azure Artifact Signing (`azureSignOptions`). The publisher name also goes into
    `app-update.yml`, so updates install only with the same publisher.
  - macOS uses a Developer ID certificate, hardened runtime and notarization with an App Store Connect API
    key.
  - Linux packages are not code-signed; `SHA256SUMS` is published.
- **Publish:** a separate job with `contents: write` downloads every build, writes `SHA256SUMS`, and creates
  (or adds to) a **draft** release for the tag. The draft holds the installers, update zips, blockmaps
  (differential updates) and `latest*.yml`. A maintainer publishes it after the release QA checklist
  (docs/07 §8). Updaters ignore drafts (ADR-0010), so nothing is offered before that.
- **Secrets and variables to configure:**

  | Name | Kind | Used for |
  | --- | --- | --- |
  | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | secret | Windows signing |
  | `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERTIFICATE_PROFILE`, `WIN_PUBLISHER_NAME` | variable | Windows signing |
  | `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD` | secret | macOS signing |
  | `APPLE_API_KEY` (.p8 contents), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | secret | macOS notarization |
  | `CRASH_REPORT_DSN` | secret | Opt-in crash reports (ADR-0009), baked in as `MAIN_VITE_CRASH_REPORT_DSN` |

- **Not yet:** release-please (tags are pushed by hand until it is set up), SBOM and license bundle,
  source-map upload to the crash-report project, staged rollout percentages (`stagingPercentage` is edited
  in the published `latest*.yml`), and the arm64 smoke tests (no native arm64 runner in the matrix yet).

## 4. Distribution (later)

winget, Homebrew cask, Flathub (the portal file chooser fits this app well), and possibly the Microsoft
Store (MSIX). Tracked in the roadmap.
