import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeAtomic } from './atomic-write';
import { MAX_RECENT, RecentFiles } from './recent-files';

const dirs: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ie-recent-'));
  dirs.push(dir);
  const file = (name: string) => {
    const p = join(dir, name);
    writeFileSync(p, 'x');
    return p;
  };
  return { dir, file, recent: new RecentFiles({ dir, writeAtomic }) };
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n]);

describe('RecentFiles (FR-DOC-02, FR-GEN-08)', () => {
  it('keeps the newest first, without duplicates, with thumbnails, and persists', async () => {
    const { dir, file, recent } = setup();
    const a = file('a.png');
    const b = file('b.iep');
    await recent.add(a, png(1), 1);
    await recent.add(b, undefined, 2);
    await recent.add(a, undefined, 3); // reopened: moves to the top, keeps its thumbnail
    const items = await recent.list();
    expect(items.map((i) => [i.displayName, i.openedAt])).toEqual([
      ['a.png', 3],
      ['b.iep', 2],
    ]);
    expect(items[0]!.thumbnail).toEqual(png(1));
    expect(items[1]!.thumbnail).toBeNull();
    for (const i of items) expect(i.id).toMatch(/^[0-9a-f]{16}$/); // opaque: never a path
    expect(new RecentFiles({ dir, writeAtomic }).resolve(items[0]!.id)).toBe(a);
  });

  it(`keeps at most ${MAX_RECENT} entries and deletes the thumbnails that fall off`, async () => {
    const { dir, file, recent } = setup();
    for (let i = 0; i < MAX_RECENT + 3; i++) await recent.add(file(`f${i}.png`), png(i), i);
    expect(await recent.list()).toHaveLength(MAX_RECENT);
    expect(readdirSync(join(dir, 'thumbs'))).toHaveLength(MAX_RECENT);
  });

  it('rejects thumbnails that are not small PNGs', async () => {
    const { file, recent } = setup();
    await recent.add(file('a.png'), new Uint8Array([1, 2, 3]));
    expect((await recent.list())[0]!.thumbnail).toBeNull();
  });

  it('reports files that no longer exist, and removes and clears entries with their thumbnails', async () => {
    const { dir, file, recent } = setup();
    const gone = file('gone.png');
    await recent.add(gone, png(1));
    await recent.add(file('kept.png'), png(2));
    rmSync(gone);
    const items = await recent.list();
    expect(items.find((i) => i.displayName === 'gone.png')!.exists).toBe(false);
    await recent.remove(items.find((i) => i.displayName === 'gone.png')!.id);
    expect((await recent.list()).map((i) => i.displayName)).toEqual(['kept.png']);
    await recent.clear();
    expect(await recent.list()).toEqual([]);
    expect(readdirSync(join(dir, 'thumbs'))).toEqual([]);
  });

  it('starts empty from a damaged list', () => {
    const { dir } = setup();
    writeFileSync(join(dir, 'recent.json'), '{"version":1,"entries":"nope"}');
    expect(new RecentFiles({ dir, writeAtomic }).menuItems()).toEqual([]);
    expect(existsSync(join(dir, 'thumbs'))).toBe(true);
  });
});
