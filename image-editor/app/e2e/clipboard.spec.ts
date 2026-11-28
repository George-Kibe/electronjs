import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import sharp from 'sharp';
import { canvasPixel, docCanvas, launch, target } from './app';

/** Puts a PNG on the system clipboard (test-only helper; the app itself never touches it in main). */
async function setClipboardPng(app: ElectronApplication, png: Buffer): Promise<void> {
  await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    const blob = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, png.toString('base64'));
}

/** Size and RGBA of a few pixels of the clipboard's PNG (bytes read in main, decoded here). */
async function clipboardImage(app: ElectronApplication, points: Array<[number, number]>) {
  const b64 = await app.evaluate(async ({ clipboard }) => {
    for (const item of await clipboard.read())
      if (item.types.includes('image/png')) {
        const blob = (await item.getType('image/png')) as Blob;
        return Buffer.from(await blob.arrayBuffer()).toString('base64');
      }
    return null;
  });
  if (!b64) throw new Error('No PNG on the clipboard');
  const { data, info } = await sharp(Buffer.from(b64, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    pixels: points.map(([x, y]) => [
      ...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4),
    ]),
  };
}

/** The Edit menu's native Paste / Copy roles, as a click or Ctrl+V / Ctrl+C would run them. */
const editRole = (app: ElectronApplication, role: 'paste' | 'copy') =>
  app.evaluate(({ BrowserWindow }, r) => BrowserWindow.getAllWindows()[0]!.webContents[r](), role);

const footer = (win: Page) => win.locator('footer');

test(`[${target}] clipboard: paste as document and as layer, copy layer and copy merged (FR-DOC-02/12)`, async () => {
  const { app, win, close } = await launch();
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText()).catch(() => '');
  try {
    // A 40×30 red image with a transparent left half.
    const rgba = Buffer.alloc(40 * 30 * 4);
    for (let i = 0; i < 40 * 30; i++) if (i % 40 >= 20) rgba.set([255, 0, 0, 255], i * 4);
    const png = await sharp(rgba, { raw: { width: 40, height: 30, channels: 4 } })
      .png()
      .toBuffer();
    await setClipboardPng(app, png);

    // No document open: Paste creates one.
    await editRole(app, 'paste');
    await expect(footer(win)).toContainText('40 × 30 px');
    await expect(win.getByLabel('Document')).toHaveText('Pasted image');

    // With a document open: Paste adds a layer, centred.
    await win.keyboard.press('ControlOrMeta+n');
    const form = win.getByRole('dialog', { name: 'New document' });
    await form.getByRole('spinbutton', { name: 'Width' }).fill('300');
    await form.getByRole('spinbutton', { name: 'Height' }).fill('200');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect(footer(win)).toContainText('300 × 200 px');
    await expect(footer(win)).toContainText(/strokes RGBA/, { timeout: 15_000 });
    await editRole(app, 'paste');
    await expect(win.getByRole('option', { name: /Pasted Layer 1/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(win.getByRole('list', { name: 'History' })).toContainText('Paste');
    const box = (await docCanvas(win).boundingBox())!;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await expect.poll(() => canvasPixel(win, cx + 10, cy)).toEqual([255, 0, 0]); // red half, right of centre
    await expect.poll(() => canvasPixel(win, cx - 10, cy)).toEqual([255, 255, 255]); // transparent half

    // Copy: the active layer alone, canvas-sized, transparency kept.
    await editRole(app, 'copy');
    await expect(win.getByRole('status').filter({ hasText: 'Copied the layer.' })).toBeVisible();
    const layer = await clipboardImage(app, [
      [160, 100],
      [5, 5],
    ]);
    expect([layer.width, layer.height]).toEqual([300, 200]);
    expect(layer.pixels[0]).toEqual([255, 0, 0, 255]);
    expect(layer.pixels[1]![3]).toBe(0);

    // Copy Merged (Ctrl+Shift+C): the visible image, so the corner is the white background.
    await win.keyboard.press('ControlOrMeta+Shift+c');
    await expect(win.getByRole('status').filter({ hasText: 'Copied the visible image.' })).toBeVisible();
    const merged = await clipboardImage(app, [
      [160, 100],
      [5, 5],
    ]);
    expect(merged.pixels).toEqual([
      [255, 0, 0, 255],
      [255, 255, 255, 255],
    ]);

    // Edit › Paste as New Document: asks about the unsaved document first, then opens the clipboard image.
    await setClipboardPng(app, png);
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const edit = Menu.getApplicationMenu()!.items.find((i) => i.label === 'Edit')!;
      edit
        .submenu!.items.find((i) => i.label === 'Paste as New Document')!
        .click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
    });
    await win
      .getByRole('dialog', { name: 'Save changes?' })
      .getByRole('button', { name: 'Don’t Save' })
      .click();
    await expect(footer(win)).toContainText('40 × 30 px');
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved).catch(() => undefined);
    await close();
  }
});
