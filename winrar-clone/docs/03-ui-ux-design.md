# 03 — UI/UX Design: WinrarClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

## 1. Design principles

1. **Zero-config common case.** Opening an archive shows one obvious primary action ("Extract here").
   Power options are one click away, never in the way.
2. **Show what will happen.** Before extracting, show the destination path. After extracting, show a report.
3. **Safety is visible but calm.** Blocked entries and dangerous files are clearly labelled. Warnings don't
   use scary modal chains.
4. **Native feel.** Respect OS conventions: menu bar on macOS, title-bar controls, dialogs, fonts, and
   scrolling physics.
5. **Accessible.** WCAG 2.2 AA, fully keyboard operable.

## 2. Visual language

- Design tokens as CSS variables + Tailwind v4 theme (the same token system as WhatsappClone, with a
  different brand colour). Brand: `--color-brand: #7048E8` (light) / `#9775FA` (dark), a violet that avoids
  WinRAR's stacked-books imagery and colours.
- System font stack. Monospace for CRC and paths (`ui-monospace, "Cascadia Mono", "SF Mono", Menlo, monospace`).
- File-type icons: our own set based on Lucide file glyphs, colour-coded by category (archive, image, doc,
  code, audio, video, executable = red outline).
- Dense table layout by default (28 px rows), with a comfortable option (36 px).

## 3. Screens

### 3.1 Home (no archive open)

```
┌─────────────────────────────────────────────────────────────────────┐
│ WinrarClone                                                   ─ □ × │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│          ┌───────────────────────────────────────────────┐          │
│          │        ⬇  Drop an archive or files here        │          │
│          │   archives → open   ·   other files → compress  │          │
│          │                                               │          │
│          │   [ Open archive… ]     [ Create archive… ]   │          │
│          └───────────────────────────────────────────────┘          │
│                                                                     │
│   Recent                                                            │
│   📦 photos-2026.rar        Downloads      2.1 GB     Yesterday     │
│   📦 backup.7z              Documents      640 MB     Sep 20        │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Jobs: idle                                              ⚙ Settings  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Archive browser

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← photos-2026.rar   RAR5 · solid · 3 volumes · 🔒 encrypted     ⓘ  🔍 Filter  │
│ [⬇ Extract here] [📁 Extract to…] [✓ Test] [＋ Add] [⋯]                        │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ▾ photos-2026 │ Name ▲              Size      Packed    Modified      CRC     │
│   ▸ kenya     │ 📁 kenya              —         —       2026-08-10            │
│   ▸ uganda    │ 🖼 cover.jpg        4.2 MB    4.1 MB    2026-08-12  9A3F21C0  │
│               │ 📄 notes.txt        2 KB      1 KB      2026-08-12  11AB0E3D  │
│               │ ⚠ setup.exe        1.1 MB    1.0 MB    2026-08-01  77D0C2AA  │
│               │                                                              │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ 1,284 files · 42 folders · 2.1 GB (packed 1.9 GB)        Selected: 1 (4.2 MB) │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Toolbar primary action** follows the setting (default "Extract here"). A split button holds the other modes.
- **Breadcrumb** plus a folder tree on the left. The tree can collapse below 900 px width.
- **Table:** virtualized, sortable, resizable columns (column choice is persisted). Multi-select with
  Shift/Ctrl/⌘. Type-ahead find.
- **Row actions:** double-click folder → navigate. Double-click file → preview (safe types), or confirm
  before opening externally. Context menu: Preview, Extract selected…, Open with system app, Copy name,
  Properties.
- **Preview pane** (toggle with Space, like Quick Look) on the right: image, text with highlighting, PDF.
  Unsupported types show properties.
- **Encrypted archives:** the lock badge in the header. A password prompt appears inline as a sheet, not a
  separate window.
- **Dangerous files:** ⚠ icon and red outline. Tooltip: "Executable file. Only run it if you trust the source."

### 3.3 Extract options (Extract to…)

A modal sheet with:
- Destination path field + "Browse…" + recent destinations dropdown
- Radio: "Extract into a new folder named 'photos-2026'" (default on if needed) / "Extract directly"
- Overwrite: Ask · Overwrite · Skip · Rename new · Rename existing
- Paths: Full paths · No paths (flatten)
- Checkbox: Open destination when done
- Password field (only if encrypted)
- Summary: "1,284 files · 2.1 GB · 38 GB free"
- Buttons: Cancel · **Extract**

### 3.4 Create archive dialog

- Archive name + location (defaults to the sources' parent folder, with the common name or the first item's name)
- Format segmented control: **ZIP** · 7z · TAR · TAR.GZ · TAR.XZ · TAR.BZ2
- Level slider: Store → Ultra (with speed/size hint)
- Encryption (ZIP/7z): password + confirm + strength meter (zxcvbn-ts). "Encrypt file names" (7z only).
- Split: None · 100 MB · 700 MB · 4 GB (FAT32) · Custom
- Advanced (collapsed): solid, threads, exclude patterns, store symlinks as links
- Estimated size (rough) and a free-space check

### 3.5 Jobs panel

A bottom drawer that expands from the status bar. It also opens as a compact window when invoked from the
context menu while the main window is closed.

```
┌───────────────────────────────────────────────────────────────┐
│ Jobs (2 running, 3 queued)                         Clear done │
│ ⬇ photos-2026.rar → Downloads/photos-2026   ▓▓▓▓▓░░ 64% 85MB/s│
│    kenya/IMG_2231.jpg · 00:21 left                  [Cancel]  │
│ ⬇ docs.zip → Downloads                      ▓▓░░░░░ 22%       │
│ ⏳ backup.7z (queued)                                          │
│ ✅ music.7z → Music/music  · 842 files · 3 warnings [Report]  │
└───────────────────────────────────────────────────────────────┘
```

### 3.6 Completion report

Summary counts (extracted, skipped, renamed, blocked, errors). Tabs: Blocked (with reasons, such as "Path
escapes destination"), Renamed (old → new), Errors (CRC and so on). "Copy report" (text) and "Open folder".

### 3.7 Safety confirmation (bomb/space)

A non-modal warning card in the job with the facts: "This archive expands to 850 GB (ratio 12,000:1). Your
disk has 120 GB free." Actions: Cancel (primary) · Extract anyway (only if space allows).

### 3.8 Settings

Sections: General (theme, language, default action, default destination), Extraction (overwrite mode,
smart folder rule, symlink policy, open folder after), Creation (default format/level, exclude patterns),
Integration (context menu items with a checkbox each, file associations list, "Make default" help per
OS), Updates (channel, check now), Privacy (crash reports opt-in), Advanced (temp dir, concurrency,
legacy code page), About (versions incl. 7-Zip, Licenses).

## 4. Interaction details

- **Drag and drop in:** a drop overlay shows the intent ("Open archive" vs "Compress 5 items"). Dropping
  multiple archives offers "Extract all" or "Open first".
- **Drag and drop out:** dragging entries from the table extracts them to temp (with an inline progress
  indicator if > 50 MB), then hands the files to the OS drag.
- **Context-menu invocations** while the app is closed: headless mode shows only the compact jobs window,
  which closes itself 3 s after success (configurable). Errors keep it open.
- **Taskbar/dock:** aggregate progress (`setProgressBar`). Dock badge = running jobs (macOS).

## 5. Keyboard shortcuts

| Action | Win/Linux | macOS |
| --- | --- | --- |
| Open archive | Ctrl+O | ⌘O |
| New archive | Ctrl+N | ⌘N |
| Extract here / to… | Ctrl+E / Ctrl+Shift+E | ⌘E / ⌘⇧E |
| Test archive | Ctrl+T | ⌘T |
| Filter | Ctrl+F | ⌘F |
| Preview | Space | Space |
| Up one folder | Backspace / Alt+↑ | ⌘↑ |
| Open folder / preview | Enter | ⌘↓ / Enter |
| Select all | Ctrl+A | ⌘A |
| Properties | Alt+Enter | ⌘I |
| Toggle jobs panel | Ctrl+J | ⌘J |
| Settings | Ctrl+, | ⌘, |

## 6. Accessibility

- The table uses `role="grid"` with proper row/column headers, `aria-sort` and `aria-selected`. Arrow keys move.
- Progress uses `role="progressbar"` with `aria-valuenow` and a text alternative ("64 percent, 21 seconds left").
  Completion is announced through an `aria-live` region.
- All icons have text labels or `aria-label`. Colour is never the only signal (⚠ icon + text for danger).
- `prefers-reduced-motion` and `forced-colors` are honoured.

## 7. Content & microcopy guidelines

- Error messages say what happened, why (if known), and what to do next. Example: "Can't find
  movie.part4.rar. Put all parts in the same folder and try again."
- Use "archive", not "file", for containers. Use "extract", not "unzip" (it's not always ZIP).
- Never blame the user. Never show raw 7-Zip output in the main UI (it is available under "Details").
