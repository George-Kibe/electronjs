import type { UpdateChannel } from '@shared/settings';
import type { Updater, UpdaterEvents } from './updater';

type Logger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

/**
 * electron-updater with the GitHub provider (publish config in electron-builder.yml, docs/08 §3). It
 * verifies the download's SHA-512 from the release manifest, and on Windows the installer's Authenticode
 * publisher; macOS (Squirrel.Mac) requires a signed app. Imported on first use, so startup does not load it.
 */
export async function loadElectronUpdater(events: UpdaterEvents, logger: Logger): Promise<Updater> {
  // CommonJS package whose `autoUpdater` export is a lazy getter, so only the default import works from ESM.
  const { default: electronUpdater } = await import('electron-updater');
  const u = electronUpdater.autoUpdater;
  u.logger = logger;
  u.autoDownload = true;
  // A downloaded update installs when the app quits normally, i.e. after every unsaved-changes prompt.
  u.autoInstallOnAppQuit = true;
  u.on('update-available', (info) => events.available(info.version));
  u.on('update-not-available', () => events.notAvailable());
  u.on('download-progress', (p) => events.progress(p.percent));
  u.on('update-downloaded', (info) => events.downloaded(info.version));
  u.on('error', (err) => events.error(err));
  return {
    setChannel: (channel: UpdateChannel) => {
      u.channel = channel;
      u.allowPrerelease = channel === 'beta';
      // Setting `channel` turns downgrades on; leaving beta must keep the newer version installed.
      u.allowDowngrade = false;
    },
    check: async () => {
      await u.checkForUpdates();
    },
    // Silent install (the assisted installer reuses the chosen folder), then start the new version.
    quitAndInstall: () => u.quitAndInstall(true, true),
  };
}

/**
 * E2E only (env E2E_FAKE_UPDATE): a scripted update feed, because a real one needs a signed, published
 * release. 'none' reports no update, 'error' fails, anything else is the version that "downloads".
 * quitAndInstall writes `installedMarker` and quits, so a test can tell an install from a crash.
 */
export function fakeUpdater(
  script: string,
  events: UpdaterEvents,
  hooks: { quit(): void; markInstalled(): void },
): Updater {
  const later = (fn: () => void) => setTimeout(fn, 50);
  return {
    setChannel: () => undefined,
    check: async () => {
      await new Promise<void>((done) => later(done));
      if (script === 'none') events.notAvailable();
      else if (script === 'error') events.error(new Error('E2E fake update feed failure'));
      else {
        events.available(script);
        later(() => {
          events.progress(50);
          later(() => {
            events.progress(100);
            events.downloaded(script);
          });
        });
      }
    },
    quitAndInstall: () => {
      hooks.markInstalled();
      hooks.quit();
    },
  };
}
