import { z } from 'zod';

/** Opaque handle to a user-chosen file; main keeps the real path (docs/04 §1). */
export const FileRef = z.object({
  id: z.uuid(),
  displayName: z.string(),
  displayDir: z.string(),
});
export type FileRef = z.infer<typeof FileRef>;

export const CodecErrorCode = z.enum([
  'UNSUPPORTED_FORMAT',
  'CORRUPT_IMAGE',
  'TOO_LARGE',
  'OUT_OF_MEMORY',
  'CANCELLED',
  'INTERNAL',
]);
export type CodecErrorCode = z.infer<typeof CodecErrorCode>;

export const AppInfo = z.object({
  productName: z.string(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  /** Physical RAM, for the automatic memory budget (docs/05 §3). */
  totalMemoryBytes: z.number().nonnegative(),
  /** E2E only (env E2E_AUTOSAVE_SECONDS): a short autosave interval, so recovery can be tested. */
  autosaveSecondsOverride: z.number().positive().nullable(),
});
export type AppInfo = z.infer<typeof AppInfo>;

export const IpcError = z.object({
  code: z.union([CodecErrorCode, z.enum(['VALIDATION_FAILED', 'FORBIDDEN', 'NOT_FOUND', 'WRITE_FAILED'])]),
  message: z.string(),
});
export type IpcError = z.infer<typeof IpcError>;
