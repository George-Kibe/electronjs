import type { UpdateChannel } from '@shared/settings';
import type { Feed } from './release-feed';
import type { Updater, UpdaterEvents } from './updater';

type Logger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

/**
 * electron-updater with the generic provider, pointed at this product's newest release for the channel
 * (`resolveFeed`, ADR-0010; docs/08 §3). It verifies the download's SHA-512 from the release manifest, and
 * on Windows the installer's Authenticode publisher (from app-update.yml); macOS (Squirrel.Mac) requires a
 * signed app. Imported on first use, so startup does not load it.
 */
export async function loadElectronUpdater(
  events: UpdaterEvents,
  logger: Logger,
  resolveFeed: (channel: UpdateChannel) => Promise<Feed | null>,
): Promise<Updater> {
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
  let channel: UpdateChannel = 'latest';
  return {
    setChannel: (c) => {
      channel = c;
    },
    check: async () => {
      const feed = await resolveFeed(channel);
      // No release of this product for the channel yet: up to date.
      if (!feed) return events.notAvailable();
      u.setFeedURL({ provider: 'generic', url: feed.url, channel: feed.channel });
      u.channel = feed.channel;
      u.allowPrerelease = channel === 'beta';
      // Setting `channel` turns downgrades on; leaving beta must keep the newer version installed.
      u.allowDowngrade = false;
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
