import type { UpdateStatus } from '@shared/update';

export type UpdateText = { title: string; detail: string | null };

/** What the update banner and Preferences › Updates say for a status (FR-GEN-05, docs/08 §3). */
export function describeUpdate(status: UpdateStatus, product: string, version: string): UpdateText {
  switch (status.state) {
    case 'unavailable':
      return status.reason === 'development'
        ? { title: 'Updates are off in development builds.', detail: null }
        : {
            title: `${product} is updated by your package manager.`,
            detail: 'Install new versions the same way you installed this one.',
          };
    case 'idle':
      return status.checkedAt === null
        ? { title: `${product} ${version}`, detail: null }
        : { title: `${product} ${version} is up to date.`, detail: null };
    case 'checking':
      return { title: 'Checking for updates…', detail: null };
    case 'downloading':
      return {
        title: `Downloading ${product} ${status.version}… ${status.percent} %`,
        detail: 'You can keep working.',
      };
    case 'ready':
      return {
        title: `${product} ${status.version} is ready to install.`,
        detail: status.unsavedWork
          ? 'Save your work to restart. Otherwise it installs when you quit, after you decide about unsaved changes.'
          : 'Restart now, or it installs the next time you quit.',
      };
    case 'error':
      return { title: status.message, detail: null };
  }
}
