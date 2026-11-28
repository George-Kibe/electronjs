import { z } from 'zod';

/**
 * User settings (docs/05 §3, FR-GEN-02/04). Every field has a default, so `Settings.parse({})` is a complete
 * settings object and older or partial files fill in the rest. Sections are loose objects: fields written
 * by a newer version are kept when this version saves. Bump SETTINGS_VERSION and add a migration in
 * main/services/settings-store.ts when a field changes meaning.
 */
export const SETTINGS_VERSION = 1;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const GeneralSettings = z.looseObject({
  theme: z.enum(['system', 'light', 'dark']).default('dark'),
  /** On top of the OS scaling (docs/03 §7). */
  interfaceScale: z.number().min(0.9).max(1.5).default(1),
  /** Surround of the canvas; null follows the theme (neutral grey, FR-GEN-02). */
  canvasColor: hexColor.nullable().default(null),
  /** Painting cursor: the brush outline, or a precise crosshair (FR-GEN-04). */
  brushCursor: z.enum(['outline', 'precise']).default('outline'),
});

export const PerformanceSettings = z.looseObject({
  historySteps: z.number().int().min(20).max(1000).default(100),
  /** Memory for history and snapshots; null = automatic (a quarter of RAM, 1–8 GB). */
  memoryBudgetMB: z.number().int().min(512).max(65_536).nullable().default(null),
  /** 'off' uses software rendering; applied at the next launch. */
  gpu: z.enum(['auto', 'off']).default('auto'),
});

export const FilesSettings = z.looseObject({
  /** Recovery snapshot interval (FR-DOC-10); 0 turns autosave off. */
  autosaveMinutes: z.number().int().min(0).max(60).default(2),
  /** New document presets saved by the user (FR-DOC-01). */
  documentPresets: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        width: z.number().int().min(1).max(20_000),
        height: z.number().int().min(1).max(20_000),
        ppi: z.number().min(1).max(10_000),
      }),
    )
    .max(30)
    .default([]),
});

export const PANEL_IDS = ['layers', 'swatches', 'history'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const PanelState = z.object({
  id: z.enum(PANEL_IDS),
  /** Shown in the dock (Window menu). */
  visible: z.boolean(),
  /** Expanded (false = only the header shows). */
  open: z.boolean(),
  /** Share of the dock's height among open panels (flex-grow weight). */
  size: z.number().min(0.1).max(10),
});
export type PanelState = z.infer<typeof PanelState>;

/** Panel layout (FR-GEN-01, docs/03 §3): order, visibility, sizes and the dock width. */
export const WorkspaceSettings = z.looseObject({
  preset: z.enum(['essentials', 'photography', 'custom']).default('essentials'),
  /** null = the preset's layout. */
  panels: z.array(PanelState).max(PANEL_IDS.length).nullable().default(null),
  width: z.number().int().min(200).max(480).default(240),
});

export const PrivacySettings = z.looseObject({
  /** Opt-in crash reports without image content or file names (FR-GEN-07). */
  crashReports: z.boolean().default(false),
});

export const Settings = z.looseObject({
  schemaVersion: z.number().int().default(SETTINGS_VERSION),
  general: GeneralSettings.default(() => GeneralSettings.parse({})),
  performance: PerformanceSettings.default(() => PerformanceSettings.parse({})),
  files: FilesSettings.default(() => FilesSettings.parse({})),
  privacy: PrivacySettings.default(() => PrivacySettings.parse({})),
  workspace: WorkspaceSettings.default(() => WorkspaceSettings.parse({})),
});
export type Settings = z.infer<typeof Settings>;

/**
 * Patch schema for one section: the same fields, each optional and *without* its default (a patch that
 * omits a field must leave it alone, not reset it).
 */
function patchOf<T extends z.ZodRawShape>(section: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(section.shape).map(([k, v]) => [
      k,
      (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType)).optional(),
    ]),
  );
  return z.strictObject(shape);
}

/** A change from the Preferences dialog: any subset of fields in any section. */
export const SettingsPatch = z.strictObject({
  general: patchOf(GeneralSettings).optional(),
  performance: patchOf(PerformanceSettings).optional(),
  files: patchOf(FilesSettings).optional(),
  privacy: patchOf(PrivacySettings).optional(),
  workspace: patchOf(WorkspaceSettings).optional(),
});
export type SettingsPatch = {
  general?: Partial<Settings['general']>;
  performance?: Partial<Settings['performance']>;
  files?: Partial<Settings['files']>;
  privacy?: Partial<Settings['privacy']>;
  workspace?: Partial<Settings['workspace']>;
};

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

/** The settings after applying `patch` (validated: throws a ZodError for out-of-range values). */
export function applyPatch(settings: Settings, patch: SettingsPatch): Settings {
  const p = SettingsPatch.parse(patch) as SettingsPatch;
  return Settings.parse({
    ...settings,
    general: { ...settings.general, ...p.general },
    performance: { ...settings.performance, ...p.performance },
    files: { ...settings.files, ...p.files },
    privacy: { ...settings.privacy, ...p.privacy },
    workspace: { ...settings.workspace, ...p.workspace },
  });
}

/** History/snapshot memory budget in bytes: the setting, or a quarter of RAM clamped to 1–8 GB. */
export function memoryBudgetBytes(settings: Settings, totalMemBytes: number): number {
  const mb = settings.performance.memoryBudgetMB;
  if (mb !== null) return mb * 1024 ** 2;
  return Math.min(8 * 1024 ** 3, Math.max(1024 ** 3, Math.floor(totalMemBytes / 4)));
}
