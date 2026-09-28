import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchPaths } from './launch-args';

const files = new Set([resolve('/w/a.rar'), resolve('/w/b.zip')]);
const isFile = (p: string) => files.has(p);

describe('launchPaths', () => {
  it('skips the executable (packaged) or electron + main script (dev)', () => {
    expect(launchPaths(['/opt/app/WinrarClone', '/w/a.rar'], true, '/', isFile)).toEqual([
      resolve('/w/a.rar'),
    ]);
    expect(launchPaths(['electron', 'out/main/index.js', '/w/a.rar'], false, '/', isFile)).toEqual([
      resolve('/w/a.rar'),
    ]);
  });

  it('ignores switches and missing files, resolves relative paths against cwd', () => {
    expect(
      launchPaths(['exe', '--inspect=0', '-psn_0_1', 'b.zip', 'missing.7z', ''], true, '/w', isFile),
    ).toEqual([resolve('/w/b.zip')]);
  });
});
