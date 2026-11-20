import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { docCanvas, launch, paintLine, stubSaveDialog, target, zoomField } from './app';

/**
 * The M1 exit journeys (docs/07 §4, docs/10 M1), end to end and checked in the exported file:
 * journey 1 without the text step (M3) and journey 2 without the Levels adjustment layer (M2).
 */
const dir = mkdtempSync(join(tmpdir(), 'ie-e2e-journeys-'));
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Page coordinates of a document pixel's centre (the document fits at 100 %). */
async function docToPage(win: Page, w: number, h: number) {
  await expect(win.locator('footer')).toContainText(`${w} × ${h} px`);
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - w) / 2);
  const oy = box.y + Math.round((box.height - h) / 2);
  return (x: number, y: number): [number, number] => [ox + x + 0.5, oy + y + 0.5];
}

/** RGBA of a pixel in an image file. */
async function filePixel(path: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [...data.subarray(i, i + 4)];
}

test(`[${target}] journey 1: new document → brush strokes → new layer → export PNG, pixels verified`, async () => {
  const { app, win, close } = await launch();
  const form = win.getByRole('form', { name: 'New document' });
  await form.getByRole('spinbutton', { name: 'Width' }).fill('300');
  await form.getByRole('spinbutton', { name: 'Height' }).fill('200');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  const at = await docToPage(win, 300, 200);
  const size = win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' });
  await size.fill('20');

  // A stroke on the white background, then one on a new layer at half opacity.
  await paintLine(win, at(40, 50), at(140, 50));
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await expect(win.getByRole('option', { name: /Layer 1/ })).toHaveAttribute('aria-selected', 'true');
  await paintLine(win, at(40, 150), at(140, 150));
  const opacity = win.getByRole('slider', { name: 'Layer opacity' });
  await opacity.fill('50');
  await opacity.blur(); // shortcuts are ignored while a control has focus
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Brush');

  const out = join(dir, 'journey-1');
  await stubSaveDialog(app, out);
  await win.keyboard.press('ControlOrMeta+Alt+Shift+Quote'); // Quick Export as PNG
  await expect(win.getByRole('status').filter({ hasText: 'Exported journey-1.png' })).toBeVisible({
    timeout: 20_000,
  });
  const png = `${out}.png`;
  const meta = await sharp(png).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(['png', 300, 200]);
  expect(await filePixel(png, 90, 50)).toEqual([0, 0, 0, 255]); // background stroke: black
  expect(await filePixel(png, 250, 50)).toEqual([255, 255, 255, 255]); // untouched: white
  // Layer stroke at 50 %: halfway between black and white (±2 for rounding).
  const [r, g, b, a] = await filePixel(png, 90, 150);
  for (const c of [r!, g!, b!]) expect(Math.abs(c - 128)).toBeLessThanOrEqual(2);
  expect(a).toBe(255);
  await close();
});

test(`[${target}] journey 2: open photo → crop 4:5 → export JPEG without location data`, async () => {
  const photo = join(dir, 'holiday.jpg');
  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 120, b: 200 } } })
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
  await expect(win.locator('footer')).toContainText('400 × 300 px');
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });

  // Crop (C) with the 4:5 preset: the largest centred 4:5 box is 240 × 300.
  await win.keyboard.press('c');
  const options = win.getByRole('toolbar', { name: 'Tool options' });
  await options.getByRole('combobox', { name: 'Ratio' }).selectOption('4:5');
  await expect(options.getByRole('spinbutton', { name: 'Crop width' })).toHaveValue('240');
  await win.keyboard.press('Enter');
  await expect(win.locator('footer')).toContainText('240 × 300 px');
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Crop');

  const out = join(dir, 'journey-2.jpg');
  await stubSaveDialog(app, out);
  await win.keyboard.press('ControlOrMeta+Alt+Shift+KeyW');
  const dialog = win.getByRole('dialog', { name: 'Export As' });
  await dialog.getByRole('combobox').first().selectOption('jpeg');
  await dialog.getByRole('combobox', { name: 'Metadata' }).selectOption('remove-gps');
  await expect(dialog).toContainText(/Estimated size: [\d.]+ KB/, { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Export…' }).click();
  await expect(win.getByRole('status').filter({ hasText: 'Exported journey-2.jpg' })).toBeVisible({
    timeout: 20_000,
  });

  const meta = await sharp(out).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 240, 300]);
  const exif = Buffer.from(meta.exif!);
  expect(exif.toString('latin1')).toContain('Acme'); // camera data kept
  expect(exif.includes(Buffer.from([0x25, 0x88]))).toBe(false); // no GPS IFD pointer tag
  expect(meta.icc).toBeDefined(); // tagged sRGB
  const [r, g, b] = await filePixel(out, 120, 150);
  expect(Math.abs(r! - 30) + Math.abs(g! - 120) + Math.abs(b! - 200)).toBeLessThan(15); // the photo's colour
  await close();
});
