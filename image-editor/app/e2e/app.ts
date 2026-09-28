import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const appRoot = resolve(import.meta.dirname, '..');
export const target = process.env.E2E_TARGET === 'packaged' ? 'packaged' : 'dev';

function packagedExecutable(): string {
  const dist = join(appRoot, 'dist');
  if (process.platform === 'win32') return join(dist, 'win-unpacked', 'ImageEditor.exe');
  if (process.platform === 'darwin') {
    const dir = readdirSync(dist).find((d) => d.startsWith('mac'));
    if (!dir) throw new Error(`No mac build in ${dist}`);
    return join(dist, dir, 'ImageEditor.app', 'Contents', 'MacOS', 'ImageEditor');
  }
  return join(dist, 'linux-unpacked', 'image-editor');
}

async function start(files: string[]): Promise<ElectronApplication> {
  if (target === 'packaged') {
    const executablePath = packagedExecutable();
    if (!existsSync(executablePath))
      throw new Error(`Packaged app missing: ${executablePath}. Run pnpm pack:dir`);
    return electron.launch({ executablePath, args: files });
  }
  return electron.launch({ args: ['.', ...files], cwd: appRoot });
}

/**
 * True when the window finished loading in Electron but Playwright's Page never saw the navigation.
 * app:// is cross-origin isolated (COOP/COEP), so the first navigation swaps renderer processes; if that
 * swap races Playwright's target attach, the Page stays on the pre-swap document (url '') forever and
 * no locator ever resolves, although the app itself rendered fine. Seen ~1 in 10 packaged launches on
 * Linux/xvfb, where DOM, visibility and IPC were all verified healthy from the main process.
 */
async function lostNavigation(app: ElectronApplication, win: Page): Promise<boolean> {
  if (win.url() !== '' && win.url() !== 'about:blank') return false;
  return app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]?.webContents;
    return !!wc && !wc.isLoading() && wc.getURL().length > 0;
  });
}

export async function launch(files: string[] = []): Promise<{ app: ElectronApplication; win: Page }> {
  const maxAttempts = 2; // 2 × 25 s + the test body stays inside the 90 s test timeout
  for (let attempt = 1; ; attempt++) {
    const app = await start(files);
    // Surface main-process logs (GPU/child-process crashes, codec errors) in the test output.
    app.process().stdout?.on('data', (d: Buffer) => process.stdout.write(`[main] ${d}`));
    app.process().stderr?.on('data', (d: Buffer) => process.stdout.write(`[main:err] ${d}`));
    const win = await app.firstWindow();
    win.on('console', (m) => console.log(`[renderer ${m.type()}] ${m.text()}`));
    win.on('crash', () => console.log('[renderer] CRASHED'));

    // firstWindow() can resolve before the app page commits, and on Windows the Page can take several
    // seconds to catch up with the navigation; wait for the app's own UI.
    try {
      await win.getByRole('button', { name: /Open/ }).first().waitFor({ timeout: 25_000 });
      return { app, win };
    } catch (err) {
      if (attempt >= maxAttempts || !(await lostNavigation(app, win))) throw err;
    }
    console.log(`[e2e] Playwright lost the page across the COOP/COEP process swap; relaunching (${attempt})`);
    await app.close();
  }
}

export async function snapshot(win: Page, name: string): Promise<void> {
  await win.screenshot({
    path: join(appRoot, 'test-results', 'screens', `${process.platform}-${target}-${name}.png`),
  });
}
