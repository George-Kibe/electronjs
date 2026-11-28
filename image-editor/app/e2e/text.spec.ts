import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { docCanvas, launch, stubSaveDialog, target, zoomField } from './app';

const W = 400;
const H = 240;

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

/** Dark pixels in a page rectangle, from a real screenshot (text is black on white). */
async function dark(win: Page, x: number, y: number, width: number, height: number): Promise<number> {
  const png = await win.screenshot({ clip: { x, y, width, height }, scale: 'css' });
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += 3) if (data[i]! < 80 && data[i + 1]! < 80 && data[i + 2]! < 80) n++;
  return n;
}

test(`[${target}] type tool: click, type, commit; edit in place; rasterize (FR-TXT-01, FR-LAY-01)`, async () => {
  const { app, win, close } = await launch();
  await win.getByRole('spinbutton').nth(0).fill(String(W));
  await win.getByRole('spinbutton').nth(1).fill(String(H));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - W) / 2);
  const oy = box.y + Math.round((box.height - H) / 2);
  const layers = win.getByRole('listbox', { name: 'Layers' });
  const history = win.getByRole('list', { name: 'History' });
  const textRegion = () => dark(win, ox + 40, oy + 40, 200, 70);

  // T, click, type, Esc: a text layer named after its text.
  await win.keyboard.press('t');
  const options = win.getByRole('toolbar', { name: 'Tool options' });
  await expect(options).toContainText('Type');
  await options.getByRole('spinbutton', { name: 'Font size' }).fill('48');
  await win.mouse.click(ox + 50, oy + 50);
  const editor = win.getByRole('textbox', { name: 'Text' });
  await expect(editor).toBeFocused();
  await win.keyboard.type('Hello');
  await win.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(layers.getByRole('option', { name: /Hello/ })).toBeVisible();
  await expect(layers.getByRole('button', { name: 'Edit Hello text' })).toBeVisible();
  await expect(history).toContainText('Type Layer');
  await win.mouse.move(ox + 380, oy + 230); // the cursor off the text
  await expect.poll(textRegion).toBeGreaterThan(100);

  // Undo removes it; redo brings it back.
  await win.keyboard.press('ControlOrMeta+z');
  await expect(layers.getByRole('option', { name: /Hello/ })).toHaveCount(0);
  await expect.poll(textRegion).toBe(0);
  await win.keyboard.press('ControlOrMeta+Shift+z');
  await expect(layers.getByRole('option', { name: /Hello/ })).toBeVisible();

  // A click on the text edits it in place (all selected): typing replaces it.
  await win.mouse.click(ox + 70, oy + 70);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('Hello');
  await win.keyboard.type('Hi');
  await win.keyboard.press('Escape');
  await expect(history).toContainText('Edit Type Layer');
  const short = await textRegion();
  expect(short).toBeGreaterThan(30);

  // Layer › Rasterize Type: pixels now, no longer editable as text.
  await menu(app, ['Layer', 'Rasterize Type']);
  await expect(history).toContainText('Rasterize Type');
  await expect(layers.getByRole('button', { name: 'Edit Hello text' })).toHaveCount(0);
  await expect(layers.getByRole('button', { name: 'Edit Hello pixels' })).toBeVisible();
  await close();
});

test(`[${target}] a text layer saved in a project reopens as editable text (FR-TXT-01, docs/05 §2)`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ie-text-'));
  const saved = join(dir, 'poster');
  {
    const { app, win, close } = await launch();
    await win.getByRole('spinbutton').nth(0).fill(String(W));
    await win.getByRole('spinbutton').nth(1).fill(String(H));
    await win.getByRole('button', { name: 'Create' }).click();
    await expect(zoomField(win)).toHaveValue('100');
    const box = (await docCanvas(win).boundingBox())!;
    const ox = box.x + Math.round((box.width - W) / 2);
    const oy = box.y + Math.round((box.height - H) / 2);
    await win.keyboard.press('t');
    await win.mouse.click(ox + 50, oy + 50);
    await win.keyboard.type('Poster');
    await win.keyboard.press('Escape');
    await expect(win.getByRole('list', { name: 'History' })).toContainText('Type Layer');
    await stubSaveDialog(app, saved);
    await win.keyboard.press('ControlOrMeta+s');
    await expect(win.getByLabel('Document', { exact: true })).toHaveText('poster.iep');
    await close();
  }
  const { win, close } = await launch([`${saved}.iep`]);
  const layers = win.getByRole('listbox', { name: 'Layers' });
  await expect(layers.getByRole('button', { name: 'Edit Poster text' })).toBeVisible({ timeout: 15_000 });
  // Double-click the thumbnail: the text opens in place.
  await layers.getByRole('button', { name: 'Edit Poster text' }).dblclick();
  await expect(win.getByRole('textbox', { name: 'Text' })).toHaveText('Poster');
  await close();
});

/** Red and black pixels in a page rectangle, from a real screenshot. */
async function colours(win: Page, x: number, y: number, width: number, height: number) {
  const png = await win.screenshot({ clip: { x, y, width, height }, scale: 'css' });
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  let black = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i]! > 200 && data[i + 1]! < 70 && data[i + 2]! < 70) red++;
    if (data[i]! < 70 && data[i + 1]! < 70 && data[i + 2]! < 70) black++;
  }
  return { red, black };
}

test(`[${target}] type tool: colour some characters, keep the rest; the font list (FR-TXT-02)`, async () => {
  const { win, close } = await launch();
  await win.getByRole('spinbutton').nth(0).fill(String(W));
  await win.getByRole('spinbutton').nth(1).fill(String(H));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - W) / 2);
  const oy = box.y + Math.round((box.height - H) / 2);
  const options = win.getByRole('toolbar', { name: 'Tool options' });
  const history = win.getByRole('list', { name: 'History' });

  await win.keyboard.press('t');
  await options.getByRole('spinbutton', { name: 'Font size' }).fill('48');
  await win.mouse.click(ox + 20, oy + 40);
  await win.keyboard.type('Hello World');
  // Select the last word, then colour it from the options bar: only it turns red.
  await win.keyboard.press(process.platform === 'darwin' ? 'Alt+Shift+ArrowLeft' : 'Control+Shift+ArrowLeft');
  await options.getByRole('button', { name: /^Text colour/ }).click();
  const picker = win.getByRole('dialog', { name: 'Text colour' });
  await picker.getByRole('textbox', { name: 'Hex' }).fill('FF0000');
  await picker.getByRole('button', { name: 'OK' }).click();
  await expect(win.getByRole('textbox', { name: 'Text' })).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(history).toContainText('Type Layer');
  await win.mouse.move(ox + 390, oy + 230);
  await expect.poll(async () => (await colours(win, ox + 10, oy + 30, 380, 80)).red).toBeGreaterThan(80);
  expect((await colours(win, ox + 10, oy + 30, 380, 80)).black).toBeGreaterThan(80);

  // Opening it again and leaving it as it was changes nothing (the styled runs read back exactly).
  await win.mouse.click(ox + 40, oy + 60);
  await expect(win.getByRole('textbox', { name: 'Text' })).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(history.getByRole('button', { name: 'Edit Type Layer' })).toHaveCount(0);

  // The font field lists fonts (installed ones where the system allows it), each in its own face.
  await options.getByRole('combobox', { name: 'Font' }).click();
  const fonts = win.getByRole('listbox', { name: 'Fonts' });
  await expect(fonts.getByRole('option').first()).toBeVisible();
  const first = await fonts.getByRole('option').first().textContent();
  await options.getByRole('combobox', { name: 'Font' }).press('Enter');
  await expect(options.getByRole('combobox', { name: 'Font' })).toHaveValue(first!);
  await close();
});

test(`[${target}] type tool: right-to-left text and emoji (FR-TXT-03)`, async () => {
  const { win, close } = await launch();
  await win.getByRole('spinbutton').nth(0).fill(String(W));
  await win.getByRole('spinbutton').nth(1).fill(String(H));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - W) / 2);
  const oy = box.y + Math.round((box.height - H) / 2);
  await win.keyboard.press('t');
  await win
    .getByRole('toolbar', { name: 'Tool options' })
    .getByRole('spinbutton', { name: 'Font size' })
    .fill('48');
  await win.mouse.click(ox + 20, oy + 40);
  await win.keyboard.insertText('مرحبا 👍');
  await win.keyboard.press('Escape');
  await expect(
    win.getByRole('listbox', { name: 'Layers' }).getByRole('option', { name: /مرحبا 👍/ }),
  ).toBeVisible();
  await win.mouse.move(ox + 390, oy + 230);
  await expect.poll(() => dark(win, ox + 10, oy + 30, 380, 80)).toBeGreaterThan(80);
  await close();
});
