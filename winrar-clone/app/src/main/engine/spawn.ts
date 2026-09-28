// The only module allowed to start processes (enforced by ESLint no-restricted-imports).
// eslint-disable-next-line no-restricted-imports
import { spawn } from 'node:child_process';
import { LineSplitter } from './parsers/lines';

export type RunOptions = {
  binary: string;
  args: string[];
  cwd?: string;
  /** Answer for 7-Zip's "Enter password" prompt. */
  password?: string;
  /** Asked when 7-Zip prompts and no password was given. Resolve null to decline (process is stopped). */
  onPasswordPrompt?: () => Promise<string | null>;
  onStdoutLine?: (line: string, terminator: '\n' | '\r' | '\b') => void;
  signal?: AbortSignal;
};

export type RunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Last ~64 KB of stdout/stderr, for error classification. */
  stdoutTail: string;
  stderrTail: string;
  passwordPrompted: boolean;
  passwordDeclined: boolean;
  aborted: boolean;
};

const TAIL = 64 * 1024;
/** 7-Zip's prompt is printed on its own line; match the whole line so file names can't trigger it. */
const PROMPT = /^Enter password(?: \(will not be echoed\))?\s*:\s*$/i;
const KILL_GRACE_MS = 3000;

const ENV_KEYS = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE'];

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

function appendTail(tail: string, chunk: string): string {
  const next = tail + chunk;
  return next.length > TAIL ? next.slice(next.length - TAIL) : next;
}

export function run7z(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.binary, opts.args, {
      cwd: opts.cwd,
      env: minimalEnv(),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutTail = '';
    let stderrTail = '';
    let passwordPrompted = false;
    let passwordDeclined = false;
    let aborted = false;
    let killTimer: NodeJS.Timeout | undefined;

    const stop = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.stdin.destroy();
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    };

    const answerPrompt = async (): Promise<void> => {
      passwordPrompted = true;
      let password = opts.password;
      if (password === undefined && opts.onPasswordPrompt)
        password = (await opts.onPasswordPrompt()) ?? undefined;
      if (password === undefined) {
        passwordDeclined = true;
        stop();
        return;
      }
      child.stdin.end(`${password}\n`);
    };

    const splitter = new LineSplitter((line, term) => {
      if (!passwordPrompted && PROMPT.test(line.trim())) {
        void answerPrompt();
        return;
      }
      opts.onStdoutLine?.(line, term);
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutTail = appendTail(stdoutTail, chunk);
      splitter.push(chunk);
      // The prompt has no trailing newline, so it usually sits in the unterminated tail.
      if (!passwordPrompted && PROMPT.test(splitter.pending().trim())) void answerPrompt();
    });
    child.stderr.on('data', (chunk: string) => {
      stderrTail = appendTail(stderrTail, chunk);
    });
    // 7-Zip may exit before reading stdin; ignore EPIPE on the stdin stream.
    child.stdin.on('error', () => undefined);

    const onAbort = (): void => {
      aborted = true;
      stop();
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (exitCode, signal) => {
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      splitter.end();
      resolve({ exitCode, signal, stdoutTail, stderrTail, passwordPrompted, passwordDeclined, aborted });
    });
  });
}
