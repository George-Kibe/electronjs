import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { canvasPixel, docCanvas, launch, paintLine, target } from './app';

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

async function newDocument(win: Page, width: number): Promise<void> {
  const dialog = win.getByRole('dialog', { name: 'New document' });
  const form = (await dialog.count()) ? dialog : win.getByRole('form', { name: 'New document' });
  await form.getByRole('spinbutton', { name: 'Width' }).fill(String(width));
  await form.getByRole('spinbutton', { name: 'Height' }).fill('200');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(`${width} × 200 px`);
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

test(`[${target}] tabs: a document moves to its own window with its pixels and unsaved state (FR-DOC-03)`, async () => {
  const launched = await launch();
  const { app, win } = launched;
  await newDocument(win, 300);
  const box = (await docCanvas(win).boundingBox())!;
  await paintLine(
    win,
    [box.x + box.width / 2 - 60, box.y + box.height / 2],
    [box.x + box.width / 2 + 60, box.y + box.height / 2],
  );
  await win.keyboard.press('ControlOrMeta+n');
  await newDocument(win, 250);
  await win.getByRole('tab', { name: /^Untitled-1/ }).click();

  // Window › Move Tab to New Window (dragging the tab out of the window does the same).
  await menu(app, ['Window', 'Move Tab to New Window']);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  await expect(win.getByRole('tab')).toHaveCount(1);
  await expect(win.locator('footer')).toContainText('250 × 200 px');

  await expect.poll(() => launched.pages().length, { timeout: 20_000 }).toBe(2);
  const moved = launched.pages().find((p) => p !== win)!;
  await expect(moved.locator('footer')).toContainText('300 × 200 px', { timeout: 20_000 });
  await expect(moved.getByRole('tab', { name: 'Untitled-1, unsaved changes' })).toBeVisible();
  await expect(moved.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  const mbox = (await docCanvas(moved).boundingBox())!;
  await expect
    .poll(() => canvasPixel(moved, mbox.x + mbox.width / 2, mbox.y + mbox.height / 2))
    .toEqual([0, 0, 0]);

  // Each window guards its own unsaved work: closing the new one asks about the moved document.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle().includes('Untitled-1'))
      ?.close(),
  );
  await expect(moved.getByRole('dialog', { name: 'Save changes?' })).toBeVisible();
  await moved
    .getByRole('dialog', { name: 'Save changes?' })
    .getByRole('button', { name: 'Don’t Save' })
    .click()
    .catch(() => undefined);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await launched.close();
});
