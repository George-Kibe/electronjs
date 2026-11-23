import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { canvasPixel, docCanvas, launch, paintLine, target, zoomField } from './app';

/** Clicks a native menu item by its label path (Playwright cannot open native menus). */
async function menu(app: ElectronApplication, path: string[]): Promise<void> {
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

async function newDocument(win: Page, width: number, height: number) {
  await win.getByRole('spinbutton').nth(0).fill(String(width));
  await win.getByRole('spinbutton').nth(1).fill(String(height));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - width) / 2);
  const oy = box.y + Math.round((box.height - height) / 2);
  return (x: number, y: number): [number, number] => [ox + x + 0.5, oy + y + 0.5];
}

const history = (win: Page) => win.getByRole('list', { name: 'History' });

test(`[${target}] filters: Mosaic, Find Edges and Vignette (FR-FLT-01)`, async () => {
  const { app, win, close } = await launch();
  const at = await newDocument(win, 300, 200);
  await win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' }).fill('30');
  await paintLine(win, at(20, 100), at(280, 100)); // black across the white background

  // Mosaic, 40 px cells: within a cell every pixel is the same average.
  await menu(app, ['Filter', 'Pixelate', 'Mosaic…']);
  const mosaic = win.getByRole('dialog', { name: 'Mosaic' });
  await mosaic.getByRole('spinbutton', { name: 'Cell Size' }).fill('40');
  await mosaic.getByRole('button', { name: 'OK' }).click();
  await expect(history(win)).toContainText('Mosaic', { timeout: 30_000 });
  await expect.poll(() => canvasPixel(win, ...at(85, 85))).toEqual(await canvasPixel(win, ...at(115, 115)));
  const cell = await canvasPixel(win, ...at(100, 100));
  expect(cell[0]).toBeGreaterThan(40);
  expect(cell[0]).toBeLessThan(220);
  await win.keyboard.press('ControlOrMeta+z');

  // Find Edges applies at once: flat white stays white, the bar's edge turns dark.
  await menu(app, ['Filter', 'Stylize', 'Find Edges']);
  await expect(history(win)).toContainText('Find Edges', { timeout: 30_000 });
  await expect.poll(() => canvasPixel(win, ...at(150, 40))).toEqual([255, 255, 255]);
  await win.keyboard.press('ControlOrMeta+z');

  // Vignette darkens the corners, not the centre.
  await menu(app, ['Filter', 'Render', 'Vignette…']);
  const vignette = win.getByRole('dialog', { name: 'Vignette' });
  await vignette.getByRole('spinbutton', { name: 'Amount' }).fill('-90');
  await vignette.getByRole('button', { name: 'OK' }).click();
  await expect(history(win)).toContainText('Vignette', { timeout: 30_000 });
  await expect.poll(async () => (await canvasPixel(win, ...at(2, 2)))[0]).toBeLessThan(120);
  await expect.poll(() => canvasPixel(win, ...at(150, 40))).toEqual([255, 255, 255]);
  await close();
});
