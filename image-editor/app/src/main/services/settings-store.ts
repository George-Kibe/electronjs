import { readFileSync, renameSync } from 'node:fs';
import { applyPatch, Settings, SETTINGS_VERSION, type SettingsPatch } from '@shared/settings';

/**
 * Settings file in userData (docs/05 §3/§4). Loaded synchronously at startup (some settings, such as GPU
 * off, must apply before the app is ready), validated with zod, migrated from older versions, and saved
 * atomically. A damaged file is kept aside as `settings.json.damaged-<time>` and defaults are used, so a bad
 * file can never stop the app from starting.
 */

/** Upgrades raw settings from version n to n + 1. None yet: version 1 is the first. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let out = raw;
  let version = typeof out['schemaVersion'] === 'number' ? out['schemaVersion'] : SETTINGS_VERSION;
  while (version < SETTINGS_VERSION) {
    const step = MIGRATIONS[version];
    if (step) out = step(out);
    version++;
  }
  return { ...out, schemaVersion: Math.max(version, SETTINGS_VERSION) };
}

export type SettingsStoreDeps = {
  path: string;
  writeAtomic(path: string, data: Uint8Array): Promise<void>;
  onWarning?(message: string, err?: unknown): void;
};

export class SettingsStore {
  private current: Settings;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(private readonly deps: SettingsStoreDeps) {
    this.current = this.load();
  }

  private load(): Settings {
    let text: string;
    try {
      text = readFileSync(this.deps.path, 'utf8');
    } catch {
      return Settings.parse({}); // first run
    }
    try {
      const raw: unknown = JSON.parse(text);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Not an object');
      return Settings.parse(migrate(raw as Record<string, unknown>));
    } catch (err) {
      const aside = `${this.deps.path}.damaged-${Date.now()}`;
      try {
        renameSync(this.deps.path, aside);
      } catch {
        // could not move it; it will be overwritten by the next save
      }
      this.deps.onWarning?.(`Settings file was damaged; using defaults (kept as ${aside})`, err);
      return Settings.parse({});
    }
  }

  get(): Settings {
    return this.current;
  }

  /** Validates and applies a patch, saves it, notifies listeners, and returns the new settings. */
  async update(patch: SettingsPatch): Promise<Settings> {
    const next = applyPatch(this.current, patch);
    this.current = next;
    for (const l of this.listeners) l(next);
    // Saves run one after another so an older write never lands after a newer one.
    const data = new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`);
    this.writing = this.writing.then(() => this.deps.writeAtomic(this.deps.path, data));
    await this.writing;
    return next;
  }

  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
