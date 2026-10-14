import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeAtomic } from './atomic-write';
import { RecoveryStore } from './recovery';

const dirs: string[] = [];
function store() {
  const dir = join(mkdtempSync(join(tmpdir(), 'ie-recovery-')), 'recovery');
  dirs.push(dir);
  return { dir, recovery: new RecoveryStore({ dir, writeAtomic }) };
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(join(d, '..'), { recursive: true, force: true })));

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const a = crypto.randomUUID();
const b = crypto.randomUUID();

describe('RecoveryStore (FR-DOC-10)', () => {
  it('writes, lists newest first, reads back and discards', async () => {
    const { dir, recovery } = store();
    await recovery.write(a, 'Holiday', new Uint8Array([1, 2, 3]), png, 10);
    await recovery.write(b, 'Poster', new Uint8Array([4]), undefined, 20);
    const items = await recovery.list();
    expect(items.map((i) => [i.name, i.savedAt, i.thumbnail?.length ?? null])).toEqual([
      ['Poster', 20, null],
      ['Holiday', 10, png.length],
    ]);
    expect(await recovery.read(a)).toEqual(new Uint8Array([1, 2, 3]));
    await recovery.discard(a);
    await recovery.discard(a); // twice is fine
    expect((await recovery.list()).map((i) => i.name)).toEqual(['Poster']);
    expect(readdirSync(dir).sort()).toEqual([`${b}.iep`, `${b}.json`]);
  });

  it('rejects ids that are not UUIDs (no path tricks)', async () => {
    const { recovery } = store();
    await expect(recovery.write('../../evil', 'x', new Uint8Array(1))).rejects.toThrow();
    await expect(recovery.read('../settings')).rejects.toThrow();
  });

  it('skips damaged or mismatched metadata', async () => {
    const { dir, recovery } = store();
    writeFileSync(join(dir, `${a}.json`), '{ nope');
    writeFileSync(join(dir, `${b}.json`), JSON.stringify({ id: a, name: 'x', savedAt: 1 }));
    expect(await recovery.list()).toEqual([]);
  });
});
