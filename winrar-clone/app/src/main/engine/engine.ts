import { existsSync } from 'node:fs';
import { infoArgs, listArgs } from './args';
import { EngineError } from './errors';
import { classifyFailure } from './parsers/errors';
import { ListParser, type ParsedArchive } from './parsers/list';
import { run7z, type RunResult } from './spawn';
import { firstVolumePath } from './volumes';

export type ListOptions = {
  password?: string;
  onPasswordPrompt?: () => Promise<string | null>;
  signal?: AbortSignal;
};

export type ArchiveListing = ParsedArchive & {
  /** Path actually opened (first volume of a set). */
  archivePath: string;
  /** True when 7-Zip needed a password just to read the listing (encrypted headers). */
  encryptedHeaders: boolean;
};

export class SevenZipEngine {
  constructor(
    private readonly binary: string,
    private readonly exists: (p: string) => boolean = existsSync,
  ) {}

  private assertBinary(): void {
    if (!this.exists(this.binary)) {
      throw new EngineError('ENGINE_MISSING', 'The bundled 7-Zip engine was not found.', {
        binary: this.binary,
      });
    }
  }

  /** Version from the banner, e.g. "26.03", or null if it cannot be determined. */
  async version(): Promise<string | null> {
    this.assertBinary();
    let version: string | null = null;
    await run7z({
      binary: this.binary,
      args: infoArgs(),
      onStdoutLine: (line) => {
        version ??= /^7-Zip(?: \([a-z]\))? (\d+\.\d+)/.exec(line.trim())?.[1] ?? null;
      },
    });
    return version;
  }

  async list(path: string, opts: ListOptions = {}): Promise<ArchiveListing> {
    this.assertBinary();
    const archivePath = firstVolumePath(path, this.exists);
    const parser = new ListParser();
    const result = await run7z({
      binary: this.binary,
      args: listArgs(archivePath),
      password: opts.password,
      onPasswordPrompt: opts.onPasswordPrompt,
      signal: opts.signal,
      onStdoutLine: (line, term) => {
        if (term === '\n') parser.line(line);
      },
    });
    const parsed = parser.end();

    if (result.exitCode === 0 || (result.exitCode === 1 && parsed.entries.length > 0)) {
      return { ...parsed, archivePath, encryptedHeaders: result.passwordPrompted };
    }
    throw this.failure(result, opts.password !== undefined);
  }

  private failure(result: RunResult, hadPassword: boolean): EngineError {
    if (result.aborted) return new EngineError('CANCELLED', 'The operation was cancelled.');
    if (result.passwordDeclined)
      return new EngineError('PASSWORD_REQUIRED', 'This archive needs a password.');
    const { code, details } = classifyFailure(result.exitCode, result.stdoutTail, result.stderrTail);
    if (code === 'WRONG_PASSWORD' && !hadPassword && result.passwordPrompted) {
      return new EngineError('PASSWORD_REQUIRED', 'This archive needs a password.');
    }
    return new EngineError(code, MESSAGES[code] ?? MESSAGES.UNKNOWN!, {
      ...details,
      exitCode: result.exitCode,
    });
  }
}

const MESSAGES: Partial<Record<EngineError['code'], string>> = {
  WRONG_PASSWORD: 'The password is incorrect.',
  MISSING_VOLUME: 'A volume of this multi-part archive is missing.',
  NOT_ARCHIVE: 'This file is not an archive, or its format is not supported.',
  CORRUPT_ARCHIVE: 'The archive is damaged.',
  CRC_ERROR: 'Some files in the archive are damaged (CRC error).',
  UNSUPPORTED_METHOD: 'The archive uses a compression method that is not supported.',
  DISK_FULL: 'There is not enough disk space.',
  ACCESS_DENIED: 'Access to a file or folder was denied.',
  OUT_OF_MEMORY: 'Not enough memory to open this archive.',
  CANCELLED: 'The operation was cancelled.',
  UNKNOWN: 'The archive could not be processed.',
};
