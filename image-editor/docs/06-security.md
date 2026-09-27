# 06 — Security, Privacy & Threat Model: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Related | [Architecture](02-architecture.md) · [SECURITY.md](../../SECURITY.md) · [ADR-0008](adr/0008-codec-host-utility-process.md) |

## 1. Assets & threats

| Asset | Threat |
| --- | --- |
| The user's machine | Code execution through a crafted image (decoder memory-safety bugs in libvips/libjpeg/libpng/libwebp/libtiff/libheif, or PSD/zip parser bugs) |
| The user's files | Arbitrary write via IPC abuse. Overwriting the original on export by accident. |
| Privacy | Leaking location via EXIF GPS on export. Images or AI inputs leaving the device. |
| Stability | Decompression bombs (a 1 KB PNG that declares 100,000 × 100,000). Huge PSDs. Zip bombs in `.iep`. |
| Update/model integrity | Malicious update or tampered AI model |

Adversary: anyone who can get the user to open an image (web download, email, chat). They fully control
file bytes and metadata.

Real-world context: libwebp CVE-2023-4863 (heap overflow, exploited in the wild through images), libtiff
and ImageMagick parser CVEs, and PSD parser crashes in many tools. **Image decoding is our main attack surface.**

## 2. Isolation design

```
               untrusted bytes
┌──────────┐   path only    ┌───────────────────────┐   RGBA pixels   ┌──────────────────────┐
│  Main    │──────────────▶│ codec-host             │───────────────▶│ Renderer (sandboxed)  │
│ (no image│  (MessagePort │ utilityProcess, sharp  │   (MessagePort) │ engine + workers      │
│  parsing)│   brokered)   │ no IPC to main except   │                 │ PSD/zip in workers    │
└──────────┘               │ status; restartable     │                 └──────────────────────┘
```

| Parser | Where | Containment |
| --- | --- | --- |
| PNG/JPEG/WebP/AVIF/GIF/TIFF/BMP (libvips via sharp) | codec-host `utilityProcess` | Separate OS process. A crash kills only codec-host, and main restarts it with backoff. It receives no user settings and holds no secrets. |
| PSD (ag-psd, pure JS) | Renderer worker | Memory-safe JS. Resource limits enforced (below). A worker crash or hang is terminated after a timeout. |
| `.iep` zip (fflate, pure JS) | Renderer worker | Memory-safe JS + limits ([05 §2.4](05-data-model.md#24-safety-limits-on-load)) |
| AI model (ONNX) | Renderer AI worker | Only loads hash-verified models from our pinned list |
| Clipboard images | Chromium's decoders (renderer, sandboxed) | Chromium sandbox |

**Future hardening:** Electron's `utilityProcess` does not run with Chromium's full sandbox when native
modules are loaded. For stronger containment we can later: (a) move common formats to browser-native
decoding (`createImageBitmap` in a worker, inside the Chromium sandbox) and keep sharp only for
ICC/TIFF/encode, or (b) apply OS sandboxing to codec-host (AppContainer / seatbelt / seccomp-bpf). This is
tracked for M5.

## 3. Resource limits (decompression bombs)

| Limit | Value | Enforcement |
| --- | --- | --- |
| Max input pixels | 400 MP (e.g. 20,000 × 20,000) | sharp `limitInputPixels` (checks header before decoding) |
| Max document size | 20,000 × 20,000 | Engine refuses larger ones and offers to downscale on import |
| PSD | Declared dimensions ≤ 20,000², layers ≤ 1,000, total declared channel bytes ≤ memory budget | Checked from headers before allocating |
| `.iep` | Same, plus zip entry size checks | [05 §2.4](05-data-model.md#24-safety-limits-on-load) |
| Worker timeouts | PSD parse 60 s, zip 60 s, AI 120 s | Terminated. The user sees an error with a retry option. |
| SVG | Not supported in v1 | (If added later: rasterize via librsvg in codec-host with external resource loading disabled.) |

## 4. Electron hardening

Same baseline as the other projects ([WhatsappClone §4](../../whatsapp-clone/docs/06-security.md#4-electron-hardening)),
with these specifics:

- The renderer loads from `app://editor/` (a privileged custom scheme), not `file://`. The protocol handler
  serves only files from the packaged app directory (asar), plus `app://models/*` from `<userData>/models`
  (with a name allowlist). It sets COOP/COEP (for cross-origin isolation) and CSP:
  `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  `wasm-unsafe-eval` is needed for onnxruntime-web WASM. `blob:` workers are for the ORT bundling pattern.
- Permission handler grants only: `local-fonts` (text tool), `clipboard-read` (paste, after a user
  gesture), `clipboard-sanitized-write`. Everything else is denied (camera, mic, geolocation…).
- Navigation and window.open are denied. Help links open in the external browser after an `https:` check.
- Fuses: `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`,
  `OnlyLoadAppFromAsar=true`, `EnableEmbeddedAsarIntegrityValidation=true`, `GrantFileProtocolExtraPrivileges=false`.
- IPC: refs instead of paths. `writeAtomic` only accepts refs created by a save dialog (or the document's
  own file ref for "Save"), so a compromised renderer cannot write arbitrary paths.
- Batch output directory is chosen through a dialog in main. codec-host validates that every output path
  is inside it (normalised, no symlink escape) before writing.

## 5. Privacy

- **No telemetry by default.** Opt-in crash reports scrub file paths, image data and EXIF.
- **Metadata on export:** default "Remove location (GPS)". "Remove all" strips EXIF/XMP/IPTC except the ICC
  profile and orientation-normalised pixels. The policy is shown in the export dialog every time.
- **AI stays local:** the model runs in-process. The only network call is the model download (which sends
  no image data), with explicit consent, and it can be avoided with the offline installer variant.
- Recent-file thumbnails and recovery snapshots stay in `<userData>`. "Clear recent" and
  "Discard recovery" are available. Uninstall can remove all user data.

## 6. Integrity: updates & models

- Code-signed builds. electron-updater verifies signatures and hashes.
- AI models: the URL, version, size and SHA-256 are pinned in `app/src/shared/models.json` (reviewed like
  code). Main downloads over HTTPS to a temp file, verifies the hash, then moves it into `models/`. The
  renderer loads models only via `app://models/` after a hash check at startup (cached).
- A model's license is recorded next to its hash. CI fails if a model's license is not in the allowlist
  (MIT, Apache-2.0, BSD-2/3-Clause).

## 7. Supply chain

- pnpm frozen lockfile, `onlyBuiltDependencies` (sharp, electron) for install scripts, Renovate, CodeQL,
  `pnpm audit`, gitleaks, SBOM per release, and Actions pinned by SHA.
- **sharp/libvips updates are security updates.** Track libvips CVEs and ship within 14 days of a critical
  fix in a bundled codec (for example a libwebp-class bug).

## 8. Security testing

| Activity | Frequency |
| --- | --- |
| Fuzzing: PSD and `.iep` readers (fast-check + a mutated corpus via Jazzer.js), codec-host decode of the mutated image corpus (crash = test failure) | Nightly (time-boxed), with a 1-minute smoke on PR |
| Limits tests: bomb PNG, huge-dimension JPEG header, zip bomb `.iep`, PSD with absurd layer counts | Every PR |
| IPC abuse tests: calling `writeAtomic`/`batch.run` with forged refs or paths is rejected | Every PR |
| Electronegativity, CodeQL, dependency audit | Every PR |
| External review of isolation + protocol handler | Before v1.0 |
