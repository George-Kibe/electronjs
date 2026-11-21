import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { canvasPixel, docCanvas, launch, target, zoomField } from './app';

async function newDocument(win: Page): Promise<void> {
  const form = win.getByRole('form', { name: 'New document' });
  await form.getByRole('spinbutton', { name: 'Width' }).fill('300');
  await form.getByRole('spinbutton', { name: 'Height' }).fill('200');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

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

const dark = (rgb: number[]) => rgb.every((c) => c < 60);
const light = (rgb: number[]) => rgb.every((c) => c > 200);

test(`[${target}] layer masks: add, paint to hide, disable, apply, undo (FR-LAY-04)`, async () => {
  const { app, win, close } = await launch();
  await newDocument(win);
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const at = (x: number, y: number): [number, number] => [
    box.x + Math.round((box.width - 300) / 2) + x + 0.5,
    box.y + Math.round((box.height - 200) / 2) + y + 0.5,
  ];
  const history = win.getByRole('list', { name: 'History' });
  const size = win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' });

  // A black area on a new layer.
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await size.fill('250');
  await size.blur();
  await win.mouse.click(...at(150, 100));
  await expect.poll(async () => dark(await canvasPixel(win, ...at(150, 100)))).toBe(true);

  // Add a mask (reveal all): painting now goes to the mask; black hides.
  await win.getByRole('button', { name: 'Add layer mask' }).click();
  await expect(history).toContainText('Reveal All');
  await expect(win.getByRole('button', { name: 'Edit Layer 1 mask' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await size.fill('60');
  await size.blur();
  await win.mouse.click(...at(150, 100));
  await expect.poll(async () => light(await canvasPixel(win, ...at(150, 100)))).toBe(true); // hidden
  expect(dark(await canvasPixel(win, ...at(90, 100)))).toBe(true); // outside the mask stroke: still shown

  // Shift-click the mask thumbnail: disabled, everything shows; again: enabled.
  const maskThumb = win.getByRole('button', { name: 'Edit Layer 1 mask' });
  await maskThumb.click({ modifiers: ['Shift'] });
  await expect(win.getByLabel('mask disabled')).toBeVisible();
  await expect.poll(async () => dark(await canvasPixel(win, ...at(150, 100)))).toBe(true);
  await maskThumb.click({ modifiers: ['Shift'] });
  await expect.poll(async () => light(await canvasPixel(win, ...at(150, 100)))).toBe(true);

  // Painting the pixels again (their thumbnail) paints the layer, not the mask.
  await win.getByRole('button', { name: 'Edit Layer 1 pixels' }).click();
  await expect(win.getByRole('button', { name: 'Edit Layer 1 pixels' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Apply: the mask is baked into the pixels and goes away; undo brings it back.
  await menu(app, ['Layer', 'Layer Mask', 'Apply']);
  await expect(history).toContainText('Apply Layer Mask');
  await expect(maskThumb).toBeHidden();
  await expect.poll(async () => light(await canvasPixel(win, ...at(150, 100)))).toBe(true);
  await win.keyboard.press('ControlOrMeta+z');
  await expect(maskThumb).toBeVisible();

  // Hide Selection on a fresh mask: the selected area disappears.
  await menu(app, ['Layer', 'Layer Mask', 'Delete']);
  await expect(maskThumb).toBeHidden();
  await expect.poll(async () => dark(await canvasPixel(win, ...at(150, 100)))).toBe(true);
  await win.keyboard.press('m');
  await win.mouse.move(at(60, 40)[0] - 0.5, at(60, 40)[1] - 0.5);
  await win.mouse.down();
  await win.mouse.move(at(120, 80)[0], at(120, 80)[1]);
  await win.mouse.move(at(140, 160)[0] - 0.5, at(140, 160)[1] - 0.5);
  await win.mouse.up();
  await menu(app, ['Layer', 'Layer Mask', 'Hide Selection']);
  await expect(history).toContainText('Hide Selection');
  await expect.poll(async () => light(await canvasPixel(win, ...at(100, 100)))).toBe(true); // inside: hidden
  expect(dark(await canvasPixel(win, ...at(200, 100)))).toBe(true); // outside: shown
  await close();
});

test(`[${target}] clipping masks: a layer shows only where the layer below has pixels (FR-LAY-05)`, async () => {
  const { win, close } = await launch();
  await newDocument(win);
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const at = (x: number, y: number): [number, number] => [
    box.x + Math.round((box.width - 300) / 2) + x + 0.5,
    box.y + Math.round((box.height - 200) / 2) + y + 0.5,
  ];
  const size = win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' });
  const reddish = (rgb: number[]) => rgb[0]! > 180 && rgb[1]! < 80 && rgb[2]! < 80;

  // Layer 1: a black square (a big dab clipped by a marquee selection).
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await win.keyboard.press('m');
  await win.mouse.move(at(50, 50)[0] - 0.5, at(50, 50)[1] - 0.5);
  await win.mouse.down();
  await win.mouse.move(at(100, 100)[0], at(100, 100)[1]);
  await win.mouse.move(at(150, 150)[0] - 0.5, at(150, 150)[1] - 0.5);
  await win.mouse.up();
  await win.keyboard.press('b');
  await size.fill('250');
  await size.blur();
  await win.mouse.click(...at(100, 100));
  await win.keyboard.press('ControlOrMeta+d');

  // Layer 2: red everywhere around.
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await win.getByRole('button', { name: /Foreground colour/ }).click();
  const picker = win.getByRole('dialog', { name: 'Foreground colour' });
  await picker.getByRole('textbox', { name: 'Hex' }).fill('dd1111');
  await expect(picker.getByRole('spinbutton', { name: 'Red' })).toHaveValue('221');
  await picker.getByRole('button', { name: 'OK' }).click();
  await win.mouse.click(...at(150, 100));
  await expect.poll(async () => reddish(await canvasPixel(win, ...at(200, 100)))).toBe(true);

  // Ctrl+Alt+G: Layer 2 is clipped to Layer 1.
  await win.keyboard.press('ControlOrMeta+Alt+g');
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Clipping Mask');
  await expect(win.getByLabel('clipped to the layer below')).toBeVisible();
  await expect.poll(async () => light(await canvasPixel(win, ...at(200, 100)))).toBe(true); // no base: hidden
  expect(reddish(await canvasPixel(win, ...at(100, 100)))).toBe(true); // over the base: red
  await win.keyboard.press('ControlOrMeta+Alt+g'); // released
  await expect.poll(async () => reddish(await canvasPixel(win, ...at(200, 100)))).toBe(true);
  await close();
});
