import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { canvasPixel, launch, paintLine, stubSaveDialog, target, docCanvas } from './app';

const dir = mkdtempSync(join(tmpdir(), 'ie-e2e-files-'));
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function newDocument(win: Page, width: number, height: number): Promise<void> {
  await win.getByRole('spinbutton').nth(0).fill(String(width));
  await win.getByRole('spinbutton').nth(1).fill(String(height));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

async function canvasCentre(win: Page): Promise<[number, number]> {
  const box = (await docCanvas(win).boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2];
}

const documentLabel = (win: Page) => win.getByLabel('Document', { exact: true });

test(`[${target}] saves a project and reopens it with layers and pixels intact (FR-DOC-04/11)`, async () => {
  const saved = join(dir, 'artwork'); // no extension: the app must add .iep
  {
    const { app, win, close } = await launch();
    await newDocument(win, 400, 300);
    await win.getByRole('button', { name: 'New layer' }).click();
    const [cx, cy] = await canvasCentre(win);
    await paintLine(win, [cx - 50, cy], [cx + 50, cy]);
    await expect(win.getByRole('list', { name: 'History' })).toContainText('Brush');
    await expect(documentLabel(win)).toContainText('•'); // unsaved changes

    await stubSaveDialog(app, saved);
    await win.keyboard.press('ControlOrMeta+s');
    await expect(documentLabel(win)).toHaveText('artwork.iep');
    expect(await win.title()).toBe('artwork.iep — ImageEditor');
    await close();
  }
  const file = `${saved}.iep`;
  expect(existsSync(file)).toBe(true);
  const bytes = readFileSync(file);
  expect(bytes.subarray(30, 38).toString('latin1')).toBe('mimetype'); // zip with mimetype first

  const { win, close } = await launch([file]);
  await expect(documentLabel(win)).toHaveText('artwork.iep');
  await expect(win.getByRole('option', { name: /Layer 1/ })).toBeVisible();
  await expect(win.getByRole('option', { name: /Background/ })).toBeVisible();
  await expect(win.locator('footer')).toContainText('400 × 300 px');
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  const [cx, cy] = await canvasCentre(win);
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]); // the stroke came back
  await close();
});

test(`[${target}] exports JPEG without location data and Quick Exports PNG (FR-DOC-05/06/09)`, async () => {
  const photo = join(dir, 'gps-photo.jpg');
  await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .withExif({
      IFD0: { Make: 'Acme', Model: 'Shooter' },
      IFD3: {
        GPSLatitudeRef: 'S',
        GPSLatitude: '1/1 17/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '36/1 49/1 0/1',
      },
    })
    .jpeg({ quality: 95 })
    .toFile(photo);

  const { app, win, close } = await launch([photo]);
  await expect(win.locator('footer')).toContainText('320 × 240 px');

  const out = join(dir, 'shared.jpg');
  await stubSaveDialog(app, out);
  await win.keyboard.press('ControlOrMeta+Alt+Shift+KeyW');
  const dialog = win.getByRole('dialog', { name: 'Export As' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').first().selectOption('jpeg');
  await expect(dialog).toContainText(/Estimated size: [\d.]+ KB/, { timeout: 20_000 });
  await expect(dialog.getByRole('img', { name: 'Exported result' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Export…' }).click();
  await expect(win.getByRole('status').filter({ hasText: 'Exported shared.jpg' })).toBeVisible({
    timeout: 20_000,
  });

  const meta = await sharp(out).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 320, 240]);
  const exif = Buffer.from(meta.exif!);
  expect(exif.toString('latin1')).toContain('Acme');
  expect(exif.includes(Buffer.from([0x25, 0x88]))).toBe(false); // no GPS IFD pointer tag
  expect(meta.icc).toBeDefined(); // sRGB embedded

  const quick = join(dir, 'quick');
  await stubSaveDialog(app, quick);
  await win.keyboard.press('ControlOrMeta+Alt+Shift+Quote');
  await expect(win.getByRole('status').filter({ hasText: 'Exported quick.png' })).toBeVisible({
    timeout: 20_000,
  });
  const png = await sharp(`${quick}.png`).metadata();
  expect([png.format, png.width, png.height]).toEqual(['png', 320, 240]);
  await close();
});

test(`[${target}] asks to save unsaved changes when the window is closed (FR-DOC-11)`, async () => {
  const { app, win, close } = await launch();
  await newDocument(win, 300, 200);
  const [cx, cy] = await canvasCentre(win);
  await paintLine(win, [cx - 30, cy], [cx + 30, cy]);
  await expect(documentLabel(win)).toContainText('•');

  const closeWindow = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await closeWindow();
  const prompt = win.getByRole('dialog', { name: 'Save changes?' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt).toBeHidden();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  await closeWindow();
  await win
    .getByRole('dialog', { name: 'Save changes?' })
    .getByRole('button', { name: 'Don’t Save' })
    .click();
  // The window closes (on Windows/Linux the app then quits, so evaluate may fail: that counts as closed).
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0))
    .toBe(0);
  await close();
});
