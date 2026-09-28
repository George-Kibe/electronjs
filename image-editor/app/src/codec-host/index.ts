import type { MessagePortMain } from 'electron';
import { CODEC_CHUNK_BYTES } from '@shared/constants';
import type { CodecJob, CodecToRenderer } from '@shared/codec-protocol';
import { decodeToRgba, toCodecError } from './decode';

/**
 * Codec host utilityProcess (ADR-0008). Parses untrusted image bytes away from main and the renderer.
 * It never writes user files in M0; results go straight to the renderer over the provided MessagePort.
 */
function send(port: MessagePortMain, message: CodecToRenderer): void {
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

process.parentPort.on('message', (event) => {
  const job = event.data as CodecJob;
  const port = event.ports[0];
  if (!port || job?.type !== 'decode') return;
  void decode(job, port);
});
