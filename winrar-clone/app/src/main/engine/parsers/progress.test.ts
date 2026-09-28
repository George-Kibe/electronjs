import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LineSplitter } from './lines';
import { parseFileLine, parseProgress } from './progress';

describe('parseProgress', () => {
  it.each([
    ['  0%', { percent: 0, files: null, current: null }],
    [' 64% 12 - kenya/IMG_2231.jpg', { percent: 64, files: 12, current: 'kenya/IMG_2231.jpg' }],
    [' 50% 2', { percent: 50, files: 2, current: null }],
    ['100%', { percent: 100, files: null, current: null }],
  ])('%j', (segment, expected) => {
    expect(parseProgress(segment)).toEqual(expected);
  });

  it('ignores non-progress text', () => {
    expect(parseProgress('Extracting archive: a.7z')).toBeNull();
    expect(parseProgress('Everything is Ok')).toBeNull();
  });

  it('reads percentages and file names from real -bsp1 -bb1 output (backspace redraws)', () => {
    const raw = readFileSync(
      join(import.meta.dirname, '../__fixtures__/linux-26.03/extract-progress-stdout.bin'),
      'utf8',
    );
    const percents: number[] = [];
    const files: string[] = [];
    const splitter = new LineSplitter((line) => {
      const p = parseProgress(line);
      if (p) percents.push(p.percent);
      const f = parseFileLine(line.trim());
      if (f) files.push(f);
    });
    splitter.push(raw);
    splitter.end();
    expect(percents.length).toBeGreaterThan(0);
    expect(percents).toEqual([...percents].sort((a, b) => a - b)); // monotonic
    expect(files).toEqual(expect.arrayContaining(['d/f1.bin', 'big.bin']));
  });
});

describe('LineSplitter', () => {
  it('handles chunks split mid-line and keeps blank \\n lines', () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push('Path = a');
    s.push('.txt\r\n\nSize = 1\n');
    expect(lines).toEqual(['Path = a.txt', '', 'Size = 1']);
  });

  it('treats \\r\\n split across chunks as a single newline', () => {
    const lines: string[] = [];
    const s = new LineSplitter((l, t) => lines.push(`${t === '\n' ? 'NL' : 'CR'}:${l}`));
    s.push('Type = zip\r');
    s.push('\n\r\nPath = x\r\n 5%\r 9%\r');
    s.push('\n');
    expect(lines).toEqual(['NL:Type = zip', 'NL:', 'NL:Path = x', 'CR: 5%', 'NL: 9%']);
  });

  it('exposes an unterminated prompt as pending', () => {
    const s = new LineSplitter(() => undefined);
    s.push('\nEnter password:');
    expect(s.pending()).toBe('Enter password:');
  });
});
