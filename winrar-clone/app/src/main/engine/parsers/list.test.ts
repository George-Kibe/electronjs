import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LineSplitter } from './lines';
import { ListParser, parseList } from './list';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '../__fixtures__/linux-26.03', name), 'utf8');

describe('parseList (captured 7-Zip 26.03 output)', () => {
  it('parses a solid multi-volume RAR5 opened from part01', () => {
    const { props, entries, warnings } = parseList(fixture('list-rar5-multi.txt'));
    expect(props).toMatchObject({ Type: 'Rar5', Solid: '+', Multivolume: '+', Volumes: '4' });
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(9);
    expect(entries[0]).toMatchObject({
      path: 'cebula.txt',
      isDir: false,
      size: 814,
      packed: 659,
      crc: '7E5EC49E',
      encrypted: false,
      link: null,
    });
  });

  it('parses RAR4 entries including folders', () => {
    const { props, entries } = parseList(fixture('list-rar4.txt'));
    expect(props['Type']).toBe('Rar');
    const dirs = entries.filter((e) => e.isDir).map((e) => e.path);
    expect(dirs).toEqual(expect.arrayContaining(['testdir', 'testemptydir']));
    expect(entries.find((e) => e.path === 'testdir/test.txt')?.size).toBe(20);
  });

  it('exposes symlink targets', () => {
    const { entries } = parseList(fixture('list-rar5-symlink.txt'));
    expect(entries.find((e) => e.path === 'symlink.txt')?.link).toEqual({
      kind: 'symlink',
      target: 'file.txt',
    });
    expect(entries.find((e) => e.path === 'dirlink')?.link).toEqual({ kind: 'symlink', target: 'dir' });
    expect(entries.find((e) => e.path === 'file.txt')?.link).toBeNull();
  });

  it('keeps unicode names and names starting with a dash', () => {
    const paths = parseList(fixture('list-zip-unicode.txt')).entries.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['-dash.txt', 'dir with space/ünïcødé 日本.txt']));
  });

  it('yields no entries when the archive cannot be opened', () => {
    expect(parseList(fixture('list-rar5-encrypted-headers-wrong.txt')).entries).toEqual([]);
  });

  it('collects ERRORS inside the archive property block as warnings', () => {
    const output = [
      '--',
      'Path = a.rar',
      'Type = Rar5',
      'ERRORS:',
      'Headers Error',
      'Physical Size = 10',
      '',
    ].join('\n');
    const { props, warnings } = parseList(output);
    expect(warnings).toEqual(['Headers Error']);
    expect(props['Physical Size']).toBe('10');
  });

  it('streams entries to a callback and normalises backslashes', () => {
    const seen: string[] = [];
    const parser = new ListParser((e) => seen.push(e.path));
    for (const line of [
      '--',
      'Type = zip',
      '----------',
      'Path = a\\b.txt',
      'Size = 1',
      '',
      'Path = c',
      'Folder = +',
      '',
    ])
      parser.line(line);
    parser.end();
    expect(seen).toEqual(['a/b.txt', 'c']);
  });

  it('parses Windows (CRLF) output identically, even when chunks split the line ending', () => {
    const unix = fixture('list-rar4.txt');
    const crlf = unix.replaceAll('\n', '\r\n');
    const parser = new ListParser();
    const splitter = new LineSplitter((line, term) => term === '\n' && parser.line(line));
    for (let i = 0; i < crlf.length; i += 7) splitter.push(crlf.slice(i, i + 7));
    splitter.end();
    expect(parser.end()).toEqual(parseList(unix));
  });
});
