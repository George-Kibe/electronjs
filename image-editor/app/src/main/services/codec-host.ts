import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { MAX_INPUT_PIXELS } from '@shared/constants';
import type { CodecJob } from '@shared/codec-protocol';

/**
 * Owns the codec utilityProcess (docs/02 §2). Started lazily and restarted after a crash, so a malformed
 * image can only take down this process, never main or the window.
 */
export class CodecHost {
  private child: UtilityProcess | null = null;

  constructor(
    private readonly modulePath: string,
    private readonly onCrash: (code: number) => void = () => undefined,
  ) {}

  private process(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.modulePath, [], { serviceName: 'Image codec', stdio: 'inherit' });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (code !== 0) this.onCrash(code);
    });
    this.child = child;
    return child;
  }

  /** Starts a decode and hands the result port to `target`. Returns the request id. */
  decode(path: string, target: WebContents): string {
    const requestId = randomUUID();
    const { port1, port2 } = new MessageChannelMain();
    const job: CodecJob = { type: 'decode', requestId, path, limitInputPixels: MAX_INPUT_PIXELS };
    this.process().postMessage(job, [port1]);
    target.postMessage('codec.port', { requestId }, [port2]);
    return requestId;
  }

  /** Opens an encode session: the renderer streams pixels over the port and receives the file bytes. */
  encode(target: WebContents): string {
    const requestId = randomUUID();
    const { port1, port2 } = new MessageChannelMain();
    const job: CodecJob = { type: 'encode', requestId };
    this.process().postMessage(job, [port1]);
    target.postMessage('codec.port', { requestId }, [port2]);
    return requestId;
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}
