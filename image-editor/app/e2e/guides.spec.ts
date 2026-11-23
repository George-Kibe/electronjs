import { expect, test, type Page } from '@playwright/test';
import { docCanvas, launch, target, zoomField } from './app';

async function newDocument(win: Page, width: number, height: number) {
  await win.getByRole('spinbutton').nth(0).fill(String(width));
  await win.getByRole('spinbutton').nth(1).fill(String(height));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - width) / 2);
  const oy = box.y + Math.round((box.height - height) / 2);
  return { at: (x: number, y: number): [number, number] => [ox + x + 0.5, oy + y + 0.5], ox, oy };
}

const history = (win: Page) => win.getByRole('list', { name: 'History' });

/** The selection's bounds from the canvas's accessible name: [x, y, width, height]. */
async function selection(win: Page): Promise<number[]> {
  const name = (await docCanvas(win).getAttribute('aria-label')) ?? '';
  const m = /selection (\d+) by (\d+) at (\d+), (\d+)/.exec(name);
  return m ? [Number(m[3]), Number(m[4]), Number(m[1]), Number(m[2])] : [];
}

test(`[${target}] rulers, guides and snapping (FR-NAV-04)`, async () => {
  const { win, close } = await launch();
  const { at } = await newDocument(win, 300, 200);

  // Ctrl+R shows the rulers; dragging down out of the top ruler makes a horizontal guide.
  await win.keyboard.press('ControlOrMeta+r');
  const ruler = win.getByRole('img', { name: /Horizontal ruler/ });
  await expect(ruler).toBeVisible();
  const r = (await ruler.boundingBox())!;
  await win.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await win.mouse.down();
  const [gx, gy] = at(150, 80);
  await win.mouse.move(gx, gy - 0.5, { steps: 10 }); // on the boundary above pixel row 80: a guide at 80
  await win.mouse.up();
  await expect(history(win)).toContainText('New Guide');
  await expect(win.getByTestId('guides').locator('line')).toHaveCount(1);

  // A marquee dragged near the guide snaps its edge onto it.
  await win.keyboard.press('m');
  await win.mouse.move(...at(40, 30));
  await win.mouse.down();
  await win.mouse.move(...at(100, 76), { steps: 8 });
  await win.mouse.up();
  await expect
    .poll(async () => {
      const [, y, , h] = await selection(win);
      return y! + h!;
    })
    .toBe(80);
  await win.keyboard.press('ControlOrMeta+d');

  // The Move tool drags the guide off the canvas to delete it; undo brings it back.
  await win.keyboard.press('v');
  await win.mouse.move(...at(200, 80));
  await win.mouse.down();
  await win.mouse.move(...at(200, -40), { steps: 10 });
  await win.mouse.up();
  await expect(history(win)).toContainText('Delete Guide');
  await expect(win.getByTestId('guides')).toHaveCount(0);
  await win.keyboard.press('ControlOrMeta+z');
  await expect(win.getByTestId('guides').locator('line')).toHaveCount(1);
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

test(`[${target}] Navigator panel and grid (FR-NAV-04/05)`, async () => {
  const { app, win, close } = await launch();
  await win.getByRole('spinbutton').nth(0).fill('2000');
  await win.getByRole('spinbutton').nth(1).fill('1500');
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText('2000 × 1500 px', { timeout: 15_000 });

  // Window › Workspace › Photography puts the Navigator on top: fitted, the whole image is in view.
  await menu(app, ['Window', 'Workspace', 'Photography']);
  const nav = win.getByRole('img', { name: /^Navigator: showing/ });
  await expect(nav).toHaveAccessibleName('Navigator: showing 0, 0 to 2000, 1500');
  // At 100 % only part is in view; clicking the thumbnail's top-left moves the view there.
  await win.keyboard.press('ControlOrMeta+1');
  await expect(nav).not.toHaveAccessibleName('Navigator: showing 0, 0 to 2000, 1500');
  const box = (await nav.boundingBox())!;
  await nav.click({ position: { x: 2, y: 2 } });
  await expect(nav).toHaveAccessibleName(/^Navigator: showing 0, 0 to /);
  await nav.click({ position: { x: box.width - 2, y: 2 } }); // the top-right corner
  await expect(nav).toHaveAccessibleName(/to 2000, \d+$/);

  // View › Grid (Ctrl+'): gridlines over the canvas.
  await expect(win.getByTestId('grid')).toHaveCount(0);
  await win.keyboard.press("ControlOrMeta+'");
  await expect(win.getByTestId('grid').locator('path').first()).toBeAttached();
  await win.keyboard.press("ControlOrMeta+'");
  await expect(win.getByTestId('grid')).toHaveCount(0);
  await close();
});
