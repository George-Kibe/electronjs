import { expect, test, type ElectronApplication } from '@playwright/test';
import { canvasPixel, docCanvas, launch, target, zoomField } from './app';

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

const dark = (rgb: number[]) => rgb.every((c) => c < 80);

test(`[${target}] several layers: select, align, distribute and group together (FR-LAY-08)`, async () => {
  const { app, win, close } = await launch();
  const form = win.getByRole('form', { name: 'New document' });
  await form.getByRole('spinbutton', { name: 'Width' }).fill('300');
  await form.getByRole('spinbutton', { name: 'Height' }).fill('200');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const at = (x: number, y: number): [number, number] => [
    box.x + Math.round((box.width - 300) / 2) + x + 0.5,
    box.y + Math.round((box.height - 200) / 2) + y + 0.5,
  ];
  const size = win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' });
  await size.fill('20');
  await size.blur();

  // Three dots on three layers, at different heights.
  for (const [x, y] of [
    [40, 40],
    [120, 100],
    [260, 160],
  ] as const) {
    await win.getByRole('button', { name: 'New layer', exact: true }).click();
    await win.mouse.click(...at(x, y));
  }
  const layers = win.getByRole('listbox', { name: 'Layers' });
  const row = (name: string) => layers.getByRole('option', { name: new RegExp(name) });
  await row('Layer 1').click({ modifiers: ['ControlOrMeta'] });
  await row('Layer 2').click({ modifiers: ['ControlOrMeta'] });
  for (const n of [1, 2, 3]) await expect(row(`Layer ${n}`)).toHaveAttribute('aria-selected', 'true');
  await expect(row('Background')).toHaveAttribute('aria-selected', 'false');

  // Align › Top Edges: all three dots move up to the highest one.
  await menu(app, ['Layer', 'Align', 'Top Edges']);
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Align');
  await expect.poll(async () => dark(await canvasPixel(win, ...at(260, 40)))).toBe(true);
  expect(dark(await canvasPixel(win, ...at(120, 40)))).toBe(true);
  expect(dark(await canvasPixel(win, ...at(260, 160)))).toBe(false);

  // Distribute › Horizontal Centers: the middle dot moves to the middle (40 … 260 → 150).
  await menu(app, ['Layer', 'Distribute', 'Horizontal Centers']);
  await expect.poll(async () => dark(await canvasPixel(win, ...at(150, 40)))).toBe(true);
  expect(dark(await canvasPixel(win, ...at(120, 40)))).toBe(false);

  // Ctrl+G puts all three into one group.
  await win.keyboard.press('ControlOrMeta+g');
  await expect(row('Group 1')).toBeVisible();
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Group Layers');
  await expect(layers.getByRole('option')).toHaveCount(5); // Group 1, its 3 layers, Background

  // Shift-click selects a range; a plain click selects one again.
  await row('Background').click();
  await row('Layer 2').click({ modifiers: ['Shift'] });
  await expect(row('Layer 1')).toHaveAttribute('aria-selected', 'true');
  await row('Layer 3').click();
  await expect(row('Layer 1')).toHaveAttribute('aria-selected', 'false');
  await close();
});
