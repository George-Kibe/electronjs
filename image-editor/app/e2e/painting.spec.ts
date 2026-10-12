import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { canvasPixel, docCanvas, launch, paintLine, target } from './app';

const W = 300;
const H = 200;

async function newDocument(win: Page): Promise<void> {
  await win.getByRole('spinbutton').nth(0).fill(String(W));
  await win.getByRole('spinbutton').nth(1).fill(String(H));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  await expect(win.locator('footer')).toContainText('100 %'); // a small document fits at 100 %
}

/** Page coordinates of the centre of document pixel (x, y). The document is centred at 100 % zoom. */
async function docToPage(win: Page): Promise<(x: number, y: number) => [number, number]> {
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - W) / 2);
  const oy = box.y + Math.round((box.height - H) / 2);
  return (x, y) => [ox + x + 0.5, oy + y + 0.5];
}

/**
 * Page coordinates of document pixel centres after zooming from the fitted 100 % view to `zoom` around the
 * view centre (Ctrl+=). At zoom × devicePixelRatio ≥ 2 the canvas samples pixels unfiltered, so single
 * pixels can be checked exactly even on fractionally scaled displays.
 */
async function zoomedDocToPage(win: Page, zoom: number): Promise<(x: number, y: number) => [number, number]> {
  const box = (await docCanvas(win).boundingBox())!;
  const cx = box.width / 2 - Math.round((box.width - W) / 2); // document point at the view centre
  const cy = box.height / 2 - Math.round((box.height - H) / 2);
  return (x, y) => [
    box.x + box.width / 2 + (x + 0.5 - cx) * zoom,
    box.y + box.height / 2 + (y + 0.5 - cy) * zoom,
  ];
}

/** Counts light (holes in a textured stroke) and dark pixels in a page rectangle, from a real screenshot. */
async function tones(win: Page, x: number, y: number, width: number, height: number) {
  const png = await win.screenshot({ clip: { x, y, width, height }, scale: 'css' });
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let light = 0;
  let dark = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i]! > 200 && data[i + 1]! > 200 && data[i + 2]! > 200) light++;
    if (data[i]! < 60 && data[i + 1]! < 60 && data[i + 2]! < 60) dark++;
  }
  return { light, dark };
}

async function drag(win: Page, from: [number, number], to: [number, number]): Promise<void> {
  await win.mouse.move(...from);
  await win.mouse.down();
  await win.mouse.move(...to, { steps: 12 });
  await win.mouse.up();
}

const fg = (win: Page, hex: string) => win.getByRole('button', { name: `Foreground colour ${hex}` });
const history = (win: Page) => win.getByRole('list', { name: 'History' });

test(`[${target}] painting: colour picker, swap/default, eyedropper, pencil and textured tips (FR-PNT-01/02/06/07)`, async () => {
  const { win, close } = await launch();
  await newDocument(win);
  const at = await docToPage(win);
  await win.getByRole('button', { name: 'New layer', exact: true }).click();

  // Choose red in the colour picker and paint with it.
  await win.getByRole('button', { name: /^Foreground colour/ }).click();
  const picker = win.getByRole('dialog', { name: 'Foreground colour' });
  await picker.getByRole('textbox', { name: 'Hex' }).fill('FF0000');
  await expect(picker.getByRole('spinbutton', { name: 'Red' })).toHaveValue('255');
  await picker.getByRole('button', { name: 'OK' }).click();
  await expect(fg(win, '#FF0000')).toBeVisible();
  await paintLine(win, at(40, 50), at(260, 50));
  await expect.poll(() => canvasPixel(win, ...at(150, 50))).toEqual([255, 0, 0]);
  await expect(
    win.getByRole('group', { name: 'Recent colours' }).getByRole('button', { name: /#FF0000/ }),
  ).toBeVisible();

  // X swaps foreground and background; D restores black on white.
  await win.keyboard.press('x');
  await expect(fg(win, '#FFFFFF')).toBeVisible();
  await expect(win.getByRole('button', { name: 'Background colour #FF0000' })).toBeVisible();
  await win.keyboard.press('d');
  await expect(fg(win, '#000000')).toBeVisible();

  // Eyedropper (I) samples the stroke; Alt+click with the brush does the same.
  await win.keyboard.press('i');
  await win.mouse.click(...at(150, 50));
  await expect(fg(win, '#FF0000')).toBeVisible();
  await win.keyboard.press('d');
  await win.keyboard.press('b');
  await win.keyboard.down('Alt');
  await win.mouse.click(...at(150, 50));
  await win.keyboard.up('Alt');
  await expect(fg(win, '#FF0000')).toBeVisible();
  await expect(history(win)).not.toContainText(/Brush[\s\S]*Brush/); // sampling never painted

  // Pencil (Shift+B): a 1-px line with no anti-aliasing.
  await win.keyboard.press('d');
  await win.keyboard.press('Shift+B');
  const options = win.getByRole('toolbar', { name: 'Tool options' });
  await expect(options).toContainText('Pencil');
  await paintLine(win, at(40, 120), at(260, 120));
  await expect(history(win)).toContainText('Pencil');
  await win.keyboard.press('ControlOrMeta+=');
  await win.keyboard.press('ControlOrMeta+=');
  await expect(win.locator('footer')).toContainText('400 %');
  const zoomed = await zoomedDocToPage(win, 4);
  for (const x of [100, 150, 200]) {
    await expect.poll(() => canvasPixel(win, ...zoomed(x, 120))).toEqual([0, 0, 0]);
    expect(await canvasPixel(win, ...zoomed(x, 119))).toEqual([255, 255, 255]);
    expect(await canvasPixel(win, ...zoomed(x, 121))).toEqual([255, 255, 255]);
  }
  await win.keyboard.press('ControlOrMeta+0');
  await expect(win.locator('footer')).toContainText('100 %');

  // B keeps the group's current tool (the pencil); Shift+B switches back to the brush.
  await win.keyboard.press('b');
  await expect(options).toContainText('Pencil');
  await win.keyboard.press('Shift+B');
  await expect(options).toContainText('Brush');

  // Brush with the Chalk tip leaves paper texture showing inside the stroke.
  await options.getByRole('combobox', { name: 'Tip' }).selectOption('chalk');
  await options.getByRole('slider', { name: 'Size' }).fill('40');
  await paintLine(win, at(40, 165), at(260, 165));
  await win.mouse.move(5, 5); // keep the brush outline out of the measured area
  const [x0, y0] = at(80, 158);
  await expect.poll(async () => (await tones(win, x0, y0, 140, 14)).light).toBeGreaterThan(40);
  expect((await tones(win, x0, y0, 140, 14)).dark).toBeGreaterThan(300);
  await close();
});

test(`[${target}] move tool: drag, keep off-canvas pixels, nudge, align, lock and auto-select (FR-TRF-07)`, async () => {
  const { win, close } = await launch();
  await newDocument(win);
  const at = await docToPage(win);
  const black = (x: number, y: number) => expect.poll(() => canvasPixel(win, ...at(x, y))).toEqual([0, 0, 0]);
  const white = (x: number, y: number) =>
    expect.poll(() => canvasPixel(win, ...at(x, y))).toEqual([255, 255, 255]);

  // A crisp 20-px bar from x ≈ 90 to 210 on its own layer.
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await win.keyboard.press('Shift+B');
  await win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' }).fill('20');
  await paintLine(win, at(100, 100), at(200, 100));
  await black(150, 100);

  // Drag with the Move tool (V); undo puts it back.
  await win.keyboard.press('v');
  await drag(win, at(150, 100), at(190, 130));
  await expect(history(win)).toContainText('Move');
  await white(150, 100);
  await black(190, 130);
  await win.keyboard.press('ControlOrMeta+z');
  await black(150, 100);

  // Pixels dragged off the canvas are kept: dragging back restores them.
  await drag(win, at(150, 100), at(0, 100));
  await white(150, 100);
  await drag(win, at(30, 100), at(180, 100));
  await black(100, 100);
  await black(200, 100);

  // Arrow keys nudge (Shift = 10 px); quick nudges are one undo step.
  await win.keyboard.press('Shift+ArrowRight');
  await win.keyboard.press('Shift+ArrowRight');
  await win.keyboard.press('ArrowRight');
  await expect(history(win).getByText('Nudge')).toHaveCount(1);
  await black(225, 100);

  // Align to the canvas's left edge.
  await win.getByRole('button', { name: 'Align left edges' }).click();
  await expect(history(win)).toContainText('Align');
  await black(2, 100);
  await white(130, 100);

  // A position-locked layer refuses to move, with an explanation.
  await win.getByRole('button', { name: 'Lock position' }).click();
  await drag(win, at(30, 100), at(60, 100));
  await expect(win.getByRole('status').filter({ hasText: 'This layer is locked.' })).toBeVisible();
  await win.getByRole('button', { name: 'Lock position' }).click();

  // Auto-select picks the layer under the pointer.
  await win.getByRole('button', { name: 'New layer', exact: true }).click();
  await expect(win.getByRole('option', { name: /Layer 2/ })).toHaveAttribute('aria-selected', 'true');
  await win.getByRole('checkbox', { name: 'Auto-select' }).check();
  await drag(win, at(30, 100), at(30, 150));
  await expect(win.getByRole('option', { name: /Layer 1/ })).toHaveAttribute('aria-selected', 'true');
  await black(30, 150);
  await close();
});
