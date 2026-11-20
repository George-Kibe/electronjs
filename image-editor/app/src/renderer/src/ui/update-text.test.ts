import { describe, expect, it } from 'vitest';
import { describeUpdate } from './update-text';

const say = (s: Parameters<typeof describeUpdate>[0]) => describeUpdate(s, 'ImageEditor', '0.1.0');

describe('update banner text (FR-GEN-05)', () => {
  it('asks to save before restarting while there is unsaved work', () => {
    expect(say({ state: 'ready', version: '0.2.0', unsavedWork: true })).toEqual({
      title: 'ImageEditor 0.2.0 is ready to install.',
      detail:
        'Save your work to restart. Otherwise it installs when you quit, after you decide about unsaved changes.',
    });
    expect(say({ state: 'ready', version: '0.2.0', unsavedWork: false }).detail).toBe(
      'Restart now, or it installs the next time you quit.',
    );
  });

  it('describes every other state', () => {
    expect(say({ state: 'idle', checkedAt: null }).title).toBe('ImageEditor 0.1.0');
    expect(say({ state: 'idle', checkedAt: 1 }).title).toBe('ImageEditor 0.1.0 is up to date.');
    expect(say({ state: 'checking' }).title).toBe('Checking for updates…');
    expect(say({ state: 'downloading', version: '0.2.0', percent: 40 }).title).toBe(
      'Downloading ImageEditor 0.2.0… 40 %',
    );
    expect(say({ state: 'error', message: 'No network.' }).title).toBe('No network.');
    expect(say({ state: 'unavailable', reason: 'development' }).title).toMatch(/development/);
    expect(say({ state: 'unavailable', reason: 'package-manager' }).title).toBe(
      'ImageEditor is updated by your package manager.',
    );
  });
});
