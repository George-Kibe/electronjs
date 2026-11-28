import { expect, test, type Page } from '@playwright/test';
import { canvasPixel, docCanvas, launch, paintLine, target } from './app';

const tab = (win: Page, name: string) => win.getByRole('tab', { name: new RegExp(`^${name}`) });
const footer = (win: Page) => win.locator('footer');

async function newDocument(win: Page, width: number, height: number): Promise<void> {
  const dialog = win.getByRole('dialog', { name: 'New document' });
  const form = (await dialog.count()) ? dialog : win.getByRole('form', { name: 'New document' });
  await form.getByRole('spinbutton', { name: 'Width' }).fill(String(width));
  await form.getByRole('spinbutton', { name: 'Height' }).fill(String(height));
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(footer(win)).toContainText(`${width} × ${height} px`);
  await expect(footer(win)).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

test(`[${target}] tabs: several documents, switching, closing, and the unsaved-changes prompt per tab (FR-DOC-03)`, async () => {
  const { app, win, close } = await launch();
  await newDocument(win, 300, 200);
  const box = (await docCanvas(win).boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await paintLine(win, [cx - 60, cy], [cx + 60, cy]);
  await expect(tab(win, 'Untitled-1')).toHaveAccessibleName('Untitled-1, unsaved changes');

  // A second document opens in its own tab; the first keeps its pixels and history.
  await win.keyboard.press('ControlOrMeta+n');
  await newDocument(win, 200, 100);
  await expect(tab(win, 'Untitled-2')).toHaveAttribute('aria-selected', 'true');
  await expect(win.getByRole('list', { name: 'History' }).getByRole('listitem')).toHaveCount(1); // just "New"
  await tab(win, 'Untitled-1').click();
  await expect(footer(win)).toContainText('300 × 200 px');
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]);
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Brush');

  // Ctrl+Tab cycles; Ctrl+W closes a clean tab without asking.
  await win.keyboard.press('Control+Tab');
  await expect(tab(win, 'Untitled-2')).toHaveAttribute('aria-selected', 'true');
  await win.keyboard.press('ControlOrMeta+w');
  await expect(win.getByRole('tab')).toHaveCount(1);
  await expect(footer(win)).toContainText('300 × 200 px');

  // Closing a tab with unsaved changes asks; Cancel keeps it.
  await win.getByRole('button', { name: 'Close Untitled-1' }).click();
  const prompt = win.getByRole('dialog', { name: 'Save changes?' });
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByRole('tab')).toHaveCount(1);

  // Closing the window asks about each tab with unsaved changes in turn.
  await win.keyboard.press('ControlOrMeta+n');
  await newDocument(win, 120, 90);
  await paintLine(win, [cx - 20, cy], [cx + 20, cy]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect(prompt).toContainText('Untitled-1');
  await prompt.getByRole('button', { name: 'Don’t Save' }).click();
  await expect(prompt).toContainText('Untitled-3');
  await prompt
    .getByRole('button', { name: 'Don’t Save' })
    .click()
    .catch(() => undefined); // the window may close before the click is acknowledged
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0))
    .toBe(0);
  await close();
});
