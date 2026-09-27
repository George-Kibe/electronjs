# 01 — Requirements (PRD): WinrarClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Owner | George Kibe |
| Last updated | 2026-09-27 |
| Related | [Architecture](02-architecture.md) · [Roadmap](10-roadmap.md) |

## 1. Purpose & vision

A modern, free, cross-platform archive manager that feels as capable as WinRAR/7-Zip File Manager, looks
like a 2026 desktop app, and is **safe by default** against malicious archives.

### 1.1 Goals

- G1: Open and extract every archive format a typical user meets, RAR5 included, in two clicks or fewer.
- G2: Extraction is as fast as the raw 7-Zip CLI (≤ 5 % overhead).
- G3: A malicious archive cannot write outside the chosen folder, fill the disk unnoticed, or bypass
  Windows Mark-of-the-Web.
- G4: Deep OS integration: right-click "Extract here", double-click to open, drag and drop in and out.
- G5: Same features and look on Windows, macOS and Linux.

### 1.2 Non-goals

- Creating `.rar` archives (proprietary algorithm, license restriction).
- Repairing damaged RAR archives (needs RAR recovery records and WinRAR's tooling).
- Cloud storage integration, archive encryption key management, or an enterprise deployment console (v1).
- Mobile apps.

## 2. Personas

| Persona | Needs |
| --- | --- |
| **Eva — casual user** | Double-clicks a downloaded `.rar` and gets the files. Doesn't want to learn options. |
| **Felix — power user** | Batch-extracts 40 multi-part archives, creates encrypted 7z backups with split volumes, uses keyboard shortcuts |
| **Grace — IT-security aware** | Trusts that unknown archives can't hurt her. Wants MotW preserved and dangerous files flagged. |

## 3. Functional requirements

Priority: MoSCoW. Milestones: see [Roadmap](10-roadmap.md).

### 3.1 Open & browse (BRW)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-BRW-01 | Open an archive via file dialog, drag and drop onto the window or dock icon, double-click (file association), or CLI argument. | M | M1 |
| FR-BRW-02 | Detect the format by content (7-Zip signature detection), not only by extension. | M | M1 |
| FR-BRW-03 | Show contents as a navigable folder tree plus a file list: name, size, packed size, ratio, modified, CRC, attributes, encrypted flag. Columns can be sorted. | M | M1 |
| FR-BRW-04 | Archive info panel: format, method, solid, volumes, total/packed size, file/folder count, encrypted headers, comment. | M | M1 |
| FR-BRW-05 | Search/filter inside the archive by name (glob and substring). | S | M1 |
| FR-BRW-06 | Quick preview of a selected entry without full extraction: images, text/code (syntax highlighting, ≤ 5 MB), PDF (≤ 20 MB, Chromium viewer). | S | M2 |
| FR-BRW-07 | Nested archives: double-clicking an archive inside an archive opens it (extracted to temp). | S | M2 |
| FR-BRW-08 | Open archives with encrypted headers (7z `-mhe`, RAR `-hp`) by asking for the password before listing. | M | M1 |
| FR-BRW-09 | Handle archives with 1,000,000 entries without freezing the UI (virtualized list, streamed parsing). | M | M1 |

### 3.2 Extract (EXT)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-EXT-01 | Supported extraction formats: RAR (v1.5–v5), ZIP (incl. ZIP64, AES), 7z, TAR, GZIP, BZIP2, XZ, LZMA, Z, CAB, ISO, UDF, ARJ, LZH, CPIO, RPM, DEB/AR, WIM, DMG (read), MSI, CHM. That is, everything the bundled 7-Zip can unpack. | M | M1 |
| FR-EXT-02 | **Extract here (smart):** if the archive has a single top-level folder, extract here. Otherwise extract into a new folder named after the archive. | M | M1 |
| FR-EXT-03 | **Extract to…** a chosen folder, with options: overwrite mode (ask / overwrite / skip / rename new / rename existing), keep or flatten paths, and "open folder when done". | M | M1 |
| FR-EXT-04 | Extract selected entries only (from the browser), including by drag-out to the OS file manager. | M | M2 |
| FR-EXT-05 | Multi-volume archives: `.part1.rar…partN.rar`, `.rar/.r00…`, `.7z.001…`, `.zip/.z01…`. Opening any volume resolves the first one. A missing volume gives a clear error naming the file. | M | M1 |
| FR-EXT-06 | Password-protected archives: prompt for the password (with show/hide). A wrong password gives a clear error and lets the user retry. Optional per-session password memory (in-memory only). | M | M1 |
| FR-EXT-07 | Batch extract: select N archives → extract each (smart or into sibling folders) as a queued job with overall progress. Multi-volume sets are handled once. | M | M2 |
| FR-EXT-08 | Progress: percentage, current file, bytes processed, speed, ETA. Pause is not required. Cancel removes partial output (staging dir). | M | M1 |
| FR-EXT-09 | Preserve timestamps. Preserve permissions on macOS/Linux, minus setuid/setgid bits. | M | M1 |
| FR-EXT-10 | Error report at the end: list of files with CRC errors, unsupported methods or skipped entries, with "Copy report". | M | M1 |
| FR-EXT-11 | Delete the archive after successful extraction (opt-in; moves it to the Trash/Recycle Bin, never a permanent delete). | C | M3 |

### 3.3 Create (CRT)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-CRT-01 | Create archives from selected files/folders in these formats: ZIP, 7z, TAR, TAR.GZ, TAR.XZ, TAR.BZ2. | M | M2 |
| FR-CRT-02 | Compression levels: Store, Fastest, Fast, Normal, Maximum, Ultra (mapped to `-mx0..9`). | M | M2 |
| FR-CRT-03 | Encryption: AES-256 for ZIP and 7z. 7z has an optional "Encrypt file names" (`-mhe=on`). A password strength meter is shown. ZipCrypto is never used. | M | M2 |
| FR-CRT-04 | Split into volumes: presets (100 MB, 700 MB, 4092 MB FAT32, custom). | S | M2 |
| FR-CRT-05 | Solid archive option (7z). Multithreading follows CPU count. | S | M2 |
| FR-CRT-06 | Quick compress: right-click → "Add to <name>.zip" / "Add to <name>.7z" with defaults, no dialog. | M | M3 |
| FR-CRT-07 | Exclude patterns (e.g. `.DS_Store`, `Thumbs.db`, `node_modules/`) with sensible defaults. | S | M2 |
| FR-CRT-08 | Add or delete files in an existing ZIP/7z (`a` / `d`) from the browser. | C | M4 |
| FR-CRT-09 | Convert an archive to another format (extract to temp → re-create). | C | M4 |
| FR-CRT-10 | Save option presets as profiles. | C | M4 |

### 3.4 Test & verify (TST)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-TST-01 | Test archive integrity (`7z t`) and show the result per file. | M | M1 |
| FR-TST-02 | Show the CRC/hash of entries. Compute SHA-256 of the archive file on demand. | S | M2 |

### 3.5 Desktop & OS integration (INT)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-INT-01 | File associations for supported archive extensions, registered as an "Open with" handler. The app never forcibly takes over the default. | M | M1 |
| FR-INT-02 | Context menu on archives: "Extract here", "Extract to <archive-name>/", "Open with WinrarClone". On any files: "Add to archive…", "Add to <name>.zip", "Add to <name>.7z". | M | M3 |
| FR-INT-03 | Context menu integration can be turned on/off in Settings (and per OS details, see [09](09-platform-integration.md)). | M | M3 |
| FR-INT-04 | CLI: `winrarclone x|e|a|t|open …` for scripting, with exit codes (see [04 §4](04-ipc-engine-contract.md#4-command-line-interface)). | S | M3 |
| FR-INT-05 | Single instance: invocations from multiple selected files are batched into one job queue window. | M | M1 |
| FR-INT-06 | Drag out of the archive browser into Explorer/Finder/Files. | S | M2 |
| FR-INT-07 | Taskbar/dock progress bar and a notification when a long job (> 10 s) completes in the background. | S | M1 |
| FR-INT-08 | Recent archives list (jump list on Windows, dock menu on macOS). | C | M3 |
| FR-INT-09 | Auto-update with a signed update and a user prompt. | M | M1 |

### 3.6 Safety (SAFE)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-SAFE-01 | Block entries whose resolved path is outside the destination (absolute paths, `..`, drive letters, UNC, device names). Report them as skipped. | M | M1 |
| FR-SAFE-02 | Symlinks/junctions: never create a link that points outside the destination. Default policy: skip links (or extract as plain files containing the target text, configurable). | M | M1 |
| FR-SAFE-03 | Decompression bomb guard: warn before extracting if total unpacked > free disk space − 1 GB, or ratio > 100:1 with unpacked > 1 GB. Abort if actual output exceeds declared size by > 10 % or free space drops below the reserve. | M | M1 |
| FR-SAFE-04 | Windows: propagate Mark-of-the-Web (`Zone.Identifier`) from the archive to extracted files (7-Zip `-snz`). This is on by default and cannot be turned off in the UI (registry policy only). | M | M1 |
| FR-SAFE-05 | Flag dangerous file types (`.exe .msi .bat .cmd .ps1 .vbs .js .jar .scr .lnk .app .command .sh …`) in the browser. Opening one from inside an archive shows a confirmation. | M | M2 |
| FR-SAFE-06 | Strip setuid/setgid/sticky bits. Never preserve ownership (uid/gid) as a non-root user. | M | M1 |
| FR-SAFE-07 | Windows reserved names (`CON`, `NUL`, `COM1`, …), trailing dots/spaces and invalid characters are sanitized with a rename, and each rename is reported. | M | M1 |
| FR-SAFE-08 | Case-insensitive collision handling on Windows/macOS (e.g. `A.txt` and `a.txt`) follows the overwrite mode, with a warning. | S | M2 |

### 3.7 General (GEN)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-GEN-01 | Light/dark/system theme. | M | M1 |
| FR-GEN-02 | Settings: default extract mode, default destination, overwrite mode, context-menu items, file associations, temp folder, language, update channel. | M | M1 |
| FR-GEN-03 | i18n-ready. English at launch, Swahili next. | S | M4 |
| FR-GEN-04 | About → Licenses screen with third-party licenses, including 7-Zip. | M | M1 |
| FR-GEN-05 | Telemetry is **off** by default. Opt-in crash reports only. No file names are ever sent. | M | M1 |

## 4. Non-functional requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-PERF-01 | Performance | Extraction throughput ≥ 95 % of running the bundled 7-Zip CLI directly on the same archive. |
| NFR-PERF-02 | Performance | Listing a 100k-entry archive shows the first rows in < 1 s and the full listing in < 5 s. The UI never blocks for more than 50 ms. |
| NFR-PERF-03 | Performance | Cold start to window < 1.5 s. "Extract here" from the context menu starts in < 1 s when the app is already running. |
| NFR-PERF-04 | Performance | Idle memory < 200 MB. |
| NFR-REL-01 | Reliability | A cancelled or failed job leaves no partial files in the destination (staging + atomic move). |
| NFR-REL-02 | Reliability | Crash-free sessions ≥ 99.8 %. A crash of the 7-Zip child never crashes the app. |
| NFR-REL-03 | Reliability | Startup cleans up orphaned staging and temp dirs from previous crashes. |
| NFR-SEC-01 | Security | Electron hardening baseline ([Security §3](06-security.md#3-electron-hardening)). The app never loads remote content. |
| NFR-SEC-02 | Security | Bundled 7-Zip ≥ 25.01 (includes the fixes for CVE-2025-0411, CVE-2025-11001 and CVE-2025-11002). It is updated within 14 days of any 7-Zip security release. |
| NFR-SEC-03 | Security | The app works without network access. It only reaches the network for update checks. |
| NFR-UX-01 | Accessibility | WCAG 2.2 AA. Every function is reachable by keyboard. Screen-reader labels throughout. |
| NFR-COMP-01 | Compatibility | Windows 10 22H2+/11 (x64, arm64). macOS 12+ (x64, arm64). Ubuntu 22.04+, Fedora 40+, Debian 12+ (x64, arm64). |
| NFR-COMP-02 | Compatibility | Unicode file names in all scripts, including legacy ZIPs with OEM code pages (auto-detect with a manual override). |
| NFR-SIZE-01 | Size | Installer < 110 MB per OS/arch. |
| NFR-MAINT-01 | Maintainability | Coverage: ≥ 90 % for `safety/` and `engine/` parsers, ≥ 75 % for main overall. |

## 5. Key user stories & acceptance criteria

**US-01 Double-click a RAR (FR-BRW-01, FR-EXT-02)**
- *Given* WinrarClone is registered for `.rar`, *when* Eva double-clicks `photos.rar`, *then* the browser
  opens within 1.5 s and shows the contents, with "Extract here" and "Extract to…" as primary buttons.

**US-02 Multi-part, password-protected (FR-EXT-05/06)**
- *Given* `movie.part1.rar … part5.rar` with a password, *when* Felix opens `part3.rar`, *then* the app opens
  the set from `part1`, asks for the password once, and extracts to `movie/`. If `part4` is missing, the
  error names `movie.part4.rar`.

**US-03 Malicious archive (FR-SAFE-01..03)**
- *Given* an archive with the entries `../../evil.sh`, `/etc/passwd`, and a symlink `link -> /Users/grace`
  followed by `link/.zshrc`, *when* Grace extracts it, *then* no file is written outside the destination, the
  report lists 3 blocked entries with reasons, and the other files are extracted.

**US-04 Right-click compress (FR-CRT-06)**
- *Given* 3 selected files in Explorer, *when* the user chooses "Add to Documents.zip", *then* one archive is
  created (not 3), with a progress notification, and a failure leaves no partial `.zip`.

## 6. Constraints & assumptions

- 7-Zip is used as an external process. We depend on its CLI output format, so parsers are pinned to the
  bundled version and covered by fixtures.
- On Windows 11, the classic context menu (registry verbs) appears under "Show more options". Top-level
  modern menu integration needs a packaged COM `IExplorerCommand` extension (future, see [09](09-platform-integration.md)).
- macOS Finder context menus need either Quick Actions (Automator/Shortcuts) or a Finder Sync app
  extension written in Swift (future).

## 7. Open questions

| # | Question | Due |
| --- | --- | --- |
| Q1 | Final product name, app ID, icon | Before M1 release |
| Q2 | Microsoft Store (MSIX) distribution in addition to NSIS? | M3 |
| Q3 | Mac App Store? The sandbox limits spawning bundled binaries and writing next to archives, so we expect "no". | M3 |
| Q4 | Offer an SFX (self-extracting .exe) creation feature? It carries malware-association risk. | M4 |
