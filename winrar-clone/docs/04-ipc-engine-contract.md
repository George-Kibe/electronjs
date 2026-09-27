# 04 — IPC & Engine Contract: WinrarClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Source of truth | `app/src/shared/ipc-contract.ts` + `schemas.ts` (zod). If this doc disagrees with the schemas, the schemas win. |

## 1. Renderer ↔ main IPC

### 1.1 Principles

- `ipcRenderer.invoke` / `ipcMain.handle` for request/response. `webContents.send` for events.
- One channel per operation, named `domain.action`. Every request and response is zod-validated. Handlers
  check `event.senderFrame` origin.
- The renderer references files through **refs** (opaque IDs) that main issues when the user picks files via
  dialog, drop, or CLI. It never sends arbitrary paths.
  - Exception: drag-drop uses `webUtils.getPathForFile(file)` in **preload**, which immediately registers the
    path with main and returns a ref.

### 1.2 `window.api` surface

```ts
interface Api {
  app: {
    getInfo(): Promise<{ version: string; sevenZipVersion: string; platform: NodeJS.Platform; arch: string }>;
    getLaunchIntent(): Promise<LaunchIntent | null>;           // from CLI / file association
  };
  dialog: {
    openArchive(): Promise<FileRef | null>;
    pickFiles(opts: { folders: boolean; multiple: boolean }): Promise<FileRef[]>;
    pickDestination(defaultRef?: FileRef): Promise<FileRef | null>;
    saveArchiveAs(suggestedName: string, dirRef?: FileRef): Promise<FileRef | null>;
  };
  files: {
    registerDropped(paths: string[]): Promise<FileRef[]>;       // called by preload only
    reveal(ref: FileRef): Promise<void>;                        // show in Explorer/Finder
  };
  archive: {
    open(ref: FileRef, password?: string): Promise<ArchiveSession>;     // lists + indexes in main
    list(q: { sessionId: string; folder: string; sort: SortSpec; offset: number; limit: number; filter?: string })
      : Promise<{ total: number; entries: EntryDTO[] }>;
    info(sessionId: string): Promise<ArchiveInfo>;
    preview(sessionId: string, entryPath: string): Promise<{ url: string; kind: 'image'|'text'|'pdf'|'none'; truncated: boolean }>;
    prepareDrag(sessionId: string, entryPaths: string[]): Promise<{ jobId: string }>; // then main calls startDrag
    close(sessionId: string): Promise<void>;
  };
  jobs: {
    extract(req: ExtractRequest): Promise<{ jobId: string }>;
    create(req: CreateRequest): Promise<{ jobId: string }>;
    test(req: { archive: FileRef; password?: string }): Promise<{ jobId: string }>;
    confirm(jobId: string): Promise<void>;
    providePassword(jobId: string, password: string): Promise<void>;
    cancel(jobId: string): Promise<void>;
    list(): Promise<JobDTO[]>;
    report(jobId: string): Promise<JobReport>;
    clearFinished(): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
    setContextMenuEnabled(items: ContextMenuItem[]): Promise<{ ok: boolean; needsElevation?: boolean }>;
  };
  on(event: 'job.updated', cb: (job: JobDTO) => void): Unsubscribe;
  on(event: 'job.progress', cb: (p: JobProgress) => void): Unsubscribe;   // throttled ≤ 10/s per job
  on(event: 'launch.intent', cb: (i: LaunchIntent) => void): Unsubscribe; // second-instance forwarding
  on(event: 'update.available' | 'update.downloaded', cb: (info: UpdateInfo) => void): Unsubscribe;
}
```

### 1.3 Key DTOs

```ts
type FileRef = { id: string; displayName: string; displayDir: string; kind: 'file'|'dir' };

type ExtractRequest = {
  archive: FileRef;
  mode: 'smart' | 'here' | 'to';
  destination?: FileRef;                     // required for 'to'
  entries?: string[];                        // subset (archive-internal paths); omit = all
  overwrite: 'ask' | 'overwrite' | 'skip' | 'renameNew' | 'renameExisting';
  paths: 'full' | 'none';
  password?: string;
  openWhenDone: boolean;
};

type CreateRequest = {
  sources: FileRef[];
  output: FileRef;                           // from saveArchiveAs
  format: 'zip' | '7z' | 'tar' | 'tar.gz' | 'tar.xz' | 'tar.bz2';
  level: 0 | 1 | 3 | 5 | 7 | 9;
  password?: string;
  encryptHeaders?: boolean;                  // 7z only
  volumeSizeBytes?: number;
  solid?: boolean;
  excludes: string[];
  storeSymlinks: boolean;
};

type JobState = 'queued'|'listing'|'needsPassword'|'validating'|'awaitingConfirmation'
              |'extracting'|'compressing'|'testing'|'finalizing'
              |'completed'|'completedWithWarnings'|'failed'|'cancelled';

type JobProgress = { jobId: string; percent: number; bytesDone?: number; bytesTotal?: number;
                     currentEntry?: string; speedBps?: number; etaSec?: number };

type JobReport = { extracted: number; skipped: number; renamed: Array<{from: string; to: string}>;
                   blocked: Array<{ entry: string; reason: BlockReason }>;
                   errors: Array<{ entry?: string; code: EngineErrorCode; message: string }>;
                   destination?: string };

type BlockReason = 'ABSOLUTE_PATH'|'PARENT_TRAVERSAL'|'SYMLINK_ESCAPE'|'HARDLINK'|'DEVICE_FILE'
                 |'RESERVED_NAME'|'TOO_LONG'|'INVALID_CHARS';
```

## 2. 7-Zip engine contract

### 2.1 Binary resolution

| Platform | Binary | Location in packaged app |
| --- | --- | --- |
| Windows x64/arm64 | `7z.exe` + `7z.dll` (full build, with RAR support), unpacked from the official `7z<ver>-<arch>.exe` | `resources/7zip/` |
| macOS x64/arm64 | `7zz` (universal build from the official `-mac.tar.xz`, signed with our Developer ID) | `Contents/Resources/7zip/` |
| Linux x64/arm64 | `7zzs` (the static build) from the official `-linux-<arch>.tar.xz`, shipped as `7zz` | `resources/7zip/` |

In development the binary lives in `app/vendor/7zip/<platform>-<arch>/`, fetched by `scripts/fetch-7zip.ts`
from the pinned URLs and SHA-256 hashes in `scripts/7zip-versions.json` (official SourceForge mirror first,
then 7-zip.org).

`7za` / `7zr` must **not** be used: they lack RAR support. At startup, `7z i` checks that the RAR codec is
present and reports the version shown on the About screen.

### 2.2 Commands used

Global switches on every call: `-sccUTF-8 -scsUTF-8 -bb1 -bse2 -bsp1 -y` (UTF-8 I/O, log level for
per-file output, stderr for errors, progress to stdout, assume Yes for prompts we handle ourselves).
`--` always precedes path arguments.

| Operation | Command |
| --- | --- |
| List (technical) | `7zz l -slt -ba [-p…] -- <archive>` |
| Info | `7zz l -slt [-p…] -- <archive>` (header block before entries has archive props) |
| Extract full paths | `7zz x -o<staging> -spd -snz -aoa -i@<listfile> [-p…] -- <archive>` (`-aoa`: overwrite inside empty staging only; collisions with the real destination are resolved by JobManager) |
| Extract single to stdout (preview) | `7zz e -so -spd [-p…] -- <archive> <entryPath>` |
| Test | `7zz t [-p…] -- <archive>` |
| Create zip | `7zz a -tzip -mx=<l> [-mem=AES256 -p…] [-v<n>b] -xr!<excl>… -- <out.partial> <sources…>` |
| Create 7z | `7zz a -t7z -mx=<l> [-ms=on|off] [-mhe=on] [-p…] [-v<n>b] -xr!<excl>… -- <out.partial> <sources…>` |
| Create tar.* | `7zz a -ttar -so -- <sources…> \| 7zz a -si -t<gzip|xz|bzip2> -mx=<l> -- <out.partial>` |

`-snz` (Windows only) propagates Zone.Identifier (FR-SAFE-04). `-snl` is **never** passed on extraction.
Symlinks are handled according to the policy in [Security §4.3](06-security.md#43-symlinks--hard-links).

### 2.3 Password handling

**Goal:** never put the password on the command line, because `/proc/<pid>/cmdline` is world-readable on
many Linux systems and command lines are visible to same-user processes on Windows and macOS.

- **Implemented:** never pass `-p`. 7-Zip prints `Enter password:` **on stdout** (the `-bso` stream) with
  no trailing newline and reads one line from stdin. `engine/spawn.ts` matches that exact line (a whole-line
  match, so an entry named "Enter password:" cannot trigger it), then writes `password + "\n"`. Without a
  password it asks the caller (`onPasswordPrompt`). A declined prompt stops the process and maps to
  `PASSWORD_REQUIRED`.
- **Spike result (M0, 7-Zip 26.03, Linux x64):** stdin entry works for `l`, `t` and `x`, for 7z with
  encrypted headers and for AES ZIP. A wrong password exits with code 2 and prints `ERROR: Wrong password : <entry>`
  (data) or `Cannot open encrypted archive. Wrong password?` (headers). **If stdin reaches EOF at the
  prompt, 7-Zip prints "Break signaled" and exits with 255, the same as a user cancel.** That's why the engine
  must detect the prompt rather than infer "password required" from the exit code. Windows and macOS are
  verified by the `winrar-ci` matrix (`engine.test.ts`).
- Archives with encrypted headers can't be listed without a password. The engine detects the prompt during
  `list`, and the renderer shows the password dialog and re-opens with the password. Archives with only
  encrypted *data* list without a prompt, and the password is needed only at extract or test time.

### 2.4 Output parsing

- **Listing (`-slt -ba`):** blocks of `Key = Value` lines separated by blank lines. Keys used: `Path`,
  `Folder`, `Size`, `Packed Size`, `Modified`, `Created`, `Attributes`, `CRC`, `Encrypted`, `Method`,
  `Block`, `Symbolic Link`, `Hard Link`, `Volume Index`. Unknown keys are kept in a `raw` map. The parser is
  streaming and line-based (via `readline`), with no buffering of the whole output.
- **Progress (`-bsp1`):** lines like ` 64% 12 - kenya/IMG_2231.jpg`, overwritten with backspaces or `\r`. The
  parser splits on `\r`, `\b` and `\n` and extracts percent, file count and current name.
- **Per-file (`-bb1`):** `- path` for each extracted file. Used for the report and post-validation.
- **Errors:** stderr lines, plus the `ERROR:` / `WARNING:` prefixes on stdout. Mapped to codes:

| Pattern (case-insensitive) | Code |
| --- | --- |
| `Wrong password` | `WRONG_PASSWORD` |
| `Missing volume : <name>` (printed on **stdout** inside `ERRORS:`) | `MISSING_VOLUME` (volume name extracted) |
| `CRC Failed` / `Data Error` | `CRC_ERROR` (per entry) |
| `Unsupported Method` | `UNSUPPORTED_METHOD` |
| `Can not open the file as archive` / `Cannot open the file as archive` | `NOT_ARCHIVE` |
| `There is not enough space on the disk` / `No space left on device` | `DISK_FULL` |
| `Access is denied` / `Permission denied` | `ACCESS_DENIED` |
| `Headers Error` / `Unconfirmed start of archive` | `CORRUPT_ARCHIVE` |

### 2.5 Exit codes

| 7-Zip exit | Meaning | Job result |
| --- | --- | --- |
| 0 | No error | `completed` (or `completedWithWarnings` if the report has skips or renames) |
| 1 | Warning (non-fatal, e.g. locked files) | `completedWithWarnings` |
| 2 | Fatal error | `failed` (code from stderr mapping) |
| 7 | Command-line error | `failed` / `UNKNOWN` (a bug: log and report) |
| 8 | Not enough memory | `failed` / `OUT_OF_MEMORY` |
| 255 | User stopped | `cancelled` |
| signal | Killed by us | `cancelled` |

### 2.6 Process control

- `spawn(bin, args, { shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'], cwd: tmpDir, env: minimalEnv })`.
- Cancel: close stdin, then `SIGTERM` (POSIX) or `child.kill()` (Windows, which uses TerminateProcess). If
  the process is still alive after 3 s, `SIGKILL`.
- Timeouts: listing 5 min without output → fail with `UNKNOWN`. Extraction has no global timeout.
- Concurrency limit enforced by JobManager (default 2).
- Priority: children run at below-normal priority (`os.setPriority`) when "Background mode" is on.

### 2.7 Multi-volume sets

7-Zip reads a volume set correctly only when it is opened from the **first** volume. Opening `part3`
directly lists from that volume, reports `Headers Error`, and undercounts the volumes. `engine/volumes.ts`
therefore maps any volume to the first one before every call: `name.partN.rar` (any zero padding) →
`part1`, `name.rNN` → `name.rar`, `name.NNN` → `name.001`, `name.zNN` → `name.zip`. It falls back to the
given path if the first volume doesn't exist, and a later call then reports `MISSING_VOLUME`.

## 3. Launch intents (CLI → app)

```ts
type LaunchIntent =
  | { kind: 'open'; archive: string }
  | { kind: 'extract'; mode: 'smart'|'here'|'to'; archives: string[]; destination?: string }
  | { kind: 'compress'; format: 'zip'|'7z'|'ask'; sources: string[] }
  | { kind: 'test'; archives: string[] };
```

Parsed in main from `process.argv` (first instance) or the `second-instance` event (forwarded argv + cwd).
Relative paths resolve against the forwarded `cwd`. Intents that arrive within 500 ms are merged (for
example, Explorer launching one process per selected file becomes one batch).

## 4. Command-line interface

```
winrarclone [<archive>]                               Open archive in the browser
winrarclone x   [--smart|--here|--to <dir>] <archive…>   Extract
winrarclone a   [--format zip|7z] [--level 0-9] <out> <sources…>
winrarclone t   <archive…>                             Test
winrarclone --context <verb> <paths…>                  Used by OS integrations (verbs: extract-smart, extract-here, extract-to, add-zip, add-7z, add-ask, open)
Options: --headless (no main window, compact job window only), --wait (block until jobs finish; for scripts)
Exit codes (with --wait): 0 ok · 1 completed with warnings · 2 failed · 3 cancelled · 64 usage error
```
