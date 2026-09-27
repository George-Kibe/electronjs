import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  ipcContract,
  type Channel,
  type IpcResult,
  type RequestOf,
  type ResponseOf,
} from '@shared/ipc-contract';
import type { IpcError } from '@shared/schemas';
import { EngineError } from '../engine/errors';

export type Handler<C extends Channel> = (
  request: z.output<(typeof ipcContract)[C]['request']>,
  event: IpcMainInvokeEvent,
) => Promise<ResponseOf<C>> | ResponseOf<C>;

export type Handlers = { [C in Channel]: Handler<C> };

/** Minimal surface of ipcMain we depend on (keeps the router unit-testable). */
export type IpcMainLike = {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
};

/** Thrown by handlers for expected, user-facing failures. */
export class HandlerError extends Error {
  constructor(
    public readonly code: IpcError['code'],
    message: string,
  ) {
    super(message);
  }
}

export function toIpcError(err: unknown): IpcError {
  if (err instanceof EngineError)
    return { code: err.code, message: err.message, details: safeDetails(err.details) };
  if (err instanceof HandlerError) return { code: err.code, message: err.message };
  if (err instanceof z.ZodError) return { code: 'VALIDATION_FAILED', message: 'Invalid request.' };
  return { code: 'INTERNAL', message: 'Something went wrong.' };
}

function safeDetails(details: Record<string, unknown>): Record<string, unknown> {
  // Only forward known, non-sensitive fields to the renderer.
  const { volume, entries } = details as { volume?: unknown; entries?: unknown };
  return { ...(volume !== undefined && { volume }), ...(entries !== undefined && { entries }) };
}

/**
 * Registers every channel of the contract. Each call: sender check → zod-validate request → handler →
 * zod-validate response → `{ ok, data | error }` envelope.
 */
export function registerIpc(
  ipc: IpcMainLike,
  handlers: Handlers,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  onError: (channel: string, err: unknown) => void = () => undefined,
): void {
  for (const channel of Object.keys(ipcContract) as Channel[]) {
    const { request, response } = ipcContract[channel];
    const handler = handlers[channel] as Handler<Channel>;
    ipc.handle(channel, async (event, raw): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event)) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender.' } };
      }
      try {
        const req = (request as z.ZodType).parse(raw) as RequestOf<Channel>;
        const data = await handler(req as never, event);
        return { ok: true, data: (response as z.ZodType).parse(data) };
      } catch (err) {
        const error = toIpcError(err);
        if (error.code === 'INTERNAL' || error.code === 'VALIDATION_FAILED') onError(channel, err);
        return { ok: false, error };
      }
    });
  }
}
