import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canvasPixel, docCanvas, launch, newProfile, paintLine, stubSaveDialog, target } from './app';

const recoveryFiles = (profile: string) => {
  const dir = join(profile, 'recovery');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
};

test(`[${target}] recovery: a crash leaves a snapshot that the next launch restores; saving removes it (FR-DOC-10, T-REC-01)`, async () => {
  const profile = newProfile();
  const first = await launch([], profile, { E2E_AUTOSAVE_SECONDS: '1' });
  let win = first.win;
  await win.getByRole('spinbutton', { name: 'Width' }).fill('300');
  await win.getByRole('spinbutton', { name: 'Height' }).fill('200');
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  let box = (await docCanvas(win).boundingBox())!;
  let [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await paintLine(win, [cx - 60, cy], [cx + 60, cy]);
  await expect.poll(() => recoveryFiles(profile), { timeout: 15_000 }).toHaveLength(1);

  // Crash: no chance to clean up.
  first.app.process().kill('SIGKILL');
  await first.close().catch(() => undefined);

  const second = await launch([], profile);
  win = second.win;
  await expect(win.getByRole('heading', { name: 'Recover an unsaved document' })).toBeVisible();
  await win.getByRole('button', { name: 'Recover Untitled' }).click();
  await expect(win.locator('footer')).toContainText('300 × 200 px');
  await expect(win.getByLabel('unsaved changes')).toBeVisible();
  box = (await docCanvas(win).boundingBox())!;
  [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]);

  // Saving the recovered document makes the snapshot unnecessary.
  const dir = mkdtempSync(join(tmpdir(), 'ie-recovered-'));
  await stubSaveDialog(second.app, join(dir, 'Recovered.iep'));
  await win.keyboard.press('ControlOrMeta+s');
  await expect(win.getByLabel('Document')).toHaveText('Recovered.iep');
  await expect.poll(() => recoveryFiles(profile)).toHaveLength(0);
  await second.close();

  // Closing normally with Don't Save leaves nothing to recover.
  const third = await launch([], profile, { E2E_AUTOSAVE_SECONDS: '1' });
  win = third.win;
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  box = (await docCanvas(win).boundingBox())!;
  await paintLine(win, [box.x + 100, box.y + 100], [box.x + 200, box.y + 120]);
  await expect.poll(() => recoveryFiles(profile), { timeout: 15_000 }).toHaveLength(1);
  await third.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await win
    .getByRole('dialog', { name: 'Save changes?' })
    .getByRole('button', { name: 'Don’t Save' })
    .click()
    .catch(() => undefined); // the window may close before the click is acknowledged
  await expect.poll(() => recoveryFiles(profile)).toHaveLength(0);
  await third.close().catch(() => undefined);
});
