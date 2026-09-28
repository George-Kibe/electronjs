# Third-Party Notices — WinrarClone

WinrarClone's own source code is MIT-licensed. It bundles and redistributes these third-party components:

## 7-Zip

- **Version:** pinned in `app/scripts/7zip-versions.json` (currently 26.03; minimum 25.01)
- **Copyright:** © Igor Pavlov
- **Website / source:** https://www.7-zip.org/
- **License:** GNU LGPL v2.1 or later for most of the code, BSD 3-clause for some parts, and the **unRAR
  license restriction** for the RAR decompression code:

  > The unRAR sources cannot be used to re-create the RAR compression algorithm, which is proprietary.
  > Distribution of modified unRAR sources in separate form or as a part of other software is permitted,
  > provided that it is clearly stated in the documentation and source comments that the code may not be
  > used to develop a RAR (WinRAR) compatible archiver.

- **How it is used:** unmodified official binaries (`7zz` on macOS, the static `7zzs` renamed to `7zz` on Linux, `7z.exe` + `7z.dll` on Windows)
  are shipped as separate executables in the app's resources and invoked as child processes. They are not
  statically linked. The full license text (`License.txt` from the 7-Zip distribution) is shipped next to
  the binaries and shown in the app's About → Licenses screen.
- **Source availability (LGPL):** the corresponding 7-Zip source archive for the bundled version is
  available from https://www.7-zip.org/download.html. A mirror is attached to each WinrarClone GitHub Release.

## libarchive test archives (tests only, not shipped)

`app/test/fixtures/rar/*.rar` come from the libarchive 3.8.9 test suite (BSD 2-Clause, © Tim Kientzle and
contributors). They are used only by our test suite. See `app/test/fixtures/rar/README.md`.

## Electron, Chromium, Node.js and npm dependencies

License texts for Electron/Chromium (`LICENSES.chromium.html`, shipped by Electron) and for all production
npm dependencies are generated at build time (`pnpm licenses:generate`) into `resources/licenses/` and shown
in About → Licenses.
