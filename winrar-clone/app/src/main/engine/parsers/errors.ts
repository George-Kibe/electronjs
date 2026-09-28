import type { EngineErrorCode } from '@shared/schemas';

/**
 * Maps 7-Zip output + exit code to a typed error (docs/04 §2.4–2.5). 7-Zip reports some fatal problems on
 * stdout (e.g. "Missing volume" inside an ERRORS: block) and others on stderr, so callers pass both.
 */
export type ClassifiedError = {
  code: EngineErrorCode;
  details: { volume?: string; entries?: Array<{ entry: string; problem: string }> };
};

type Rule = { code: EngineErrorCode; test: RegExp };

// Ordered by priority: the first matching rule decides the job-level code.
const RULES: Rule[] = [
  { code: 'MISSING_VOLUME', test: /Missing volume/i },
  { code: 'WRONG_PASSWORD', test: /Wrong password|Cannot open encrypted archive/i },
  { code: 'NOT_ARCHIVE', test: /Is not archive|Can ?not open the file as .*archive/i },
  { code: 'DISK_FULL', test: /There is not enough space on the disk|No space left on device/i },
  { code: 'ACCESS_DENIED', test: /Access is denied|Permission denied/i },
  { code: 'UNSUPPORTED_METHOD', test: /Unsupported Method/i },
  { code: 'OUT_OF_MEMORY', test: /Can't allocate required memory|Not enough memory/i },
  { code: 'CRC_ERROR', test: /CRC Failed|Data Error/i },
  { code: 'CORRUPT_ARCHIVE', test: /Headers Error|Unconfirmed start of archive|Unexpected end of archive/i },
];

const ENTRY_ERROR =
  /^ERROR: (Data Error|CRC Failed|Wrong password|Unsupported Method)(?: in encrypted file)?(?: : (.+))?$/i;

export function classifyFailure(exitCode: number | null, stdout: string, stderr: string): ClassifiedError {
  const text = `${stderr}\n${stdout}`;
  const details: ClassifiedError['details'] = {};

  const volume = /Missing volume\s*:\s*(.+)/i.exec(text);
  if (volume) details.volume = volume[1]!.trim();

  const entries: Array<{ entry: string; problem: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = ENTRY_ERROR.exec(line.trim());
    if (m?.[2]) entries.push({ entry: m[2].trim(), problem: m[1]! });
  }
  if (entries.length) details.entries = entries;

  for (const rule of RULES) if (rule.test.test(text)) return { code: rule.code, details };
  if (exitCode === 8) return { code: 'OUT_OF_MEMORY', details };
  if (exitCode === 255) return { code: 'CANCELLED', details };
  return { code: 'UNKNOWN', details };
}
