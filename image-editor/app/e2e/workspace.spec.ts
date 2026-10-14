import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, newProfile, target } from './app';

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

const dock = (win: Page) => win.getByRole('complementary', { name: 'Panels' });
/** Panel titles in dock order. */
const order = (win: Page) =>
  dock(win)
    .locator('section')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-labelledby')!.replace('panel-', '')));
const header = (win: Page, name: string) => dock(win).getByRole('button', { name, exact: true });

async function newDocument(win: Page): Promise<void> {
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

test(`[${target}] workspace: collapse, reorder, resize and hide panels; presets; Tab hides the interface; the layout persists (FR-GEN-01)`, async () => {
  const profile = newProfile();
  const first = await launch([], profile);
  let win = first.win;
  await newDocument(win);
  expect(await order(win)).toEqual(['layers', 'swatches', 'history']);

  // Collapse Swatches; move History up with Alt+↑ on its header.
  await header(win, 'Swatches').click();
  await expect(header(win, 'Swatches')).toHaveAttribute('aria-expanded', 'false');
  await expect(win.getByRole('group', { name: 'Saved swatches' })).toHaveCount(0);
  await header(win, 'History').focus();
  await win.keyboard.press('Alt+ArrowUp');
  expect(await order(win)).toEqual(['layers', 'history', 'swatches']);

  // Drag the line below Layers down: Layers grows.
  const layers = dock(win).locator('section').first();
  const before = (await layers.boundingBox())!.height;
  const splitter = win.getByRole('separator', { name: 'Resize Layers' });
  const s = (await splitter.boundingBox())!;
  await win.mouse.move(s.x + s.width / 2, s.y + 1);
  await win.mouse.down();
  await win.mouse.move(s.x + s.width / 2, s.y + 80, { steps: 6 });
  await win.mouse.up();
  await expect.poll(async () => (await layers.boundingBox())!.height).toBeGreaterThan(before + 40);

  // Window › History hides it; again shows it.
  await menu(first.app, ['Window', 'History']);
  expect(await order(win)).toEqual(['layers', 'swatches']);
  await menu(first.app, ['Window', 'History']);
  expect(await order(win)).toEqual(['layers', 'history', 'swatches']);

  // Tab (from the canvas) hides the toolbar, options bar and panels; Tab again brings them back.
  await win.locator('body').focus();
  await win.keyboard.press('Tab');
  await expect(dock(win)).toHaveCount(0);
  await expect(win.getByRole('navigation', { name: 'Tools' })).toHaveCount(0);
  await win.keyboard.press('Tab');
  await expect(dock(win)).toBeVisible();

  await win.waitForTimeout(500); // the layout is saved 300 ms after the last change
  await first.close();

  // The custom layout comes back next time; Workspace › Photography and Reset apply presets.
  const second = await launch([], profile);
  win = second.win;
  await newDocument(win);
  expect(await order(win)).toEqual(['layers', 'history', 'swatches']);
  await expect(header(win, 'Swatches')).toHaveAttribute('aria-expanded', 'false');
  await menu(second.app, ['Window', 'Workspace', 'Essentials']);
  expect(await order(win)).toEqual(['layers', 'swatches', 'history']);
  await expect(header(win, 'Swatches')).toHaveAttribute('aria-expanded', 'true');
  await menu(second.app, ['Window', 'Workspace', 'Photography']);
  expect(await order(win)).toEqual(['layers', 'history', 'swatches']);
  await second.close();
});
