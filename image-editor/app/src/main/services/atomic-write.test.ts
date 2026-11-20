import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'ie-atomic-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const OLD = Buffer.alloc(1024 * 1024, 0x11);
const NEW_BYTES = 32 * 1024 * 1024;
const NEW_FILL = 0x22;

/**
 * A separate Node process saves over `target` with the real writeAtomic (Node strips the module's types).
 * It prints "writing" just before the call, so the test can kill it during the save.
 */
function saver(target: string) {
  const mod = pathToFileURL(join(import.meta.dirname, 'atomic-write.ts')).href;
  const script = `
    const { writeAtomic } = await import(${JSON.stringify(mod)});
    const data = new Uint8Array(${NEW_BYTES}).fill(${NEW_FILL});
    process.stdout.write('writing\\n');
    await writeAtomic(${JSON.stringify(target)}, data);
    process.stdout.write('done\\n');
  `;
  return spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/** The file is exactly the old bytes or exactly the new ones; anything else is a torn save. */
function contentIs(target: string): 'old' | 'new' | 'torn' {
  const bytes = readFileSync(target);
  if (bytes.equals(OLD)) return 'old';
  if (bytes.byteLength === NEW_BYTES && bytes.every((b) => b === NEW_FILL)) return 'new';
  return 'torn';
}

describe('T-IO-04: a save killed at any moment leaves the original or the new file, never a torn one', () => {
  it('SIGKILL during the write keeps the original intact', { timeout: 60_000 }, async () => {
    const outcomes: string[] = [];
    // Kill at a spread of moments after the save starts: before, during and (sometimes) after the rename.
    for (const delayMs of [0, 1, 3, 8, 15, 30, 60, 120]) {
      const target = join(dir, `doc-${delayMs}.iep`);
      writeFileSync(target, OLD);
      const child = saver(target);
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      let finished = false;
      let started = false;
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('done')) finished = true;
        if (text.includes('writing')) {
          started = true;
          setTimeout(() => child.kill('SIGKILL'), delayMs);
        }
      });
      await exited;
      expect(started, 'the saver process started its save').toBe(true);
      const state = contentIs(target);
      outcomes.push(state);
      expect(state, `killed ${delayMs} ms into the save`).not.toBe('torn');
      if (finished) expect(state).toBe('new');
    }
    // The earliest kills must land mid-save, or the test proves nothing.
    expect(outcomes[0]).toBe('old');
    // A killed save leaves at most its hidden temp file next to the document, never a partial document.
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.tmp')))
      expect(name).toMatch(/^\.doc-\d+\.iep\.[0-9a-f]{12}\.tmp$/);
  });

  it('a completed save replaces the file in full', { timeout: 30_000 }, async () => {
    const target = join(dir, 'complete.iep');
    writeFileSync(target, OLD);
    const child = saver(target);
    await new Promise<void>((done) => child.once('exit', () => done()));
    expect(contentIs(target)).toBe('new');
    expect(statSync(target).size).toBe(NEW_BYTES);
  });
});
