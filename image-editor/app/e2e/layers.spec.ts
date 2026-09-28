import { expect, test, type Page } from '@playwright/test';
import { canvasPixel, launch, paintLine, target, docCanvas } from './app';

async function newDocument(win: Page, width: number, height: number): Promise<void> {
  await win.getByRole('spinbutton').nth(0).fill(String(width));
  await win.getByRole('spinbutton').nth(1).fill(String(height));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

const layerRow = (win: Page, name: string | RegExp) => win.getByRole('option', { name });

test(`[${target}] layers: blend modes, groups, duplicate, rename, locks and merge (FR-LAY-01/02/03/06)`, async () => {
  const { win, close } = await launch();
  await newDocument(win, 300, 200);
  const box = (await docCanvas(win).boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];

  // Paint black on a new layer over white.
  await win.getByRole('button', { name: 'New layer' }).click();
  await paintLine(win, [cx - 40, cy], [cx + 40, cy]);
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]);

  // Screen with black leaves the white backdrop; Multiply keeps black. Undo restores the mode.
  const blend = win.getByRole('combobox', { name: 'Blend mode' });
  await blend.selectOption('screen');
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([255, 255, 255]);
  await blend.selectOption('multiply');
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]);
  await win.keyboard.press('ControlOrMeta+z');
  await expect(blend).toHaveValue('screen');
  await win.keyboard.press('ControlOrMeta+z');
  await expect(blend).toHaveValue('normal');

  // Duplicate (Ctrl+J), then group the copy (Ctrl+G) and collapse the group.
  await win.keyboard.press('ControlOrMeta+j');
  await expect(layerRow(win, /Layer 1 copy/)).toHaveAttribute('aria-selected', 'true');
  await win.keyboard.press('ControlOrMeta+g');
  const group = layerRow(win, /Group 1/);
  await expect(group).toHaveAttribute('aria-selected', 'true');
  await expect(layerRow(win, /Layer 1 copy/)).toHaveAttribute('aria-level', '2');
  await win.getByRole('button', { name: 'Collapse Group 1' }).click();
  await expect(layerRow(win, /Layer 1 copy/)).toHaveCount(0);
  await expect(win.getByRole('combobox', { name: 'Blend mode' })).toHaveValue('pass-through');

  // Rename by double-click.
  await layerRow(win, /Background/).dblclick();
  const name = win.getByRole('textbox', { name: 'Layer name' });
  await name.fill('Paper');
  await name.press('Enter');
  await expect(layerRow(win, /Paper/)).toBeVisible();

  // A pixel-locked layer refuses paint with an explanation.
  await layerRow(win, /Layer 1$/).click();
  await win.getByRole('button', { name: 'Lock image pixels' }).click();
  await paintLine(win, [cx - 40, cy + 30], [cx + 40, cy + 30]);
  await expect(win.getByRole('status').filter({ hasText: 'This layer is locked.' })).toBeVisible();
  await win.getByRole('button', { name: 'Lock image pixels' }).click();

  // Merge Down (Ctrl+E) into the background keeps the composite.
  await win.keyboard.press('ControlOrMeta+e');
  await expect(layerRow(win, /Layer 1$/)).toHaveCount(0);
  await expect.poll(() => canvasPixel(win, cx, cy)).toEqual([0, 0, 0]);
  await expect(win.getByRole('list', { name: 'History' })).toContainText('Merge Down');

  // Thumbnails render (FR-LAY-06).
  await expect(layerRow(win, /Paper/).locator('canvas')).toHaveAttribute('width', /\d+/);
  await close();
});
