import fc from 'fast-check';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstVolumePath } from './volumes';

const dir = join('/archives', 'set');
const existing = (...names: string[]) => {
  const set = new Set(names.map((n) => join(dir, n)));
  return (p: string) => set.has(p);
};

describe('firstVolumePath', () => {
  it.each([
    ['movie.part3.rar', ['movie.part1.rar'], 'movie.part1.rar'],
    ['movie.part03.rar', ['movie.part01.rar'], 'movie.part01.rar'],
    ['movie.part0004.rar', ['movie.part0001.rar'], 'movie.part0001.rar'],
    ['movie.PART2.RAR', ['movie.PART1.RAR'], 'movie.PART1.RAR'],
    ['old.r05', ['old.rar'], 'old.rar'],
    ['backup.7z.003', ['backup.7z.001'], 'backup.7z.001'],
    ['plain.004', ['plain.001'], 'plain.001'],
    ['split.z02', ['split.zip'], 'split.zip'],
  ])('%s → %s', (input, present, expected) => {
    expect(firstVolumePath(join(dir, input), existing(...present))).toBe(join(dir, expected));
  });

  it('keeps the original path when the first volume is absent', () => {
    expect(firstVolumePath(join(dir, 'movie.part3.rar'), existing())).toBe(join(dir, 'movie.part3.rar'));
  });

  it('leaves single archives untouched', () => {
    for (const name of ['photos.rar', 'a.zip', 'b.7z', 'c.tar.gz', 'part1.txt'])
      expect(firstVolumePath(join(dir, name), () => true)).toBe(join(dir, name));
  });

  it('never escapes the archive directory', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-zA-Z0-9 ._-]{1,40}$/), (name) => {
        const result = firstVolumePath(join(dir, name), () => true);
        expect(result.startsWith(dir)).toBe(true);
      }),
    );
  });
});
