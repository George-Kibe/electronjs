import { CODEC_PORT_MESSAGE } from '@shared/constants';
import type { CodecToRenderer, DecodedHeader } from '@shared/codec-protocol';
import type { FileRef } from '@shared/schemas';
import { ApiError } from '@shared/ipc-errors';
import { api } from './api';

// Ports arrive from the preload via window.postMessage, possibly before the invoke() that requested them
// resolves, so keep early arrivals until someone asks for them.
const arrived = new Map<string, MessagePort>();
const waiting = new Map<string, (port: MessagePort) => void>();

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { type?: string; requestId?: string } | null;
  const port = event.ports[0];
  if (data?.type !== CODEC_PORT_MESSAGE || !data.requestId || !port) return;
  const resolve = waiting.get(data.requestId);
  if (resolve) {
    waiting.delete(data.requestId);
    resolve(port);
  } else {
    arrived.set(data.requestId, port);
  }
});

/** The MessagePort main delivered for a codec request (decode or encode). */
export function codecPort(requestId: string, timeoutMs = 30_000): Promise<MessagePort> {
  const early = arrived.get(requestId);
  if (early) {
    arrived.delete(requestId);
    return Promise.resolve(early);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(requestId);
      reject(new Error('The image codec did not respond.'));
    }, timeoutMs);
    waiting.set(requestId, (port) => {
      clearTimeout(timer);
      resolve(port);
    });
  });
}

/** Decodes an image in the codec host; pixels stream over a direct MessagePort (docs/04 §1.1). */
export async function decodeImage(ref: FileRef): Promise<{ header: DecodedHeader; rgba: Uint8Array }> {
  const { requestId } = await api.codec.decode(ref);
  const port = await codecPort(requestId);
  return new Promise((resolve, reject) => {
    let header: DecodedHeader | null = null;
    let rgba: Uint8Array | null = null;
    port.onmessage = (event: MessageEvent<CodecToRenderer>) => {
      const msg = event.data;
      if (msg.type === 'decoded-header') {
        header = msg;
        rgba = new Uint8Array(msg.byteLength);
      } else if (msg.type === 'chunk') {
        rgba?.set(msg.data, msg.offset);
      } else if (msg.type === 'done') {
        port.close();
        if (header && rgba) resolve({ header, rgba });
        else reject(new Error('The image decoder returned no data.'));
      } else if (msg.type === 'error') {
        port.close();
        reject(new ApiError({ code: msg.code, message: msg.message }));
      }
    };
    port.start();
  });
}
