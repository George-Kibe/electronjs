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

const pixel = (win: Page, p: [number, number], rgb: [number, number, number]) =>
  expect.poll(() => canvasPixel(win, ...p)).toEqual(rgb);
/** Within ±1 per channel: values that are not exact in the 16-bit float buffers may show one level off. */
const near = (win: Page, p: [number, number], rgb: [number, number, number]) =>
  expect
    .poll(async () => Math.max(...(await canvasPixel(win, ...p)).map((v, i) => Math.abs(v - rgb[i]!))))
    .toBeLessThanOrEqual(1);
const history = (win: Page) => win.getByRole('list', { name: 'History' });
const layers = (win: Page) => win.getByRole('listbox', { name: 'Layers' });

test(`[${target}] adjustment layers: add, change in Properties, hide, paint the mask, undo (FR-ADJ-01)`, async () => {
  const { app, win, close } = await launch();
  // A short window, as on the CI runners: the ◑ menu must still fit (it scrolls).
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.unmaximize();
    w.setSize(1000, 640);
  });
  const at = await newDocument(win, 300, 200);
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' }).fill('30');
  await paintLine(win, at(40, 50), at(120, 50)); // a black bar on white
  await pixel(win, at(80, 50), [0, 0, 0]);

  // Layer › New Adjustment Layer › Invert: everything below is inverted.
  await menu(app, ['Layer', 'New Adjustment Layer', 'Invert']);
  await expect(history(win)).toContainText('New Invert Layer');
  await pixel(win, at(80, 50), [255, 255, 255]);
  await pixel(win, at(200, 150), [0, 0, 0]);
  await expect(win.getByRole('region', { name: 'Invert properties' })).toContainText('no settings');
  // Hiding it shows the pixels as they are.
  await layers(win).getByRole('button', { name: 'Hide Invert 1' }).click();
  await pixel(win, at(200, 150), [255, 255, 255]);

  // The Layers panel's ◑ menu adds Levels; the Properties panel changes it live, as one undo step.
  await win.getByRole('button', { name: 'New adjustment layer' }).click();
  // The menu stays inside the window, however short (it scrolls).
  const menuBox = (await win.getByRole('menu', { name: 'New adjustment layer' }).boundingBox())!;
  const height = await win.evaluate(() => window.innerHeight);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(height);
  await win.getByRole('menuitem', { name: /Levels/ }).click();
  const props = win.getByRole('region', { name: 'Levels properties' });
  await props.getByRole('spinbutton', { name: 'Output white' }).fill('100');
  await pixel(win, at(200, 150), [100, 100, 100]);
  await pixel(win, at(80, 50), [0, 0, 0]);
  await expect(history(win)).toContainText('Levels');

  // Painting on an adjustment layer paints its mask: black hides the adjustment there.
  await win.keyboard.press('b');
  await paintLine(win, at(200, 120), at(260, 120));
  await expect(history(win)).toContainText('Brush');
  await pixel(win, at(230, 120), [255, 255, 255]);
  await pixel(win, at(200, 180), [100, 100, 100]);

  await win.keyboard.press('ControlOrMeta+z'); // the mask stroke
  await win.keyboard.press('ControlOrMeta+z'); // the Levels change
  await pixel(win, at(200, 150), [255, 255, 255]);
  await close();
});

test(`[${target}] Image › Adjustments: a dialog previews on the canvas and OK changes the pixels (FR-ADJ-01)`, async () => {
  const { win, close } = await launch();
  const at = await newDocument(win, 300, 200);
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' }).fill('30');
  await paintLine(win, at(40, 50), at(120, 50));
  // The background layer is the one to adjust.
  await layers(win)
    .getByRole('option', { name: /Background/ })
    .click();

  // Ctrl+L: Levels; the canvas previews it; Preview off shows the original; OK applies it.
  await win.keyboard.press('ControlOrMeta+l');
  const dialog = win.getByRole('dialog', { name: 'Levels' });
  await dialog.getByRole('spinbutton', { name: 'Output white' }).fill('100');
  await pixel(win, at(200, 150), [100, 100, 100]);
  await dialog.getByRole('checkbox', { name: 'Preview' }).uncheck();
  await pixel(win, at(200, 150), [255, 255, 255]);
  await dialog.getByRole('checkbox', { name: 'Preview' }).check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(history(win)).toContainText('Levels', { timeout: 30_000 });
  await pixel(win, at(200, 150), [100, 100, 100]);
  await pixel(win, at(80, 50), [0, 0, 0]); // the bar is on its own layer

  // Esc cancels a dialog without changes; Ctrl+I inverts at once.
  await win.keyboard.press('ControlOrMeta+u');
  await win
    .getByRole('dialog', { name: 'Hue/Saturation' })
    .getByRole('spinbutton', { name: 'Lightness' })
    .fill('80');
  await win.keyboard.press('Escape');
  await expect(win.getByRole('dialog')).toHaveCount(0);
  await pixel(win, at(200, 150), [100, 100, 100]);
  await win.keyboard.press('ControlOrMeta+i');
  await expect(history(win)).toContainText('Invert', { timeout: 30_000 });
  await near(win, at(200, 150), [155, 155, 155]);
  await win.keyboard.press('ControlOrMeta+z');
  await win.keyboard.press('ControlOrMeta+z');
  await pixel(win, at(200, 150), [255, 255, 255]);
  await close();
});
