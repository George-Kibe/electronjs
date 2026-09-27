# 09 — Platform Integration: WinrarClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Related | FR-INT-*, [IPC §3–4](04-ipc-engine-contract.md#3-launch-intents-cli--app), [ADR-0005](adr/0005-single-instance-cli-forwarding.md) |

## 1. Common mechanism

Every OS integration launches the app executable with `--context <verb> <paths…>`. The app:

1. calls `app.requestSingleInstanceLock()`. If another instance holds it, it forwards argv + cwd through the
   `second-instance` event and exits within about 200 ms.
2. The primary instance parses intents and merges any that arrive within 500 ms into one batch (Explorer
   starts one process per selected file for classic verbs).
3. If the main window is not open, it shows the compact **headless jobs window** (FR-INT headless mode).

To start faster when invoked from a context menu, the app keeps a light **tray-less background mode**
(opt-in, "Keep WinrarClone ready in the background"), so second-instance forwarding is instant.

## 2. Windows

### 2.1 File associations

- electron-builder `fileAssociations` registers the ProgID `WinrarClone.Archive` and `OpenWithProgids` for
  each extension (per-user under `HKCU\Software\Classes`). This makes the app appear in "Open with" without
  taking over the default.
- "Make default" in Settings opens `ms-settings:defaultapps?registeredAppUser=WinrarClone`. Windows 10/11
  do not allow apps to set defaults programmatically (hash-protected `UserChoice`).
- The app registers under `HKCU\Software\RegisteredApplications` + `Capabilities\FileAssociations` so it
  shows in Default Apps.

### 2.2 Context menu (classic verbs, v1)

Written by `build/installer.nsh` at install time and toggled at runtime by `integration/context-menu/win.ts`
(HKCU only, **no elevation**):

```
HKCU\Software\Classes\*\shell\WinrarClone                        MUIVerb="WinrarClone"  SubCommands=""  Icon="<exe>,0"
HKCU\Software\Classes\*\shell\WinrarClone\shell\01addzip         MUIVerb="Add to archive (.zip)"   command: "<exe>" --context add-zip "%1"
HKCU\Software\Classes\*\shell\WinrarClone\shell\02add7z          MUIVerb="Add to archive (.7z)"    command: "<exe>" --context add-7z "%1"
HKCU\Software\Classes\*\shell\WinrarClone\shell\03addask         MUIVerb="Add to archive…"          command: "<exe>" --context add-ask "%1"
HKCU\Software\Classes\Directory\shell\WinrarClone\...            (same Add verbs for folders)
HKCU\Software\Classes\WinrarClone.Archive\shell\extract-smart    MUIVerb="Extract (smart)"          command: "<exe>" --context extract-smart "%1"
HKCU\Software\Classes\WinrarClone.Archive\shell\extract-here     MUIVerb="Extract here"
HKCU\Software\Classes\WinrarClone.Archive\shell\extract-to       MUIVerb="Extract to folder…"
HKCU\Software\Classes\SystemFileAssociations\.<ext>\shell\WinrarClone...   (so verbs show even when another app is the default)
```

- `MultiSelectModel=Player` on verbs, so Explorer passes multi-selections in a single invocation where
  possible (up to its limit). The 500 ms batching handles the rest.
- Uninstall removes every key. The runtime toggle rewrites only our own keys.
- **Windows 11:** these appear under "Show more options" (Shift+F10). Top-level placement in the modern
  menu requires an `IExplorerCommand` COM DLL with package identity (sparse MSIX package). That is planned
  for M4+ as a small C++ project `winrar-clone/shell-ext-win/`.

### 2.3 Other

- Jump list: recent archives (`app.setJumpList`) + "Create archive…".
- Taskbar progress: `win.setProgressBar()`.
- Long paths: the app manifest declares `longPathAware`. 7-Zip handles `\\?\` paths internally.

## 3. macOS

### 3.1 File associations

- `CFBundleDocumentTypes` (from electron-builder `fileAssociations`, role `Viewer`, rank `Alternate`) + UTIs
  (`com.rarlab.rar-archive`, `public.zip-archive`, `org.7-zip.7-zip-archive`, `public.tar-archive`,
  `org.gnu.gnu-zip-archive`, …).
- Files opened from Finder arrive through `app.on('open-file')`, which can fire **before** `ready`. Queue
  them and merge them into the batching logic.
- "Make default" guides the user to Finder → Get Info → Open with → Change All. There is no reliable public
  API; `LSSetDefaultRoleHandlerForContentType` is deprecated and we do not use it.

### 3.2 Context menu

- **v1 (M3):** Quick Actions. The app ships `.workflow` bundles (Automator "Run Shell Script":
  `open -a "WinrarClone" --args --context extract-smart "$@"`) and installs them on request into
  `~/Library/Services/` from Settings → Integration. They appear in Finder → right-click → Quick Actions.
- **Future:** a Finder Sync app extension (Swift, `winrar-clone/shell-ext-mac/`) for first-class menu items.
  It needs an app-extension target, which electron-builder can embed as an extra bundle. Signed with the
  same team ID.

### 3.3 Other

- Dock menu: recent archives + "Create archive…". Dock badge = running job count.
- Files keep their quarantine xattr (see [Security §4.5](06-security.md#45-mark-of-the-web-windows)).
- Mac App Store is not planned (sandbox restrictions, see requirements Q3).

## 4. Linux

### 4.1 File associations

- The `.desktop` file (electron-builder) with `MimeType=` listing archive types and
  `Exec=winrarclone --context open %F`.
- "Make default" runs `xdg-mime default winrarclone.desktop application/zip …` for the selected types
  (user-level, `~/.config/mimeapps.list`), after confirmation.
- AppImage: integration only works when installed through AppImageLauncher/Gear Lever, or when the user
  clicks "Integrate with desktop" in Settings. That writes a `.desktop` file in `~/.local/share/applications/`
  pointing to the AppImage path.

### 4.2 Context menu

Installed from Settings → Integration into user directories (no root):

| File manager | Mechanism | Location |
| --- | --- | --- |
| Nautilus (GNOME Files) | Scripts (`Scripts` submenu) | `~/.local/share/nautilus/scripts/WinrarClone/Extract here` etc. |
| Dolphin (KDE) | Service menu `.desktop` | `~/.local/share/kio/servicemenus/winrarclone.desktop` |
| Nemo (Cinnamon) | Nemo actions | `~/.local/share/nemo/actions/winrarclone-*.nemo_action` |
| Thunar (Xfce) | Custom actions | `~/.config/Thunar/uca.xml` (merge, don't overwrite) |
| Caja (MATE) | Caja actions | `~/.local/share/file-manager/actions/` |

Nautilus scripts receive the selection through `NAUTILUS_SCRIPT_SELECTED_FILE_PATHS`. The script forwards it
as argv.

### 4.3 Other

- Progress: `app.setBadgeCount` / Unity launcher API where supported.
- Wayland: drag-out works on Electron's Wayland backend. Test on both X11 and Wayland in nightly.

## 5. Verification matrix

| Feature | Win 10 | Win 11 | macOS 13+ | Ubuntu (GNOME) | Kubuntu (KDE) | Fedora |
| --- | --- | --- | --- | --- | --- | --- |
| Open with / associations | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Context menu | classic | "Show more options" (modern later) | Quick Actions | Scripts submenu | Service menu | Scripts |
| Multi-select batching | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MotW / quarantine | ✓ | ✓ | ✓ | n/a | n/a | n/a |
| Taskbar/dock progress | ✓ | ✓ | ✓ | partial | ✓ | partial |
