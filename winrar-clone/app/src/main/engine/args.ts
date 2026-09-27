/**
 * Pure argv builders for 7-Zip (docs/04 §2.2). Rules:
 *  - always argv arrays, never shell strings (spawn uses shell: false);
 *  - `--` before every path so names starting with '-' or '@' are never parsed as switches or list files;
 *  - never pass `-p<password>`: passwords go through stdin (docs/04 §2.3).
 */

/** UTF-8 console and list-file charsets on every call. */
export const CHARSET_SWITCHES = ['-sccUTF-8', '-scsUTF-8'] as const;

/** Technical listing including the archive property block. */
export function listArgs(archivePath: string): string[] {
  return ['l', '-slt', ...CHARSET_SWITCHES, '--', archivePath];
}

/** Integrity test with progress (-bsp1) and per-file lines (-bb1) on stdout, errors on stderr. */
export function testArgs(archivePath: string): string[] {
  return ['t', '-bsp1', '-bb1', '-bso1', '-bse2', ...CHARSET_SWITCHES, '--', archivePath];
}

/** `7zz i` prints the version banner plus codec info; we only read the banner. */
export function infoArgs(): string[] {
  return ['i'];
}
