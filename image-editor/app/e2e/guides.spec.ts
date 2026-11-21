import { expect, test, type Page } from '@playwright/test';
import { docCanvas, launch, target, zoomField } from './app';

async function newDocument(win: Page, width: number, height: number) {
  await win.getByRole('spinbutton').nth(0).fill(String(width));
  await win.getByRole('spinbutton').nth(1).fill(String(height));
  await win.getByRole('button', { name: 'Create' }).click();
  await expect(win.locator('footer')).toContainText(/strokes RGBA/, { timeout: 15_000 });
  await expect(zoomField(win)).toHaveValue('100');
  const box = (await docCanvas(win).boundingBox())!;
  const ox = box.x + Math.round((box.width - width) / 2);
  const oy = box.y + Math.round((box.height - height) / 2);
  return { at: (x: number, y: number): [number, number] => [ox + x + 0.5, oy + y + 0.5], ox, oy };
}

const history = (win: Page) => win.getByRole('list', { name: 'History' });

/** The selection's bounds from the canvas's accessible name: [x, y, width, height]. */
async function selection(win: Page): Promise<number[]> {
  const name = (await docCanvas(win).getAttribute('aria-label')) ?? '';
  const m = /selection (\d+) by (\d+) at (\d+), (\d+)/.exec(name);
  return m ? [Number(m[3]), Number(m[4]), Number(m[1]), Number(m[2])] : [];
}

test(`[${target}] rulers, guides and snapping (FR-NAV-04)`, async () => {
  const { win, close } = await launch();
  const { at } = await newDocument(win, 300, 200);

  // Ctrl+R shows the rulers; dragging down out of the top ruler makes a horizontal guide.
  await win.keyboard.press('ControlOrMeta+r');
  const ruler = win.getByRole('img', { name: /Horizontal ruler/ });
  await expect(ruler).toBeVisible();
  const r = (await ruler.boundingBox())!;
  await win.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await win.mouse.down();
  const [gx, gy] = at(150, 80);
  await win.mouse.move(gx, gy - 0.5, { steps: 10 }); // on the boundary above pixel row 80: a guide at 80
  await win.mouse.up();
  await expect(history(win)).toContainText('New Guide');
  await expect(win.getByTestId('guides').locator('line')).toHaveCount(1);

  // A marquee dragged near the guide snaps its edge onto it.
  await win.keyboard.press('m');
  await win.mouse.move(...at(40, 30));
  await win.mouse.down();
  await win.mouse.move(...at(100, 76), { steps: 8 });
  await win.mouse.up();
  await expect
    .poll(async () => {
      const [, y, , h] = await selection(win);
      return y! + h!;
    })
    .toBe(80);
  await win.keyboard.press('ControlOrMeta+d');

  // The Move tool drags the guide off the canvas to delete it; undo brings it back.
  await win.keyboard.press('v');
  await win.mouse.move(...at(200, 80));
  await win.mouse.down();
  await win.mouse.move(...at(200, -40), { steps: 10 });
  await win.mouse.up();
  await expect(history(win)).toContainText('Delete Guide');
  await expect(win.getByTestId('guides')).toHaveCount(0);
  await win.keyboard.press('ControlOrMeta+z');
  await expect(win.getByTestId('guides').locator('line')).toHaveCount(1);
  await close();
});
