import { z } from 'zod';

const Version = z.string().max(64);

/**
 * What the auto-updater is doing (FR-GEN-05, docs/08 §3). Main owns it and sends every change to all
 * windows ('update.status'); the renderer only shows it.
 */
export const UpdateStatus = z.discriminatedUnion('state', [
  /** This installation cannot update itself: a development build, or a deb/rpm managed by the OS. */
  z.object({ state: z.literal('unavailable'), reason: z.enum(['development', 'package-manager']) }),
  /** Up to date as of `checkedAt` (null: not checked yet this session). */
  z.object({ state: z.literal('idle'), checkedAt: z.number().nullable() }),
  z.object({ state: z.literal('checking') }),
  z.object({ state: z.literal('downloading'), version: Version, percent: z.number().min(0).max(100) }),
  /**
   * Downloaded. It installs on "Restart Now" (refused while `unsavedWork`) or when the app quits normally,
   * after the unsaved-changes prompts.
   */
  z.object({ state: z.literal('ready'), version: Version, unsavedWork: z.boolean() }),
  z.object({ state: z.literal('error'), message: z.string().max(300) }),
]);
export type UpdateStatus = z.infer<typeof UpdateStatus>;

/**
 * An uncaught error in a window, sent to main for an opt-in crash report (FR-GEN-07). Main scrubs it
 * (crash-reports.ts) and drops it unless the user turned crash reports on.
 */
export const CrashReportInput = z.object({
  kind: z.enum(['error', 'unhandledrejection']),
  name: z.string().max(200),
  message: z.string().max(4000),
  stack: z.string().max(20_000).nullable(),
});
export type CrashReportInput = z.infer<typeof CrashReportInput>;
