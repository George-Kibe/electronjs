import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasPixel, docCanvas, launch, newProfile, target } from './app';

async function newDocument(win: Page): Promise<void> {
  await win.getByRole('spinbutton').nth(0).fill('300');
  await win.getByRole('spinbutton').nth(1).fill('200');
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

const theme = (win: Page) => win.evaluate(() => document.documentElement.dataset['theme']);

test(`[${target}] preferences: theme, canvas surround and history steps apply at once and persist (FR-GEN-02/04)`, async () => {
  const profile = newProfile();
  const first = await launch([], profile);
  const { app, win } = first;
  expect(await app.evaluate(({ app: a }) => a.getPath('userData'))).toBe(profile);
  await newDocument(win);
  expect(await theme(win)).toBe('dark');

  await win.keyboard.press('ControlOrMeta+,');
  const prefs = win.getByRole('dialog', { name: 'Preferences' });
  await prefs.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  await expect.poll(() => theme(win)).toBe('light');

  // The surround around the canvas (top-left corner of the view is outside a small document).
  await prefs.getByRole('combobox', { name: 'Canvas surround' }).selectOption('#808080');
  await prefs.getByRole('button', { name: 'Done' }).click();
  const box = (await docCanvas(win).boundingBox())!;
  // ±2: the clear colour goes through 8-bit rounding on its way to the screenshot.
  await expect
    .poll(async () => (await canvasPixel(win, box.x + 5, box.y + 5)).every((c) => Math.abs(c - 128) <= 2))
    .toBe(true);

  // History steps: only the last 20 steps are kept.
  await win.keyboard.press('ControlOrMeta+,');
  await prefs.getByRole('tab', { name: 'Performance' }).click();
  const steps = prefs.getByRole('spinbutton', { name: 'History steps' });
  await steps.fill('20');
  await steps.blur();
  await prefs.getByRole('button', { name: 'Done' }).click();
  for (let i = 0; i < 25; i++) await win.keyboard.press('ControlOrMeta+Shift+n');
  await expect(win.getByRole('option', { name: /Layer 25/ })).toBeVisible();
  // 20 steps plus the "New" row.
  await expect(win.getByRole('list', { name: 'History' }).getByRole('listitem')).toHaveCount(21);
  await first.close();

  const saved = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'));
  expect(saved).toMatchObject({
    general: { theme: 'light', canvasColor: '#808080' },
    performance: { historySteps: 20 },
  });

  // A new session starts with the saved preferences.
  const second = await launch([], profile);
  await expect.poll(() => theme(second.win)).toBe('light');
  await second.close();
  expect(existsSync(join(newProfile(), 'settings.json'))).toBe(false); // fresh profiles stay empty
});
