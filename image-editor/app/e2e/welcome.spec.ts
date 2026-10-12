import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, newProfile, paintLine, docCanvas, stubSaveDialog, target } from './app';

const recentCards = (win: Page) => win.getByRole('list', { name: 'Recent files' }).getByRole('listitem');
const footer = (win: Page) => win.locator('footer');

async function openRecentMenuLabels(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()!.items.find((i) => i.label === 'File')!;
    const recent = file.submenu!.items.find((i) => i.label === 'Open Recent')!;
    return recent.submenu!.items.map((i) => i.label);
  });
}

test(`[${target}] welcome: new document presets, recent files with thumbnails, open recent (FR-DOC-01/02, FR-GEN-08)`, async () => {
  const profile = newProfile();
  const dir = mkdtempSync(join(tmpdir(), 'ie-welcome-'));
  const projectPath = join(dir, 'Poster.iep');

  const first = await launch([], profile);
  let win = first.win;
  await expect(win.getByText('Files you open or save appear here.')).toBeVisible();

  // A preset fills size and resolution; a custom preset can be saved and comes back in later sessions.
  const form = win.getByRole('form', { name: 'New document' });
  await form
    .getByRole('combobox', { name: 'Preset' })
    .selectOption({ label: 'Instagram story (1080 × 1920)' });
  await expect(form.getByRole('spinbutton', { name: 'Width' })).toHaveValue('1080');
  await expect(form.getByRole('spinbutton', { name: 'Height' })).toHaveValue('1920');
  await form.getByRole('spinbutton', { name: 'Width' }).fill('600');
  await form.getByRole('spinbutton', { name: 'Height' }).fill('400');
  await form.getByRole('button', { name: 'Save preset' }).click();
  await form.getByRole('textbox', { name: 'Preset name' }).fill('Banner');
  await form.getByRole('textbox', { name: 'Preset name' }).press('Enter');
  await expect(form.getByRole('combobox', { name: 'Preset' })).toHaveValue('Banner');
  await form.getByRole('combobox', { name: 'Background' }).selectOption('transparent');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(footer(win)).toContainText('600 × 400 px');
  await expect(footer(win)).toContainText(/strokes RGBA/, { timeout: 15_000 });

  // Paint and save a project: it joins the recent list (and the File › Open Recent menu).
  const box = (await docCanvas(win).boundingBox())!;
  await paintLine(
    win,
    [box.x + box.width / 2 - 80, box.y + box.height / 2],
    [box.x + box.width / 2 + 80, box.y + box.height / 2],
  );
  await stubSaveDialog(first.app, projectPath);
  await win.keyboard.press('ControlOrMeta+s');
  await expect(win.getByLabel('Document')).toHaveText('Poster.iep');
  await expect.poll(() => openRecentMenuLabels(first.app)).toEqual(['Poster.iep', '', 'Clear Recent']); // separators have empty labels
  await first.close();

  // Next session: the Welcome screen shows it with a thumbnail; one click opens it.
  const second = await launch([], profile);
  win = second.win;
  await expect(recentCards(win)).toHaveCount(1);
  const card = win.getByRole('button', { name: 'Open Poster.iep' });
  await expect(card.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(
    win.getByRole('form', { name: 'New document' }).getByRole('combobox', { name: 'Preset' }),
  ).toContainText('Banner');
  await card.click();
  await expect(footer(win)).toContainText('600 × 400 px');
  await expect(win.getByLabel('Document')).toHaveText('Poster.iep');

  // Back to the Welcome screen in a fresh session: remove the entry; the list empties.
  await second.close();
  const third = await launch([], profile);
  win = third.win;
  await win.getByRole('button', { name: 'Remove Poster.iep from recent files' }).click();
  await expect(win.getByText('Files you open or save appear here.')).toBeVisible();
  await expect.poll(() => openRecentMenuLabels(third.app)).toEqual(['Clear Recent']);
  await third.close();
});
