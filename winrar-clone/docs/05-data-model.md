# 05 — Data Model (settings, state, archive index): WinrarClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

WinrarClone has no server and no database. It keeps three kinds of state:

| State | Storage | Lifetime |
| --- | --- | --- |
| Settings | `electron-store` JSON at `<userData>/settings.json`, zod-validated, versioned migrations | Persistent |
| Recent archives & destinations | `<userData>/recent.json` (max 20 each). Paths are stored locally only. | Persistent, clearable |
| Job history | In memory (current session). The last 50 reports go to `<userData>/reports/*.json`. | 30 days (janitor) |
| Archive index (open sessions) | In memory in main | Until the session closes |
| Staging / temp | `<dest>/.wrc-staging-<jobId>/` and `<os.tmpdir()>/winrarclone-<pid>/` (0700) | Deleted at job end; orphans cleaned at startup |

## 1. Settings schema (v1)

```ts
const Settings = z.object({
  schemaVersion: z.literal(1),
  general: z.object({
    theme: z.enum(['system', 'light', 'dark']).default('system'),
    language: z.string().default('en'),
    defaultAction: z.enum(['extractSmart', 'extractHere', 'extractTo', 'open']).default('extractSmart'),
    density: z.enum(['compact', 'comfortable']).default('compact'),
  }),
  extraction: z.object({
    defaultDestination: z.enum(['archiveFolder', 'downloads', 'custom']).default('archiveFolder'),
    customDestination: z.string().optional(),
    overwrite: z.enum(['ask', 'overwrite', 'skip', 'renameNew', 'renameExisting']).default('ask'),
    symlinkPolicy: z.enum(['skip', 'asText', 'allowInside']).default('skip'),
    openFolderWhenDone: z.boolean().default(true),
    closeHeadlessWindowAfterSec: z.number().int().min(0).max(60).default(3),
    bombRatioWarn: z.number().default(100),
    freeSpaceReserveBytes: z.number().default(1_073_741_824),
    legacyCodePage: z.string().optional(),        // e.g. '866', '437', '932'
  }),
  creation: z.object({
    defaultFormat: z.enum(['zip', '7z', 'tar', 'tar.gz', 'tar.xz', 'tar.bz2']).default('zip'),
    defaultLevel: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5), z.literal(7), z.literal(9)]).default(5),
    excludes: z.array(z.string()).default(['.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX/']),
    profiles: z.array(CreateProfile).default([]),
  }),
  integration: z.object({
    contextMenu: z.object({
      enabled: z.boolean().default(true),
      items: z.array(z.enum(['extractSmart', 'extractHere', 'extractTo', 'open', 'addZip', 'add7z', 'addAsk']))
        .default(['extractSmart', 'extractHere', 'open', 'addZip', 'addAsk']),
      cascade: z.boolean().default(true),        // group under one "WinrarClone" submenu
    }),
    associations: z.array(z.string()).default(['rar', 'zip', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'cab']),
  }),
  jobs: z.object({
    concurrency: z.number().int().min(1).max(8).default(2),
    backgroundPriority: z.boolean().default(false),
    tempDir: z.string().optional(),
  }),
  updates: z.object({ channel: z.enum(['latest', 'beta']).default('latest'), autoDownload: z.boolean().default(true) }),
  privacy: z.object({ crashReports: z.boolean().default(false) }),
});
```

Migrations: `settings/migrations/<n>.ts` transforms v(n-1) to v(n). Invalid files are backed up as
`settings.invalid-<ts>.json` and reset to defaults, with a notice to the user.

## 2. Archive index (in-memory)

```ts
type ArchiveSession = {
  id: string;
  archivePath: string;              // resolved, realpath
  firstVolumePath: string;
  volumes: string[];
  format: string;                   // e.g. 'Rar5', 'zip', '7z'
  props: { solid?: boolean; encryptedHeaders: boolean; hasEncryptedEntries: boolean;
           method?: string; comment?: string; physicalSize: number; };
  entries: Entry[];                 // flat, index = entryId
  tree: Map<string /*folder path*/, number[] /*child entry ids*/>;
  totals: { files: number; folders: number; size: number; packed: number };
  passwordCached: boolean;          // password held in main memory only for session lifetime
};

type Entry = {
  path: string;                     // archive-internal, normalized to '/'
  name: string;
  isDir: boolean;
  size: number; packed: number;
  modified?: number; crc?: string; encrypted: boolean; method?: string;
  attributes?: string;
  link?: { kind: 'symlink' | 'hardlink'; target: string };
  dangerous: boolean;               // by extension list (FR-SAFE-05)
  safety?: BlockReason;             // precomputed against a hypothetical destination
};
```

Memory budget: about 200 bytes per entry, so 1M entries is about 200 MB. For archives above 200k entries,
the index is built in a `worker_threads` worker and the tree is paged.

## 3. Job model

```ts
type Job = {
  id: string; kind: 'extract' | 'create' | 'test' | 'dragOut';
  state: JobState; createdAt: number; startedAt?: number; finishedAt?: number;
  request: ExtractRequest | CreateRequest | TestRequest;   // passwords stripped before persistence
  progress: JobProgress; report?: JobReport; error?: { code: EngineErrorCode; message: string };
  child?: ChildProcess;              // not serialized
  stagingDir?: string;
};
```

Persisted reports (`reports/<jobId>.json`) contain archive and destination paths and entry names, because
the user needs them for troubleshooting. They are stored only locally, and "Clear history" deletes them.

## 4. Filesystem layout

```
<userData>/                         # e.g. %APPDATA%/WinrarClone, ~/Library/Application Support/WinrarClone, ~/.config/WinrarClone
├── settings.json
├── recent.json
├── reports/
└── logs/main.log (rotating, 5 × 5 MB)
<tmp>/winrarclone-<pid>/            # previews, drag-out, list files (0700; removed on exit and by the startup janitor)
<dest>/.wrc-staging-<jobId>/        # hidden staging (Windows: +H attribute)
```
