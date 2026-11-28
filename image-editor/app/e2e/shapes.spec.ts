import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { canvasPixel, docCanvas, launch, target, zoomField } from './app';

const W = 400;
const H = 240;

async function menu(app: ElectronApplication, path: string[]): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    let items = Menu.getApplicationMenu()!.items;
    let item;
    for (const label of labels) {
      item = items.find((i) => i.label === label)!;
      items = item.submenu?.items ?? [];
    }
    item!.click(
      undefined,
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
      undefined as never,
    );
  }, path);
}

async function drag(win: Page, from: [number, number], to: [number, number]): Promise<void> {
  await win.mouse.move(...from);
  await win.mouse.down();
  await win.mouse.move(...to, { steps: 10 });
  await win.mouse.up();
}

test(`[${target}] shape tool: draw editable shapes, restyle them, rasterize (FR-PNT-08)`, async () => {
  const { app, win, close } = await launch();
  await win.getByRole('spinbutton').nth(0).fill(String(W));
  await win.getByRole('spinbutton').nth(1).fill(String(H));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - W) / 2);
  const oy = box.y + Math.round((box.height - H) / 2);
  const at = (x: number, y: number): [number, number] => [ox + x + 0.5, oy + y + 0.5];
  const layers = win.getByRole('listbox', { name: 'Layers' });
  const history = win.getByRole('list', { name: 'History' });
  const options = win.getByRole('toolbar', { name: 'Tool options' });

  // U, then drag: a black rectangle on its own shape layer.
  await win.keyboard.press('u');
  await expect(options).toContainText('Shape');
  await drag(win, at(50, 50), at(150, 120));
  await expect(layers.getByRole('button', { name: 'Rectangle 1 shape' })).toBeVisible();
  await expect(history).toContainText('Rectangle');
  await expect.poll(() => canvasPixel(win, ...at(100, 85))).toEqual([0, 0, 0]);
  expect(await canvasPixel(win, ...at(200, 85))).toEqual([255, 255, 255]);

  // With it selected, the options bar restyles it: a red fill, one step; undo brings black back.
  await options.getByRole('button', { name: /^Fill colour/ }).click();
  const picker = win.getByRole('dialog', { name: 'Shape fill' });
  await picker.getByRole('textbox', { name: 'Hex' }).fill('FF0000');
  await picker.getByRole('button', { name: 'OK' }).click();
  await expect(history).toContainText('Edit Shape');
  await expect.poll(() => canvasPixel(win, ...at(100, 85))).toEqual([255, 0, 0]);
  await win.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => canvasPixel(win, ...at(100, 85))).toEqual([0, 0, 0]);

  // An ellipse, in the tool's fill (still the red picked above: undo changes layers, not tool options); its
  // box's corners stay empty.
  await options.getByRole('button', { name: 'Ellipse' }).click();
  await drag(win, at(200, 40), at(380, 200));
  await expect(layers.getByRole('button', { name: 'Ellipse 1 shape' })).toBeVisible();
  await expect.poll(() => canvasPixel(win, ...at(290, 120))).toEqual([255, 0, 0]);
  expect(await canvasPixel(win, ...at(205, 45))).toEqual([255, 255, 255]);

  // Layer › Rasterize Shape: pixels now.
  await menu(app, ['Layer', 'Rasterize Shape']);
  await expect(history).toContainText('Rasterize Shape');
  await expect(layers.getByRole('button', { name: 'Ellipse 1 shape' })).toHaveCount(0);
  await expect(layers.getByRole('button', { name: 'Edit Ellipse 1 pixels' })).toBeVisible();
  await close();
});
