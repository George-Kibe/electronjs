import { z } from 'zod';
import { MAX_LIST_PAGE } from './constants';

/** Opaque handle to a user-chosen file. Main keeps the real path; the renderer only sees display strings. */
export const FileRef = z.object({
  id: z.uuid(),
  displayName: z.string(),
  displayDir: z.string(),
  kind: z.enum(['file', 'dir']),
});
export type FileRef = z.infer<typeof FileRef>;

export const EngineErrorCode = z.enum([
  'PASSWORD_REQUIRED',
  'WRONG_PASSWORD',
  'MISSING_VOLUME',
  'CRC_ERROR',
  'UNSUPPORTED_METHOD',
  'NOT_ARCHIVE',
  'CORRUPT_ARCHIVE',
  'DISK_FULL',
  'ACCESS_DENIED',
  'OUT_OF_MEMORY',
  'CANCELLED',
  'ENGINE_MISSING',
  'UNKNOWN',
]);
export type EngineErrorCode = z.infer<typeof EngineErrorCode>;

export const EntryDTO = z.object({
  path: z.string(),
  name: z.string(),
  isDir: z.boolean(),
  size: z.number().nonnegative(),
  packed: z.number().nonnegative().nullable(),
  modified: z.string().nullable(),
  crc: z.string().nullable(),
  encrypted: z.boolean(),
  method: z.string().nullable(),
  link: z.object({ kind: z.enum(['symlink', 'hardlink']), target: z.string() }).nullable(),
});
export type EntryDTO = z.infer<typeof EntryDTO>;

export const ArchiveInfo = z.object({
  format: z.string(),
  physicalSize: z.number().nullable(),
  solid: z.boolean().nullable(),
  multivolume: z.boolean(),
  volumes: z.number().int().positive(),
  encryptedHeaders: z.boolean(),
  hasEncryptedEntries: z.boolean(),
  method: z.string().nullable(),
  comment: z.string().nullable(),
  warnings: z.array(z.string()),
  totals: z.object({
    files: z.number().int().nonnegative(),
    folders: z.number().int().nonnegative(),
    size: z.number().nonnegative(),
    packed: z.number().nonnegative(),
  }),
});
export type ArchiveInfo = z.infer<typeof ArchiveInfo>;

export const OpenArchiveRequest = z.object({
  archive: FileRef,
  password: z.string().max(4096).optional(),
});
export const OpenArchiveResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('opened'), sessionId: z.uuid(), archive: FileRef, info: ArchiveInfo }),
  z.object({ status: z.literal('passwordRequired'), wrongPassword: z.boolean() }),
]);
export type OpenArchiveResult = z.infer<typeof OpenArchiveResult>;

export const SortSpec = z.object({
  key: z.enum(['name', 'size', 'packed', 'modified']),
  dir: z.enum(['asc', 'desc']),
});
export type SortSpec = z.infer<typeof SortSpec>;

export const ListRequest = z.object({
  sessionId: z.uuid(),
  folder: z.string().max(32_768),
  sort: SortSpec,
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(MAX_LIST_PAGE),
  filter: z.string().max(1024).optional(),
});
export type ListRequest = z.infer<typeof ListRequest>;
export const ListResult = z.object({ total: z.number().int().nonnegative(), entries: z.array(EntryDTO) });
export type ListResult = z.infer<typeof ListResult>;

export const AppInfo = z.object({
  productName: z.string(),
  version: z.string(),
  sevenZipVersion: z.string().nullable(),
  platform: z.string(),
  arch: z.string(),
});
export type AppInfo = z.infer<typeof AppInfo>;

/** Serializable error sent across IPC. */
export const IpcError = z.object({
  code: z.union([EngineErrorCode, z.enum(['VALIDATION_FAILED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL'])]),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type IpcError = z.infer<typeof IpcError>;
