import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { canvasPixel, docCanvas, launch, newProfile, target } from './app';

test(`[${target}] FR-HIS-03, T-HIS-02: history beyond the memory budget goes to disk, and undo reads it back`, async () => {
  test.setTimeout(240_000);
  const profile = newProfile();
  // The smallest budget (512 MB). Each Invert of a 24 MP layer keeps 96 MB in history: 8 of them go over.
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ performance: { memoryBudgetMB: 512 } }));
  const { win, close } = await launch([], profile);
  await win.getByRole('spinbutton').nth(0).fill('6000');
  await win.getByRole('spinbutton').nth(1).fill('4000');
  await win.getByRole('button', { name: 'Create' }).click();
  const footer = win.locator('footer');
  await expect(footer).toContainText('6000 × 4000 px', { timeout: 15_000 });
  const box = (await docCanvas(win).boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const steps = win.getByRole('list', { name: 'History' }).getByRole('listitem');
  const colour = (inverts: number) => (inverts % 2 ? [0, 0, 0] : [255, 255, 255]);

  for (let i = 1; i <= 8; i++) {
    await win.keyboard.press('ControlOrMeta+i');
    await expect(steps).toHaveCount(1 + i, { timeout: 60_000 }); // "New" + one row per step
  }
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual(colour(8));
  // The older steps went to the scratch file instead of being dropped. Until a step's tiles are all
  // written, history still holds them, so wait for the writing to finish before letting them go.
  await expect(footer).toContainText('history on disk', { timeout: 60_000 });
  await expect(footer).not.toContainText('writing history', { timeout: 60_000 });
  await expect(steps).toHaveCount(9);

  // Let go of the originals, so the undos below have to read the scratch file.
  const cdp = await win.context().newCDPSession(win);
  await cdp.send('HeapProfiler.collectGarbage');

  for (let i = 7; i >= 0; i--) {
    await win.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => canvasPixel(win, cx, cy), { timeout: 60_000 }).toEqual(colour(i));
  }
  const reads = await win.evaluate(() => performance.getEntriesByName('scratch:get').map((e) => e.duration));
  expect(reads.length).toBeGreaterThan(0);
  console.log(`[${process.platform}/${target}] undo read ${reads.length} tiles back from the scratch file`);
  for (let i = 1; i <= 8; i++) {
    await win.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => canvasPixel(win, cx, cy), { timeout: 60_000 }).toEqual(colour(i));
  }
  await close();
});
