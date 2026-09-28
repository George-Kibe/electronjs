import type { EngineErrorCode } from '@shared/schemas';

/** Typed failure from the 7-Zip engine. `details` never contains passwords. */
export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
