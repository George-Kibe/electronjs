import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { canvasPixel, docCanvas, launch, paintLine, target, zoomField } from './app';

async function newDocument(win: Page, width: number, height: number): Promise<void> {
  const form = win.getByRole('form', { name: 'New document' });
  await form.getByRole('spinbutton', { name: 'Width' }).fill(String(width));
  await form.getByRole('spinbutton', { name: 'Height' }).fill(String(height));
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
}

async function docToPage(win: Page, w: number, h: number) {
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - w) / 2);
  const oy = box.y + Math.round((box.height - h) / 2);
  const at = (x: number, y: number): [number, number] => [ox + x + 0.5, oy + y + 0.5];
  /** A pixel corner: the marquee snaps to the nearest pixel edge, so drags go edge to edge. */
  const edge = (x: number, y: number): [number, number] => [ox + x, oy + y];
  return Object.assign(at, { edge });
}

async function drag(win: Page, from: [number, number], to: [number, number], modifiers: string[] = []) {
  for (const m of modifiers) await win.keyboard.down(m);
  await win.mouse.move(...from);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++)
    await win.mouse.move(from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8);
  await win.mouse.up();
  for (const m of modifiers) await win.keyboard.up(m);
}

/** Clicks a native menu item by its label path (Playwright cannot open native menus). */
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

const selection = (win: Page) => docCanvas(win);
const history = (win: Page) => win.getByRole('list', { name: 'History' });
const black = (rgb: number[]) => rgb.every((c) => c < 40);
const white = (rgb: number[]) => rgb.every((c) => c > 215);

test(`[${target}] selections: marquee, modes, Select menu, painting and Delete stay inside (FR-SEL-01/04/05/06)`, async () => {
  const { app, win, close } = await launch();
  await newDocument(win, 300, 200);
  const at = await docToPage(win, 300, 200);

  // Rectangular Marquee (M): drag a box.
  await win.keyboard.press('m');
  await expect(win.getByRole('toolbar', { name: 'Tool options' })).toContainText('Marquee');
  await drag(win, at.edge(50, 50), at.edge(150, 120));
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 100 by 70 at 50, 50$/);
  await expect(history(win)).toContainText('Rectangular Marquee');
  await expect(win.locator('svg .marching-ants')).toHaveCount(1);

  // Painting reaches only the selected pixels.
  await win.keyboard.press('b');
  await win.getByRole('toolbar', { name: 'Tool options' }).getByRole('slider', { name: 'Size' }).fill('20');
  await paintLine(win, at(20, 85), at(280, 85));
  await expect.poll(async () => black(await canvasPixel(win, ...at(100, 85)))).toBe(true);
  expect(white(await canvasPixel(win, ...at(30, 85)))).toBe(true);
  expect(white(await canvasPixel(win, ...at(250, 85)))).toBe(true);

  // Delete clears the selected pixels (to transparency: the checkerboard shows through).
  await win.keyboard.press('Delete');
  await expect(history(win)).toContainText('Clear');
  await expect.poll(async () => black(await canvasPixel(win, ...at(100, 85)))).toBe(false);
  await win.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => black(await canvasPixel(win, ...at(100, 85)))).toBe(true);

  // Deselect, Reselect, Inverse, Select All (keys and the Select menu).
  await win.keyboard.press('ControlOrMeta+d');
  await expect(selection(win)).toHaveAttribute('aria-label', 'Canvas, 300 by 200 pixels');
  await expect(win.locator('svg .marching-ants')).toHaveCount(0);
  await win.keyboard.press('ControlOrMeta+Shift+d');
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 100 by 70 at 50, 50$/);
  await win.keyboard.press('ControlOrMeta+Shift+i');
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 300 by 200 at 0, 0$/);
  await win.keyboard.press('ControlOrMeta+z');
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 100 by 70 at 50, 50$/);
  await menu(app, ['Select', 'All']);
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 300 by 200 at 0, 0$/);
  await win.keyboard.press('ControlOrMeta+a'); // already all: no new step
  await win.keyboard.press('m');

  // A click without a drag deselects; Shift adds, Alt subtracts (FR-SEL-04).
  await win.mouse.click(...at(10, 10));
  await expect(selection(win)).toHaveAttribute('aria-label', 'Canvas, 300 by 200 pixels');
  await drag(win, at.edge(50, 50), at.edge(150, 120));
  await drag(win, at.edge(200, 50), at.edge(250, 100), ['Shift']);
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 200 by 70 at 50, 50$/);
  await drag(win, at.edge(40, 40), at.edge(160, 130), ['Alt']);
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 50 by 50 at 200, 50$/);

  // Elliptical Marquee (Shift+M) replaces the selection with an ellipse.
  await win.keyboard.press('Shift+m');
  await expect(
    win.getByRole('toolbar', { name: 'Tool options' }).getByRole('combobox', { name: 'Shape' }),
  ).toHaveValue('ellipse');
  await drag(win, at.edge(20, 20), at.edge(220, 180));
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 200 by 160 at 20, 20$/);
  await expect(history(win)).toContainText('Elliptical Marquee');
  await close();
});

test(`[${target}] lasso: freehand and polygonal outlines become selections (FR-SEL-02)`, async () => {
  const { win, close } = await launch();
  await newDocument(win, 300, 200);
  const at = await docToPage(win, 300, 200);

  // Freehand (L): a loop around a box; it closes itself on release.
  await win.keyboard.press('l');
  const loop: Array<[number, number]> = [
    [40, 30],
    [140, 30],
    [140, 110],
    [40, 110],
  ];
  await win.mouse.move(...at.edge(...loop[0]!));
  await win.mouse.down();
  for (const [i, p] of [...loop.slice(1), loop[0]!].entries()) {
    const from = loop[i]!;
    for (let k = 1; k <= 10; k++)
      await win.mouse.move(
        ...at.edge(from[0] + ((p[0] - from[0]) * k) / 10, from[1] + ((p[1] - from[1]) * k) / 10),
      );
  }
  await win.mouse.up();
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 100 by 80 at 40, 30$/);
  await expect(history(win)).toContainText('Lasso');

  // Polygonal (Shift+L): click the corners, Enter closes.
  await win.keyboard.press('Shift+l');
  await expect(
    win.getByRole('toolbar', { name: 'Tool options' }).getByRole('combobox', { name: 'Kind' }),
  ).toHaveValue('polygon');
  const corners: Array<[number, number]> = [
    [160, 40],
    [260, 40],
    [260, 160],
  ];
  for (const [x, y] of corners) await win.mouse.click(...at.edge(x, y));
  await expect(win.locator('svg polyline.marching-ants')).toHaveCount(1); // the outline so far
  await win.keyboard.press('Enter');
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 100 by 120 at 160, 40$/);
  await expect(history(win)).toContainText('Polygonal Lasso');

  // Shift adds; clicking the first vertex closes; Esc abandons; Backspace removes the last point.
  await win.keyboard.down('Shift');
  await win.mouse.click(...at.edge(20, 150));
  await win.keyboard.up('Shift');
  await win.mouse.click(...at.edge(60, 150));
  await win.mouse.click(...at.edge(60, 190));
  await win.mouse.click(...at.edge(20, 150)); // back on the first vertex
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 240 by 150 at 20, 40$/);
  await win.mouse.click(...at.edge(100, 120));
  await win.mouse.click(...at.edge(120, 120));
  await win.keyboard.press('Backspace');
  await win.keyboard.press('Escape');
  await expect(win.locator('svg polyline')).toHaveCount(0);
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 240 by 150 at 20, 40$/); // unchanged
  await close();
});

test(`[${target}] magic wand: contiguous and not, in the ops worker (FR-SEL-03)`, async () => {
  const { win, close } = await launch();
  await newDocument(win, 300, 200);
  const at = await docToPage(win, 300, 200);
  const options = win.getByRole('toolbar', { name: 'Tool options' });

  // Two exact black rectangles: a big brush dab clipped by a marquee selection, twice.
  for (const [box, centre] of [
    [
      [50, 50, 150, 120],
      [100, 85],
    ],
    [
      [200, 130, 260, 180],
      [230, 155],
    ],
  ] as Array<[[number, number, number, number], [number, number]]>) {
    await win.keyboard.press('m');
    await drag(win, at.edge(box[0], box[1]), at.edge(box[2], box[3]));
    await win.keyboard.press('b');
    await options.getByRole('slider', { name: 'Size' }).fill('200');
    await options.getByRole('slider', { name: 'Size' }).blur();
    await win.mouse.click(...at(...centre));
  }
  await win.keyboard.press('ControlOrMeta+d');

  await win.keyboard.press('w');
  await options.getByRole('button', { name: "Smooth the selection's edge" }).click(); // anti-alias off
  await win.mouse.click(...at(100, 85));
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 100 by 70 at 50, 50$/);
  await expect(history(win)).toContainText('Magic Wand');

  await options.getByRole('button', { name: 'Only the connected area around the click' }).click(); // off
  await win.mouse.click(...at(100, 85));
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 210 by 130 at 50, 50$/);

  // Shift adds: the white background joins the two rectangles, so everything is selected.
  await win.keyboard.down('Shift');
  await win.mouse.click(...at(10, 10));
  await win.keyboard.up('Shift');
  await expect(selection(win)).toHaveAttribute('aria-label', /selection 300 by 200 at 0, 0$/);
  await close();
});
