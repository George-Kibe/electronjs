const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

/** 7-Zip prints "2026-08-12 07:28:43.2097421"; show minutes precision. */
export function formatModified(modified: string | null): string {
  return modified ? modified.slice(0, 16) : '—';
}

/**
 * Makes bidirectional override characters visible so names like "invoice‮fdp.exe" cannot pose as
 * another extension (docs/06 §3, T-SAFE-09).
 */
export function revealBidi(name: string): string {
  return name.replace(/[‪-‮⁦-⁩]/g, (ch) => `⟨U+${ch.charCodeAt(0).toString(16).toUpperCase()}⟩`);
}
