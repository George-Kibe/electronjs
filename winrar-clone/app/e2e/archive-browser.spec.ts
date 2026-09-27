import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createArchive, rarFixtures, tempDir } from '../test/helpers/seven-zip';
import { launch, snapshot, target } from './app';

const tmp = tempDir();
const zip = join(tmp.path, 'nested.zip');
const encrypted = join(tmp.path, 'secret-headers.7z');
const junk = join(tmp.path, 'not-really.zip');

test.beforeAll(async () => {
  const src = join(tmp.path, 'src');
  mkdirSync(join(src, 'photos', 'kenya'), { recursive: true });
  writeFileSync(join(src, 'readme.txt'), 'hello');
  writeFileSync(join(src, 'photos', 'kenya', 'nairobi.jpg'), 'x'.repeat(2048));
  writeFileSync(join(src, 'photos', 'mombasa.jpg'), 'y'.repeat(4096));
  await createArchive(zip, src, ['-tzip']);
  await createArchive(encrypted, src, ['-t7z', '-mhe=on', '-psecret']);
  writeFileSync(junk, 'this is not an archive');
});
test.afterAll(() => tmp.cleanup());

test(`[${target}] uses the bundled 7-Zip engine`, async () => {
  const { app, win } = await launch();
  const info = await win.evaluate(() => window.api.app.getInfo());
  expect(info.ok).toBe(true);
  expect(info.ok && info.data).toMatchObject({
    productName: 'WinrarClone',
    sevenZipVersion: '26.03',
    platform: process.platform,
  });
  await expect(win.getByRole('button', { name: 'Open archive…' })).toBeVisible();
  await snapshot(win, 'home');
  await app.close();
});

test(`[${target}] opens a RAR5 multi-volume set from its middle volume`, async () => {
  const { app, win } = await launch([join(rarFixtures, 'rar5-multi-solid.part02.rar')]);
  await expect(win.getByRole('heading', { name: 'rar5-multi-solid.part01.rar' })).toBeVisible();
  await expect(win.getByText('Rar5 · solid · 4 volumes')).toBeVisible();
  await expect(win.getByText('cebula.txt')).toBeVisible();
  await expect(win.getByText('elf-Linux-ARMv7-ls')).toBeVisible();
  await expect(win.getByText(/^9 files · 0 folders/)).toBeVisible();
  await snapshot(win, 'rar5-multi');
  await app.close();
});

test(`[${target}] opens RAR4 and shows symlink targets`, async () => {
  const { app, win } = await launch([join(rarFixtures, 'rar5-symlink.rar')]);
  await expect(win.getByText('→ file.txt')).toBeVisible();
  await app.close();

  const rar4 = await launch([join(rarFixtures, 'rar4-basic.rar')]);
  await expect(rar4.win.getByRole('heading', { name: 'rar4-basic.rar' })).toBeVisible();
  await expect(rar4.win.getByRole('button', { name: /testdir/ })).toBeVisible();
  await rar4.app.close();
});

test(`[${target}] navigates folders, sorts and filters a ZIP`, async () => {
  const { app, win } = await launch([zip]);
  await expect(win.getByRole('heading', { name: 'nested.zip' })).toBeVisible();
  await win.getByRole('button', { name: '📁 photos' }).click();
  await expect(win.getByText('mombasa.jpg')).toBeVisible();
  await win.getByRole('button', { name: '📁 kenya' }).click();
  await expect(win.getByText('nairobi.jpg')).toBeVisible();
  await expect(win.getByRole('navigation', { name: 'Folder path' })).toContainText('photos/kenya');

  await win.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'photos' }).click();
  await win.getByRole('searchbox', { name: 'Filter entries in this folder' }).fill('momb');
  await expect(win.getByText('mombasa.jpg')).toBeVisible();
  await expect(win.getByRole('button', { name: '📁 kenya' })).toHaveCount(0);
  await snapshot(win, 'zip-browser');

  await win.getByRole('button', { name: 'Close archive' }).click();
  await expect(win.getByRole('button', { name: 'Open archive…' })).toBeVisible();
  await app.close();
});

test(`[${target}] asks for the password of an archive with encrypted headers`, async () => {
  const { app, win } = await launch([encrypted]);
  const dialog = win.getByRole('dialog', { name: 'Password required' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill('wrong');
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('That password is incorrect. Try again.');
  await snapshot(win, 'password');
  await dialog.getByLabel('Password', { exact: true }).fill('secret');
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(win.getByRole('heading', { name: 'secret-headers.7z' })).toBeVisible();
  await expect(win.getByText('🔒 encrypted', { exact: false })).toBeVisible();
  await expect(win.getByText('readme.txt')).toBeVisible();
  await app.close();
});

test(`[${target}] explains when a file is not an archive`, async () => {
  const { app, win } = await launch([junk]);
  await expect(win.getByRole('alert')).toContainText('not an archive');
  await app.close();
});

test(`[${target}] enforces the Electron security baseline at runtime`, async () => {
  const { app, win } = await launch();
  const renderer = await win.evaluate(async () => {
    const g = globalThis as Record<string, unknown>;
    let networkBlocked = false;
    try {
      await fetch('https://example.com');
    } catch {
      networkBlocked = true;
    }
    return {
      require: typeof g['require'],
      process: typeof g['process'],
      module: typeof g['module'],
      apiKeys: Object.keys(window.api).sort(),
      networkBlocked,
    };
  });
  expect(renderer).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    apiKeys: ['app', 'archive', 'dialog', 'files'],
    networkBlocked: true,
  });

  // Navigation away from the app and new windows are blocked.
  const before = win.url();
  await win.evaluate(() => {
    window.open('https://example.com');
    location.href = 'https://example.com';
  });
  await win.waitForTimeout(500);
  expect(win.url()).toBe(before);
  expect(app.windows()).toHaveLength(1);
  await app.close();
});
