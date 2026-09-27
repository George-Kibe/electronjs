import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { binary, createArchive, hasBinary, rarFixtures, tempDir } from '../../../test/helpers/seven-zip';
import { SevenZipEngine } from './engine';
import { EngineError } from './errors';

describe.skipIf(!hasBinary)('SevenZipEngine (real bundled 7-Zip)', () => {
  const engine = new SevenZipEngine(binary);
  const tmp = tempDir();
  const src = join(tmp.path, 'src');
  const zip = join(tmp.path, 'plain.zip');
  const encHeaders = join(tmp.path, 'hidden.7z');
  const trickyNames = join(tmp.path, 'tricky.zip');

  beforeAll(async () => {
    mkdirSync(join(src, 'docs'), { recursive: true });
    writeFileSync(join(src, 'readme.txt'), 'hello');
    writeFileSync(join(src, 'docs', 'ünïcødé.txt'), 'world');
    await createArchive(zip, src, ['-tzip']);
    await createArchive(encHeaders, src, ['-t7z', '-mhe=on', '-psecret']);

    // A file literally named like 7-Zip's prompt must not be mistaken for a password prompt.
    // (':' is not allowed in Windows file names, so this fixture is POSIX-only.)
    if (process.platform !== 'win32') {
      const tricky = join(tmp.path, 'tricky');
      mkdirSync(tricky);
      writeFileSync(join(tricky, 'Enter password:'), 'x');
      await createArchive(trickyNames, tricky, ['-tzip']);
    }
  });
  afterAll(() => tmp.cleanup());

  it('reports its version', async () => {
    expect(await engine.version()).toMatch(/^\d+\.\d+$/);
  });

  it('lists a ZIP', async () => {
    const listing = await engine.list(zip);
    expect(listing.props['Type']).toBe('zip');
    expect(listing.encryptedHeaders).toBe(false);
    expect(listing.entries.map((e) => e.path).sort()).toEqual(['docs', 'docs/ünïcødé.txt', 'readme.txt']);
  });

  it('lists a RAR5 multi-volume set when opened from a middle volume', async () => {
    const listing = await engine.list(join(rarFixtures, 'rar5-multi-solid.part03.rar'));
    expect(listing.archivePath).toBe(join(rarFixtures, 'rar5-multi-solid.part01.rar'));
    expect(listing.props['Volumes']).toBe('4');
    expect(listing.warnings).toEqual([]);
    expect(listing.entries).toHaveLength(9);
  });

  it('lists RAR4', async () => {
    const listing = await engine.list(join(rarFixtures, 'rar4-basic.rar'));
    expect(listing.props['Type']).toBe('Rar');
    expect(listing.entries.length).toBeGreaterThan(0);
  });

  it('asks for a password for encrypted headers, via stdin', async () => {
    const onPasswordPrompt = vi.fn(async () => 'secret');
    const listing = await engine.list(encHeaders, { onPasswordPrompt });
    expect(onPasswordPrompt).toHaveBeenCalledOnce();
    expect(listing.encryptedHeaders).toBe(true);
    expect(listing.entries.map((e) => e.path)).toContain('readme.txt');
  });

  it('returns PASSWORD_REQUIRED when no password is available', async () => {
    await expect(engine.list(encHeaders)).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
  });

  it('returns WRONG_PASSWORD for an incorrect password', async () => {
    await expect(engine.list(encHeaders, { password: 'nope' })).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    });
  });

  it('lists archives whose data (not headers) is encrypted without asking', async () => {
    const onPasswordPrompt = vi.fn(async () => null);
    const listing = await engine.list(join(rarFixtures, 'rar5-encrypted.rar'), { onPasswordPrompt });
    expect(onPasswordPrompt).not.toHaveBeenCalled();
    expect(listing.entries.some((e) => e.encrypted)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'does not treat a file named "Enter password:" as a prompt',
    async () => {
      const onPasswordPrompt = vi.fn(async () => null);
      const listing = await engine.list(trickyNames, { onPasswordPrompt });
      expect(onPasswordPrompt).not.toHaveBeenCalled();
      expect(listing.entries.map((e) => e.path)).toContain('Enter password:');
    },
  );

  it('rejects non-archives with NOT_ARCHIVE', async () => {
    const junk = join(tmp.path, 'junk.zip');
    writeFileSync(junk, 'definitely not a zip file');
    await expect(engine.list(junk)).rejects.toMatchObject({ code: 'NOT_ARCHIVE' });
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const pending = engine.list(encHeaders, {
      onPasswordPrompt: () => {
        controller.abort();
        return new Promise(() => undefined); // never answers
      },
      signal: controller.signal,
    });
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('fails clearly when the engine binary is missing', async () => {
    const missing = new SevenZipEngine(join(tmp.path, 'nope', '7zz'));
    await expect(missing.list(zip)).rejects.toBeInstanceOf(EngineError);
    await expect(missing.list(zip)).rejects.toMatchObject({ code: 'ENGINE_MISSING' });
  });
});
