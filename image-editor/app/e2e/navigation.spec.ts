import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import sharp from 'sharp';
import { canvasPixel, docCanvas, launch, paintLine, target, zoomField } from './app';

async function newDocument(win: Page, width: number, height: number): Promise<void> {
  await win.getByRole('spinbutton').nth(0).fill(String(width));
  await win.getByRole('spinbutton').nth(1).fill(String(height));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  await expect(zoomField(win)).toHaveValue('100');
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

async function setZoom(win: Page, percent: number): Promise<void> {
  await zoomField(win).fill(String(percent));
  await zoomField(win).press('Enter');
  await expect(zoomField(win)).toHaveValue(String(percent));
}

const history = (win: Page) => win.getByRole('list', { name: 'History' });
const footer = (win: Page) => win.locator('footer');

test(`[${target}] navigation and history: zoom steps, pixel grid, scrollbars, status bar, snapshots (FR-NAV-01/02/06, FR-HIS-01/02)`, async () => {
  const { app, win, close } = await launch();
  await newDocument(win, 300, 200);
  const box = (await docCanvas(win).boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];

  // Paint a black bar through the centre; the status bar shows the colour under the pointer.
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' }).fill('30');
  await paintLine(win, [cx - 60, cy], [cx + 60, cy]);
  await win.mouse.move(cx, cy);
  await expect(footer(win).getByLabel('Colour under the cursor')).toHaveText('#000000');
  await win.mouse.move(cx, cy - 60);
  await expect(footer(win).getByLabel('Colour under the cursor')).toHaveText('#FFFFFF');
  await expect(footer(win)).toContainText(/Mem \d+ MB \/ [\d.]+ GB/);

  // Zoom In steps through presets: 100 → 200 → 300 %; Zoom Out goes back.
  await win.keyboard.press('ControlOrMeta+=');
  await win.keyboard.press('ControlOrMeta+=');
  await expect(zoomField(win)).toHaveValue('300');
  await win.keyboard.press('ControlOrMeta+-');
  await expect(zoomField(win)).toHaveValue('200');

  // Pixel grid at ≥ 800 %: a grey line on pixel boundaries of the white canvas; View › Pixel Grid hides it.
  await setZoom(win, 800); // the threshold: the grid appears at 800 %
  // Grid lines are 1 device px: read a full-resolution strip of white canvas 25 doc px above the bar.
  const greyCount = async () => {
    const png = await win.screenshot({ clip: { x: cx - 120, y: cy - 200, width: 64, height: 1 } });
    const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let grey = 0;
    for (let i = 0; i < data.length; i += 3) if (data[i]! > 100 && data[i]! < 240) grey++;
    return grey;
  };
  await expect.poll(greyCount).toBeGreaterThanOrEqual(2);
  await menu(app, ['View', 'Pixel Grid']);
  await expect.poll(greyCount).toBe(0);
  await menu(app, ['View', 'Pixel Grid']);

  // Scrollbars pan the view: dragging the horizontal thumb right shows a different part of the document.
  await win.mouse.move(cx, cy);
  const before = await footer(win).innerText();
  const thumb = win.getByTestId('scrollbar-x');
  const t = (await thumb.boundingBox())!;
  await win.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await win.mouse.down();
  await win.mouse.move(t.x + t.width / 2 + 40, t.y + t.height / 2, { steps: 5 });
  await win.mouse.up();
  await expect.poll(async () => (await thumb.boundingBox())!.x).toBeGreaterThan(t.x + 20);
  await win.mouse.move(cx, cy);
  await expect.poll(() => footer(win).innerText()).not.toBe(before);
  await win.keyboard.press('ControlOrMeta+0');

  // Snapshots: keep a state, keep editing, restore it as a new step, and undo the restore.
  await win.getByRole('button', { name: 'New snapshot' }).click();
  const snapshots = win.getByRole('list', { name: 'Snapshots' });
  await expect(snapshots).toContainText('Snapshot 1');
  await win.getByRole('button', { name: 'Hide Layer 1' }).click();
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([255, 255, 255]);
  await snapshots.getByRole('button', { name: 'Snapshot 1', exact: true }).click();
  await expect(history(win)).toContainText('Restore Snapshot 1');
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]);
  await win.keyboard.press('ControlOrMeta+Alt+z'); // step backward
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([255, 255, 255]);

  // The automatic first snapshot returns to the document as created.
  await snapshots.getByRole('button', { name: 'Untitled-1', exact: true }).click();
  await expect(win.getByRole('option', { name: /Layer 1/ })).toHaveCount(0);
  await close();
});
