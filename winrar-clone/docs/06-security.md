# 06 — Security & Threat Model: WinrarClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Related | [Architecture](02-architecture.md) · [SECURITY.md](../../SECURITY.md) · [ADR-0003](adr/0003-staged-extraction-pipeline.md) |

## 1. Why this matters

Archive tools are a favourite attack vector. Real-world examples:
- **WinRAR CVE-2023-38831:** a crafted archive runs code when the user opens a benign-looking file.
- **WinRAR CVE-2025-8088:** path traversal via NTFS alternate data streams, used to drop files into Startup folders.
- **7-Zip CVE-2025-0411:** Mark-of-the-Web bypass through nested archives (fixed in 24.09).
- **7-Zip CVE-2025-11001/11002:** symlink handling allowed writing outside the destination (fixed in 25.00).
- The whole **Zip Slip** class (`../` entries), **zip bombs**, and malicious symlinks in tar archives.

Our input (archives) is **untrusted by definition**.

## 2. Assets, adversaries, boundaries

| Asset | Threat |
| --- | --- |
| User's filesystem outside the destination | Arbitrary file write → persistence or code execution (Startup folder, `~/.bashrc`, LaunchAgents) |
| Disk capacity / system stability | Decompression bombs, millions of tiny files |
| Windows SmartScreen / MotW protections | Bypass via extraction without propagation |
| Archive passwords | Leak via argv, logs, crash dumps |
| The app process | Renderer XSS through file names/comments → IPC abuse. Engine crash. |
| Update channel | Malicious update |

Adversary: anyone who can get a user to open an archive (email, download, USB). They fully control archive
bytes: names, headers, sizes, link targets, comments, nesting.

```
[Untrusted archive] → [7-Zip child process] → [Staging dir] → [Safety post-validation] → [Destination]
                               ▲                                                           
[Renderer shows names]  ← sanitized DTOs ← [Main: Engine parsers + Safety]
```

## 3. Electron hardening

The same baseline as WhatsappClone ([its §4](../../whatsapp-clone/docs/06-security.md#4-electron-hardening)),
tightened because this app needs no network in the renderer:

- `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`. Fuses: `RunAsNode=false`,
  `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`,
  `OnlyLoadAppFromAsar=true`, `EnableEmbeddedAsarIntegrityValidation=true`.
- CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' wrc-preview: data:; font-src 'self'; connect-src 'none'; frame-src wrc-preview:; object-src 'none'; base-uri 'none'; form-action 'none'`.
- Navigation and new windows are blocked. External links (only in About) open through `shell.openExternal`
  for `https:` only.
- **File names and archive comments are untrusted text.** They are rendered as React text nodes only. Bidi
  override characters (U+202A–202E, U+2066–2069) are shown visibly (for example `‮` → `⟨RLO⟩`) so that
  `invoice‮fdp.exe` cannot pose as a `.pdf`.
- **Preview:** `wrc-preview://` serves only files that main created for a preview token. Text previews are
  rendered as text. PDFs open in Chromium's viewer inside a sandboxed `<iframe>`. SVG is rendered as `<img>`
  (no script). HTML files preview as source text, never rendered.
- IPC: sender check + zod + refs instead of paths ([04 §1](04-ipc-engine-contract.md#1-renderer--main-ipc)).

## 4. Extraction safety controls

### 4.1 Pre-validation (from the listing, before 7-Zip writes anything)

For each entry, `safety/paths.ts` computes the target path and blocks it if:

| Check | Rule |
| --- | --- |
| Absolute | Starts with `/`, `\`, a drive letter (`C:`), UNC (`\\server`), or `\\?\` / `\\.\` device prefixes |
| Traversal | Any segment equals `..` after normalizing both `/` and `\` separators |
| ADS | Contains `:` in any segment on Windows (alternate data streams, the CVE-2025-8088 class) |
| Reserved names | `CON, PRN, AUX, NUL, COM1–9, LPT1–9` (any extension, case-insensitive): renamed with a `_` suffix |
| Trailing dot/space | Windows: trimmed with a rename (Win32 would silently alias names otherwise) |
| Invalid chars | `<>:"|?*` and control chars on Windows: replaced with `_`. NUL on all platforms: blocked. |
| Length | Full path > 32,000 chars (Windows long-path), or segment > 255 bytes: blocked |
| Resolve check | `path.resolve(dest, entry)` must start with `dest + sep` (case-insensitive on Windows/macOS) |
| Device/special files | Tar char/block devices and FIFOs: blocked |
| Hard links | Blocked by default (target must also be inside dest when allowed) |

Only allowed entries are written into the `-i@listfile` include list. `-spd` ensures they match literally.

### 4.2 Post-validation (after extraction into staging)

- Walk the staging dir with `lstat` (never following links). Any symlink/junction/reparse point is checked
  against the policy. Anything whose `realpath` is outside staging is deleted and reported.
- Files that 7-Zip created but that are not in the allowed list are deleted and reported (defence against
  engine-level bugs).
- Permission bits are masked with `& 0o777 & ~0o6000` (clear setuid/setgid). Ownership is never changed.
- Only then does JobManager move entries into the destination.

### 4.3 Symlinks & hard links

| Policy (setting) | Behaviour |
| --- | --- |
| `skip` (default) | Link entries are excluded from extraction and listed in the report |
| `asText` | Written as a regular file whose content is the link target (the WinRAR/7-Zip Windows behaviour) |
| `allowInside` | Created as a link only if the target resolves inside the destination **and** no later entry in the archive writes through it (link entries are extracted last, after all regular files) |

On Windows, symlink creation needs Developer Mode or admin rights. We never request elevation for it.

### 4.4 Decompression bombs & resource exhaustion

- Before extraction: `Σ size(allowed)` is compared against `statfs(dest).bavail * bsize − reserve (1 GB)`.
  If it doesn't fit, the job is blocked (the user must free space or choose another destination).
- If the ratio `Σ size / archive physical size > 100` **and** `Σ size > 1 GB`, a confirmation is required.
- During extraction: a watchdog polls the staging size and free space every second. The job aborts if bytes
  written exceed `1.1 × declared` (headers lied) or free space drops below the reserve.
- Entry count > 1,000,000: confirmation required.
- Nested archives are never auto-extracted recursively. Opening a nested archive from the browser is a
  separate, explicit action and job.

### 4.5 Mark-of-the-Web (Windows)

- `-snz` is always passed on Windows, so 7-Zip copies the archive's `Zone.Identifier` ADS to extracted files.
- Files moved from staging keep their ADS (same-volume `rename` keeps streams; the cross-volume copy
  fallback copies the `Zone.Identifier` stream explicitly).
- Nested archives opened from the browser are extracted to temp **with** MotW, which closes the
  CVE-2025-0411-style gap.
- macOS: extracted files inherit `com.apple.quarantine` from the archive through an explicit `xattr` copy
  in finalize, so Gatekeeper still checks downloaded apps. Linux has no equivalent.

### 4.6 Dangerous files

- The extension list (FR-SAFE-05) is flagged in the UI. Opening one from inside an archive needs explicit
  confirmation, and the file is extracted to temp with MotW/quarantine first.
- We never auto-open or auto-run anything after extraction. "Open folder when done" opens the folder only.
- Double extensions (`photo.jpg.exe`) and bidi tricks are highlighted.

## 5. Secrets & passwords

- Passwords are held in main-process memory only, in JS strings (which cannot be reliably zeroed; this is
  an accepted limitation, documented). They are dropped when the session or job ends. "Remember for this
  session" is at most until app exit. Passwords are never written to disk, settings, reports or logs.
- Passwords are passed to 7-Zip through stdin where possible ([04 §2.3](04-ipc-engine-contract.md#23-password-handling)).
  If `-p` must be used on some OS, the exposure window is one short-lived child process. On Linux the risk
  (other local users reading `/proc/<pid>/cmdline`) is documented in the Help page.
- Crash reports (opt-in) exclude process arguments and scrub anything that looks like a path or password.

## 6. Future hardening

- Run 7-Zip with reduced privileges. On Windows, use a restricted token or AppContainer through a small
  native launcher. On macOS, use `sandbox-exec` profiles (deprecated but functional) or an XPC helper. On
  Linux, use `bwrap`/Landlock when available, restricting writes to staging only.
- Fuzz the parsers (listing and progress) with random and mutated 7-Zip output.

## 7. Supply chain & update integrity

- 7-Zip binaries are downloaded at build time from the official site/GitHub releases, verified against
  SHA-256 hashes pinned in `scripts/7zip-versions.json`, and never committed. On macOS the bundled binary is
  re-signed with our Developer ID.
- pnpm frozen lockfile, Renovate, CodeQL, `pnpm audit`, gitleaks, SBOM per release, and Actions pinned by SHA.
- Updates are signed (Authenticode / Developer ID). electron-updater verifies them.
- A 7-Zip upstream security release triggers our release within 14 days (NFR-SEC-02). A GitHub Action watches
  the 7-Zip releases feed and opens an issue.

## 8. Security test requirements

Every rule above has at least one malicious fixture in `test/fixtures/malicious/` (see
[Testing §3](07-testing-strategy.md#3-fixture-corpus)) and an E2E test asserting that nothing is written
outside a sandboxed destination. The test harness takes a snapshot of the parent directory before and after,
and any diff outside the destination fails the test.
