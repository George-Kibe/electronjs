import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { docCanvas, launch, newProfile, paintLine, target } from './app';

/** Clicks a native menu item by label wherever it is (Help on Windows/Linux, the app menu on macOS). */
async function clickMenuItem(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, wanted) => {
    type Item = Electron.MenuItem;
    const walk = (items: Item[]): Item[] =>
      items.flatMap((i) => [i, ...(i.submenu ? walk(i.submenu.items) : [])]);
    const item = walk(Menu.getApplicationMenu()!.items).find((i) => i.label === wanted)!;
    item.click(
      undefined,
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
      undefined as never,
    );
  }, label);
}

async function newDocument(win: Page): Promise<void> {
  const form = win.getByRole('form', { name: 'New document' });
  await form.getByRole('spinbutton', { name: 'Width' }).fill('300');
  await form.getByRole('spinbutton', { name: 'Height' }).fill('200');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

const banner = (win: Page) => win.getByRole('status', { name: 'Software update' });

test(`[${target}] auto-update: never restarts over unsaved work, installs on Restart Now (FR-GEN-05)`, async () => {
  const profile = newProfile();
  const { app, win, close } = await launch([], profile, { E2E_FAKE_UPDATE: '9.9.9' });
  const exited = new Promise<void>((done) => app.process().once('exit', () => done()));
  try {
    // The background check finds, downloads and announces the update by itself.
    await expect(banner(win)).toContainText('ImageEditor 9.9.9 is ready to install.', { timeout: 15_000 });
    const restart = banner(win).getByRole('button', { name: 'Restart Now' });
    await expect(restart).toBeEnabled();

    // Unsaved work: the restart is refused, by the button and by main itself.
    await newDocument(win);
    const box = (await docCanvas(win).boundingBox())!;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await paintLine(win, [cx - 40, cy], [cx + 40, cy]);
    await expect(banner(win)).toContainText('Save your work to restart.');
    await expect(restart).toBeDisabled();
    expect(await win.evaluate(() => window.api.update.install())).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });

    // "Later" hides it; Help › Check for Updates brings it back.
    await banner(win).getByRole('button', { name: 'Later' }).click();
    await expect(banner(win)).toBeHidden();
    await clickMenuItem(app, 'Check for Updates…');
    await expect(banner(win)).toContainText('ImageEditor 9.9.9 is ready to install.');

    // Once the work is dealt with, Restart Now installs (the fake marks it) and the app quits.
    await win.keyboard.press('ControlOrMeta+w');
    await win.getByRole('dialog').getByRole('button', { name: 'Don’t Save' }).click();
    await expect(restart).toBeEnabled();
    expect(existsSync(join(profile, 'e2e-update-installed'))).toBe(false);
    await restart.click();
    await exited;
    expect(existsSync(join(profile, 'e2e-update-installed'))).toBe(true);
  } finally {
    await close().catch(() => undefined);
  }
});

test(`[${target}] Check for Updates reports up to date; the update channel is saved (FR-GEN-05)`, async () => {
  const profile = newProfile();
  const { app, win, close } = await launch([], profile); // feed: no update
  await clickMenuItem(app, 'Check for Updates…');
  await expect(banner(win)).toContainText(/^ImageEditor \S+ is up to date\./);
  await banner(win).getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(win)).toBeHidden();

  await win.keyboard.press('ControlOrMeta+,');
  const prefs = win.getByRole('dialog', { name: 'Preferences' });
  await prefs.getByRole('tab', { name: 'Updates' }).click();
  await expect(prefs.getByLabel('Update status')).toContainText('is up to date.');
  await prefs.getByRole('combobox', { name: 'Update channel' }).selectOption('beta');
  await prefs.getByRole('button', { name: 'Done' }).click();
  // The setting is written by main after an IPC round trip: wait for it before quitting.
  const saved = () => {
    try {
      return JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')) as {
        updates?: { channel?: string };
      };
    } catch {
      return null; // not written yet
    }
  };
  await expect.poll(() => saved()?.updates?.channel).toBe('beta');
  await close();
  expect(saved()).toMatchObject({ updates: { channel: 'beta' } });
});
