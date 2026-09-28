import type { MessagePortMain } from 'electron';
import { CODEC_CHUNK_BYTES, MAX_DOCUMENT_SIDE, MAX_INPUT_PIXELS } from '@shared/constants';
import type { CodecJob, CodecToRenderer, EncodeReply, RendererToCodec } from '@shared/codec-protocol';
import { ExportOptions } from '@shared/export-options';
import { CodecError, decodeToRgba, toCodecError } from './decode';
import { encodeRgba } from './encode';

/**
 * Codec host utilityProcess (ADR-0008). Parses untrusted image bytes away from main and the renderer, and
 * encodes exports. It never writes user files: results go back over the provided MessagePort.
 */
function send(port: MessagePortMain, message: CodecToRenderer | EncodeReply): void {
  port.postMessage(message);
}

async function decode(job: Extract<CodecJob, { type: 'decode' }>, port: MessagePortMain): Promise<void> {
  try {
    const { header, data } = await decodeToRgba(job.path, job.limitInputPixels);
    send(port, header);
    for (let offset = 0; offset < data.byteLength; offset += CODEC_CHUNK_BYTES) {
      send(port, { type: 'chunk', offset, data: data.subarray(offset, offset + CODEC_CHUNK_BYTES) });
    }
    send(port, { type: 'done' });
  } catch (err) {
    const e = toCodecError(err);
    send(port, { type: 'error', code: e.code, message: e.message });
  } finally {
    port.close();
  }
}

/** Receives pixels from the renderer, then encodes. The port closes after one reply. */
function encode(port: MessagePortMain): void {
  let pixels: Uint8Array | null = null;
  let start: Extract<RendererToCodec, { type: 'encode-start' }> | null = null;
  let received = 0;

  const fail = (err: unknown) => {
    const e =
      err instanceof CodecError ? err : new CodecError('INTERNAL', 'The image could not be exported.');
    send(port, { type: 'error', code: e.code, message: e.message });
    port.close();
  };

  port.on('message', (event) => {
    const msg = event.data as RendererToCodec;
    try {
      if (msg?.type === 'encode-start' && !start) {
        const { width, height } = msg;
        const sideOk = (n: unknown) =>
          Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_DOCUMENT_SIDE;
        if (!sideOk(width) || !sideOk(height) || width * height > MAX_INPUT_PIXELS)
          throw new CodecError('TOO_LARGE', 'This image is too large to export.');
        const options = ExportOptions.parse(msg.options);
        const exif = msg.exif instanceof Uint8Array && msg.exif.byteLength <= 65_533 ? msg.exif : null;
        start = { ...msg, options, exif };
        pixels = new Uint8Array(width * height * 4);
      } else if (msg?.type === 'chunk' && pixels) {
        const data = msg.data;
        if (
          !(data instanceof Uint8Array) ||
          !Number.isInteger(msg.offset) ||
          msg.offset < 0 ||
          msg.offset + data.byteLength > pixels.byteLength
        )
          throw new CodecError('INTERNAL', 'Invalid pixel data.');
        pixels.set(data, msg.offset);
        received += data.byteLength;
      } else if (msg?.type === 'encode-end' && start && pixels) {
        if (received !== pixels.byteLength) throw new CodecError('INTERNAL', 'Incomplete pixel data.');
        const { width, height, options, exif } = start;
        const px = pixels;
        pixels = null;
        encodeRgba(px, width, height, options, exif).then((bytes) => {
          send(port, { type: 'encoded', bytes });
          port.close();
        }, fail);
      } else {
        throw new CodecError('INTERNAL', 'Unexpected message.');
      }
    } catch (err) {
      pixels = null;
      fail(err);
    }
  });
  port.start();
}

process.parentPort.on('message', (event) => {
  const job = event.data as CodecJob;
  const port = event.ports[0];
  if (!port) return;
  if (job?.type === 'decode') void decode(job, port);
  else if (job?.type === 'encode') encode(port);
});
