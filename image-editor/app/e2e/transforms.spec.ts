import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { canvasPixel, docCanvas, launch, paintLine, target, zoomField } from './app';

async function newDocument(win: Page, width: number, height: number): Promise<void> {
  await win.getByRole('spinbutton').nth(0).fill(String(width));
  await win.getByRole('spinbutton').nth(1).fill(String(height));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

/** Page coordinates of the centre of document pixel (x, y) for a w×h document fitted at 100 %. */
async function docToPage(
  win: Page,
  w: number,
  h: number,
): Promise<(x: number, y: number) => [number, number]> {
  await expect(win.locator('footer')).toContainText(`${w} × ${h} px`);
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - w) / 2);
  const oy = box.y + Math.round((box.height - h) / 2);
  return (x, y) => [ox + x + 0.5, oy + y + 0.5];
}

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

const footer = (win: Page) => win.locator('footer');
const history = (win: Page) => win.getByRole('list', { name: 'History' });
const black = (win: Page, p: [number, number]) =>
  expect.poll(() => canvasPixel(win, ...p)).toEqual([0, 0, 0]);
const white = (win: Page, p: [number, number]) =>
  expect.poll(() => canvasPixel(win, ...p)).toEqual([255, 255, 255]);

test(`[${target}] transforms: image size, canvas size, rotate, crop and straighten (FR-TRF-01..03)`, async () => {
  const { app, win, close } = await launch();
  await newDocument(win, 300, 200);
  let at = await docToPage(win, 300, 200);

  // A thick black mark near the top-left.
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' }).fill('20');
  await paintLine(win, at(40, 50), at(100, 50));
  await black(win, at(70, 50));

  // Image Size (Ctrl+Alt+I): halving the width halves the height (constrained).
  await win.keyboard.press('ControlOrMeta+Alt+i');
  const sizeDialog = win.getByRole('dialog', { name: 'Image Size' });
  await sizeDialog.getByRole('spinbutton').first().fill('150');
  await expect(sizeDialog.getByRole('spinbutton').nth(1)).toHaveValue('100');
  await sizeDialog.getByRole('button', { name: 'OK' }).click();
  at = await docToPage(win, 150, 100);
  await expect(history(win)).toContainText('Image Size');
  await black(win, at(35, 25));
  await win.keyboard.press('ControlOrMeta+z');
  await docToPage(win, 300, 200);

  // Canvas Size (Ctrl+Alt+C), anchored bottom right: the image moves right and down.
  await win.keyboard.press('ControlOrMeta+Alt+c');
  const canvasDialog = win.getByRole('dialog', { name: 'Canvas Size' });
  await canvasDialog.getByRole('spinbutton').first().fill('400');
  await canvasDialog.getByRole('spinbutton').nth(1).fill('250');
  await canvasDialog.getByRole('radio', { name: 'Bottom right' }).click();
  await canvasDialog.getByRole('button', { name: 'OK' }).click();
  at = await docToPage(win, 400, 250);
  await black(win, at(170, 100));
  await win.keyboard.press('ControlOrMeta+z');
  await docToPage(win, 300, 200);

  // Image › Image Rotation › 90° Clockwise: (x, y) → (H − 1 − y, x).
  await menu(app, ['Image', 'Image Rotation', '90° Clockwise']);
  at = await docToPage(win, 200, 300);
  await black(win, at(149, 70));
  await win.keyboard.press('ControlOrMeta+z');
  await docToPage(win, 300, 200);

  // Crop tool (C): a 1:1 box centred on the canvas, committed with Enter.
  await win.keyboard.press('c');
  const options = win.getByRole('toolbar', { name: 'Tool options' });
  await options.getByRole('combobox', { name: 'Ratio' }).selectOption('1:1');
  await expect(options.getByRole('spinbutton', { name: 'Crop X' })).toHaveValue('50');
  await expect(options.getByRole('spinbutton', { name: 'Crop width' })).toHaveValue('200');
  await win.keyboard.press('Enter');
  at = await docToPage(win, 200, 200);
  await expect(history(win)).toContainText('Crop');
  await black(win, at(20, 50)); // x 70 → 20
  await white(win, at(100, 150));

  // Dragging a handle resizes the box; Enter crops to it.
  await options.getByRole('combobox', { name: 'Ratio' }).selectOption('free');
  await win.mouse.move(...at(199, 100));
  await win.mouse.down();
  await win.mouse.move(...at(120, 100), { steps: 8 });
  await win.mouse.up();
  // The edge moves by the drag distance (79 px): 200 − 79.
  await expect(options.getByRole('spinbutton', { name: 'Crop width' })).toHaveValue('121');
  await win.keyboard.press('Enter');
  at = await docToPage(win, 121, 200);

  // Straighten: draw a tilted horizon; the image is rotated and cropped in one step.
  await options.getByRole('button', { name: /Straighten/ }).click();
  await win.mouse.move(...at(10, 100));
  await win.mouse.down();
  await win.mouse.move(...at(110, 108), { steps: 8 });
  await win.mouse.up();
  await expect(history(win)).toContainText('Straighten', { timeout: 30_000 });
  await expect(footer(win)).not.toContainText('121 × 200 px');
  await win.keyboard.press('ControlOrMeta+z');
  await expect(footer(win)).toContainText('121 × 200 px');
  await close();
});
