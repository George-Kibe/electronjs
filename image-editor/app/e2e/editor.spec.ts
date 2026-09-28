import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { canvasPixel, launch, paintLine, snapshot, target } from './app';

const dir = mkdtempSync(join(tmpdir(), 'ie-e2e-'));
const photo = join(dir, 'phone-photo.jpg');
const junk = join(dir, 'not-an-image.png');

test.beforeAll(async () => {
  // 640×480 stored sideways with EXIF orientation 6 → displays as 480×640; light grey so strokes stand out.
  await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 95 })
    .toFile(photo);
  writeFileSync(junk, 'not an image');
});
test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

test(`[${target}] opens a phone photo upright, paints on a new layer, undoes and redoes`, async () => {
  const { win, close } = await launch([photo]);
  const status = win.getByRole('status').first();
  await expect(status).toContainText('480 × 640 px'); // EXIF orientation applied (FR-DOC-09)
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Open');

  // If the GPU context was lost, painting must wait for recovery (restore or a fresh canvas).
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  console.log(`[${process.platform}/${target}] GPU: ${await win.locator('footer').innerText()}`);
  await win.getByRole('button', { name: 'New layer' }).click();
  await expect(win.getByRole('option', { name: /Layer 1/ })).toHaveAttribute('aria-selected', 'true');

  const box = (await win.locator('canvas').boundingBox())!;
  const cy = box.y + box.height / 2;
  const cx = box.x + box.width / 2;
  const before = await canvasPixel(win, cx, cy);
  expect(before[0]).toBeGreaterThan(180); // grey photo

  await paintLine(win, [cx - 60, cy], [cx + 60, cy]);
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Brush');
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]); // default black, hard, opaque
  await snapshot(win, 'painted');

  await win.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await canvasPixel(win, cx, cy))[0]).toBeGreaterThan(180);
  await win.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]);

  // Hiding the painted layer reveals the photo again (layers composite independently).
  await win.getByRole('button', { name: 'Hide Layer 1' }).click();
  await expect.poll(async () => (await canvasPixel(win, cx, cy))[0]).toBeGreaterThan(180);

  const latencies = await win.evaluate(() =>
    performance.getEntriesByName('brush-latency').map((e) => e.duration),
  );
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const gpu = await win.locator('footer').innerText();
  test.info().annotations.push({
    type: 'brush-latency',
    description: `n=${latencies.length} p95=${p95.toFixed(1)}ms on ${gpu}`,
  });
  console.log(
    `[${process.platform}/${target}] brush latency p95 ${p95.toFixed(1)} ms over ${latencies.length} frames — ${gpu}`,
  );
  expect(latencies.length).toBeGreaterThan(5);
  await close();
});

test(`[${target}] erases to transparency (checkerboard shows through)`, async () => {
  const { win, close } = await launch();
  await win.getByRole('spinbutton').nth(0).fill('400');
  await win.getByRole('spinbutton').nth(1).fill('300');
  await win.getByRole('button', { name: 'Create' }).click();
  await win.getByRole('button', { name: 'Eraser (E)' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  const box = (await win.locator('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await paintLine(win, [cx - 40, cy], [cx + 40, cy]);
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Eraser');
  // Checkerboard cells are light grey (204) or white — no longer pure white everywhere along the stroke.
  const samples = await Promise.all([-24, -12, 0, 12, 24].map((dx) => canvasPixel(win, cx + dx, cy)));
  expect(samples.some(([r]) => r < 230)).toBe(true);
  await close();
});

test(`[${target}] explains when a file is not an image`, async () => {
  const { win, close } = await launch([junk]);
  await expect(win.getByRole('alert')).toContainText('not a supported image');
  await close();
});

test(`[${target}] runs cross-origin isolated with the security baseline`, async () => {
  const { app, win, close } = await launch();
  const env = await win.evaluate(async () => {
    const g = globalThis as Record<string, unknown>;
    let networkBlocked = false;
    try {
      await fetch('https://example.com');
    } catch {
      networkBlocked = true;
    }
    const gl = document.createElement('canvas').getContext('webgl2');
    return {
      protocol: location.protocol,
      crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer,
      require: typeof g['require'],
      process: typeof g['process'],
      apiKeys: Object.keys(window.api).sort(),
      networkBlocked,
      webgl2: Boolean(gl),
    };
  });
  expect(env).toEqual({
    protocol: 'app:',
    crossOriginIsolated: true,
    sharedArrayBuffer: 'function',
    require: 'undefined',
    process: 'undefined',
    apiKeys: ['app', 'codec', 'dialog', 'events', 'file', 'files'],
    networkBlocked: true,
    webgl2: true,
  });
  const before = win.url();
  await win.evaluate(() => {
    window.open('https://example.com');
    location.href = 'https://example.com';
  });
  await win.waitForTimeout(500);
  expect(win.url()).toBe(before);
  expect(app.windows()).toHaveLength(1);
  await close();
});
