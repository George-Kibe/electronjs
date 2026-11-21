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

  // A Levels adjustment layer (M2): output white 240 darkens the highlights a little.
  await win.getByRole('button', { name: 'New adjustment layer' }).click();
  await win.getByRole('menuitem', { name: /Levels/ }).click();
  await win
    .getByRole('region', { name: 'Levels properties' })
    .getByRole('spinbutton', { name: 'Output white' })
    .fill('240');
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Levels');
  // Leave the field: shortcuts are ignored while typing in one.
  await win
    .getByRole('region', { name: 'Levels properties' })
    .getByRole('spinbutton', { name: 'Output white' })
    .blur();

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
  // The photo's colour (30, 120, 200) through Levels: × 240/255.
  expect(Math.abs(r! - 28) + Math.abs(g! - 113) + Math.abs(b! - 188)).toBeLessThan(15);
  await close();
});

/** Clicks a native menu item by its label path (Playwright cannot open native menus). */
async function menu(app: import('@playwright/test').ElectronApplication, path: string[]): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    let items = Menu.getApplicationMenu()!.items;
    let item;
    for (const label of labels) {
      item = items.find((i) => i.label === label)!;
      items = item.submenu?.items ?? [];
    }
    item!.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  }, path);
}

test(`[${target}] journey 4: marquee → feather → Gaussian blur inside the selection only (FR-FLT-01)`, async () => {
  const { app, win, close } = await launch();
  await win.getByRole('spinbutton').nth(0).fill('300');
  await win.getByRole('spinbutton').nth(1).fill('200');
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  const at = await docToPage(win, 300, 200);
  const pixel = (p: [number, number]) => import('./app').then(({ canvasPixel }) => canvasPixel(win, ...p));
  await win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' }).fill('20');
  await paintLine(win, at(10, 100), at(290, 100)); // a black bar across the whole width
  await expect.poll(() => pixel(at(220, 100))).toEqual([0, 0, 0]);

  // Marquee (M) around the left half of the bar, feathered by 5 px.
  await win.keyboard.press('m');
  await win.mouse.move(...at(40, 40));
  await win.mouse.down();
  await win.mouse.move(...at(160, 160), { steps: 8 });
  await win.mouse.up();
  await win.keyboard.press('Shift+F6');
  const feather = win.getByRole('dialog', { name: 'Feather Selection' });
  await feather.getByRole('spinbutton', { name: 'Feather radius' }).fill('5');
  await feather.getByRole('button', { name: 'OK' }).click();
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Feather'); // feathering is a job

  // Filter › Blur › Gaussian Blur…, radius 10: the canvas previews it; OK applies it.
  await menu(app, ['Filter', 'Blur', 'Gaussian Blur…']);
  const dialog = win.getByRole('dialog', { name: 'Gaussian Blur' });
  await dialog.getByRole('spinbutton', { name: 'Radius' }).fill('10');
  await expect.poll(async () => (await pixel(at(100, 86)))[0]).toBeLessThan(250); // the preview
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Gaussian Blur', {
    timeout: 30_000,
  });
  // Inside: the bar's edge is soft; outside: untouched.
  await expect.poll(async () => (await pixel(at(100, 86)))[0]).toBeLessThan(250);
  await expect.poll(async () => (await pixel(at(100, 86)))[0]).toBeGreaterThan(120);
  await expect.poll(() => pixel(at(230, 86))).toEqual([255, 255, 255]);
  await expect.poll(() => pixel(at(230, 100))).toEqual([0, 0, 0]);
  await close();
});

test(`[${target}] NFR-PERF-05: Gaussian blur radius 50 on a 24 MP layer`, async () => {
  const { app, win, close } = await launch();
  await win.getByRole('spinbutton').nth(0).fill('6000');
  await win.getByRole('spinbutton').nth(1).fill('4000');
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText('6000 × 4000 px', { timeout: 15_000 });
  await menu(app, ['Filter', 'Blur', 'Gaussian Blur…']);
  const dialog = win.getByRole('dialog', { name: 'Gaussian Blur' });
  await dialog.getByRole('spinbutton', { name: 'Radius' }).fill('50');
  // The preview (the whole image at this zoom) runs on the same workers: let it finish first.
  await expect(dialog.getByRole('status')).toHaveText('', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  const runs = () =>
    win.evaluate(() => performance.getEntriesByName('job:Gaussian Blur').map((e) => e.duration));
  await expect.poll(async () => (await runs()).length, { timeout: 120_000 }).toBe(1);
  // Again with the workers warm (Filter › Last Filter), as the second and later filters run.
  await win.keyboard.press('ControlOrMeta+Alt+f');
  await expect.poll(async () => (await runs()).length, { timeout: 120_000 }).toBe(2);
  const [first, warm] = await runs();
  const cores = await win.evaluate(() => navigator.hardwareConcurrency);
  const line = `${warm!.toFixed(0)} ms (first run ${first!.toFixed(0)} ms) on ${cores} threads`;
  test.info().annotations.push({ type: 'gaussian-50-24mp', description: line });
  console.log(`[${process.platform}/${target}] Gaussian blur r=50 on 24 MP: ${line}`);
  expect(warm).toBeGreaterThan(0);
  await close();
});
