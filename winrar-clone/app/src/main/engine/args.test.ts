import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { infoArgs, listArgs, testArgs } from './args';

describe('7-Zip argv builders', () => {
  it('builds exact argv arrays', () => {
    expect(listArgs('/a/b.rar')).toEqual(['l', '-slt', '-sccUTF-8', '-scsUTF-8', '--', '/a/b.rar']);
    expect(testArgs('/a/b.rar')).toEqual([
      't',
      '-bsp1',
      '-bb1',
      '-bso1',
      '-bse2',
      '-sccUTF-8',
      '-scsUTF-8',
      '--',
      '/a/b.rar',
    ]);
    expect(infoArgs()).toEqual(['i']);
  });

  it('always puts the path last, after "--", and never passes a password switch', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (path) => {
        for (const args of [listArgs(path), testArgs(path)]) {
          expect(args.at(-1)).toBe(path);
          expect(args.at(-2)).toBe('--');
          expect(args.slice(0, -1).some((a) => a.startsWith('-p'))).toBe(false);
        }
      }),
    );
  });
});
