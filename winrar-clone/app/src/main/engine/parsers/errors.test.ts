import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyFailure } from './errors';

const fx = (name: string) =>
  readFileSync(join(import.meta.dirname, '../__fixtures__/linux-26.03', name), 'utf8');

describe('classifyFailure (captured 7-Zip 26.03 output)', () => {
  it('detects a missing volume reported on stdout and names it', () => {
    const r = classifyFailure(
      2,
      fx('extract-missing-volume-stdout.txt'),
      fx('extract-missing-volume-stderr.txt'),
    );
    expect(r.code).toBe('MISSING_VOLUME');
    expect(r.details.volume).toBe('rar5-multi-solid.part03.rar');
  });

  it('detects a wrong password and lists affected entries', () => {
    const r = classifyFailure(
      2,
      fx('extract-wrong-password-stdout.txt'),
      fx('extract-wrong-password-stderr.txt'),
    );
    expect(r.code).toBe('WRONG_PASSWORD');
    expect(r.details.entries?.map((e) => e.entry)).toEqual(['b.txt', 'd.txt']);
  });

  it('detects wrong password on encrypted headers', () => {
    expect(classifyFailure(2, fx('list-rar5-encrypted-headers-wrong.txt'), '').code).toBe('WRONG_PASSWORD');
  });

  it('detects files that are not archives', () => {
    expect(
      classifyFailure(2, fx('list-not-archive-stdout.txt'), fx('list-not-archive-stderr.txt')).code,
    ).toBe('NOT_ARCHIVE');
  });

  it.each([
    ['ERROR: No space left on device', 'DISK_FULL'],
    ['ERROR: There is not enough space on the disk', 'DISK_FULL'],
    ['ERROR: Permission denied', 'ACCESS_DENIED'],
    ['ERROR: Unsupported Method : x.bin', 'UNSUPPORTED_METHOD'],
    ['ERROR: CRC Failed : x.bin', 'CRC_ERROR'],
    ['Unexpected end of archive', 'CORRUPT_ARCHIVE'],
  ] as const)('%s → %s', (stderr, code) => {
    expect(classifyFailure(2, '', stderr).code).toBe(code);
  });

  it('falls back on exit codes', () => {
    expect(classifyFailure(8, '', '').code).toBe('OUT_OF_MEMORY');
    expect(classifyFailure(255, '', '').code).toBe('CANCELLED');
    expect(classifyFailure(2, '', '').code).toBe('UNKNOWN');
  });
});
