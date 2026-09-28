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

export async function launch(files: string[] = []): Promise<{ app: ElectronApplication; win: Page }> {
  let app: ElectronApplication;
  if (target === 'packaged') {
    const executablePath = packagedExecutable();
    if (!existsSync(executablePath))
      throw new Error(`Packaged app missing: ${executablePath}. Run pnpm pack:dir`);
    app = await electron.launch({ executablePath, args: files });
  } else {
    app = await electron.launch({ args: ['.', ...files], cwd: appRoot });
  }
  // Surface main-process logs (GPU/child-process crashes, codec errors) in the test output.
  app.process().stdout?.on('data', (d: Buffer) => process.stdout.write(`[main] ${d}`));
  app.process().stderr?.on('data', (d: Buffer) => process.stdout.write(`[main:err] ${d}`));
  const win = await app.firstWindow();
  win.on('console', (m) => console.log(`[renderer ${m.type()}] ${m.text()}`));
  win.on('crash', () => console.log('[renderer] CRASHED'));
  // firstWindow() can resolve before the app page commits; wait for the app's own UI (survives navigations).
  await win.getByRole('button', { name: /Open/ }).first().waitFor({ timeout: 30_000 });
  return { app, win };
}

export async function snapshot(win: Page, name: string): Promise<void> {
  await win.screenshot({
    path: join(appRoot, 'test-results', 'screens', `${process.platform}-${target}-${name}.png`),
  });
}
