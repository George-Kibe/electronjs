import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { appRoot } from '../test/helpers/seven-zip';

export const target = process.env.E2E_TARGET === 'packaged' ? 'packaged' : 'dev';

/** Executable produced by `electron-builder --dir` for this OS. */
function packagedExecutable(): string {
  const dist = join(appRoot, 'dist');
  if (process.platform === 'win32') return join(dist, 'win-unpacked', 'WinrarClone.exe');
  if (process.platform === 'darwin') {
    const dir = readdirSync(dist).find((d) => d.startsWith('mac'));
    if (!dir) throw new Error(`No mac build in ${dist}`);
    return join(dist, dir, 'WinrarClone.app', 'Contents', 'MacOS', 'WinrarClone');
  }
  return join(dist, 'linux-unpacked', 'winrar-clone');
}

export async function launch(files: string[] = []): Promise<{ app: ElectronApplication; win: Page }> {
  let app: ElectronApplication;
  if (target === 'packaged') {
    const executablePath = packagedExecutable();
    if (!existsSync(executablePath))
      throw new Error(`Packaged app missing: ${executablePath}. Run pnpm pack:dir`);
    app = await electron.launch({ executablePath, args: files });
  } else {
    // Same as `electron .`: package.json main → out/main/index.js.
    app = await electron.launch({ args: ['.', ...files], cwd: appRoot });
  }
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win };
}

/** Saves a screenshot per OS/target for visual review in CI artifacts. */
export async function snapshot(win: Page, name: string): Promise<void> {
  await win.screenshot({
    path: join(appRoot, 'test-results', 'screens', `${process.platform}-${target}-${name}.png`),
  });
}
