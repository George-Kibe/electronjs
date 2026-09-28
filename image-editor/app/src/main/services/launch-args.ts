import { statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Extracts file paths from the process argv (FR-BRW-01 "CLI argument", file associations; docs/04 §4).
 * argv is `[exe, ...args]` when packaged and `[electron, main.js, ...args]` in development. Switches
 * (Chromium or ours) are ignored; only existing regular files are returned.
 */
export function launchPaths(
  argv: readonly string[],
  isPackaged: boolean,
  cwd: string = process.cwd(),
  isFile: (p: string) => boolean = defaultIsFile,
): string[] {
  return argv
    .slice(isPackaged ? 1 : 2)
    .filter((arg) => arg !== '' && !arg.startsWith('-'))
    .map((arg) => resolve(cwd, arg))
    .filter(isFile);
}

function defaultIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
