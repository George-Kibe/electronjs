import { randomUUID } from 'node:crypto';
import type { CrashReportInput } from '@shared/update';

/**
 * Opt-in crash reports (FR-GEN-07, ADR-0009, docs/06 §5). Uncaught errors in main and the windows, and
 * crashed renderer/GPU/utility processes, become small JSON events in the Sentry envelope format, sent to
 * the build's DSN only while Preferences › Privacy › "Send crash reports" is on. Nothing is stored or
 * queued. A report holds the error type, a scrubbed message, stack frames normalised to `app:///` paths,
 * the app version and channel, the OS name/version and CPU architecture. It never holds image data, file
 * names or paths, document contents, breadcrumbs, a user id or the host name. No native minidumps: they
 * can contain memory fragments such as pixels.
 */

export type CrashContext = {
  version: string;
  /** Update channel, reported as the environment ('production' or 'beta'). */
  channel(): string;
  platform: NodeJS.Platform;
  osVersion: string;
  arch: string;
  electron: string;
  chrome: string;
  /** Strings that identify the user or machine (home folder, user name, host name): always removed. */
  secrets: string[];
};

type Frame = { function: string; filename: string; lineno: number; colno: number; in_app: boolean };

const MAX_TEXT = 1000;
const MAX_FRAMES = 50;

const IMAGE_EXTENSIONS = 'png|jpe?g|webp|avif|gif|bmp|tiff?|psd|iep|heic|heif|svg|raw|dng|cr2|nef|arw';

/** Identifier-like quoted values (property names, enum values) are kept; anything else in quotes goes. */
const SAFE_QUOTED = /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|<\w+>|-?\d+(?:\.\d+)?)$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes paths, file names, data URLs, long encoded blobs, e-mail addresses and quoted user text from an
 * error message, then caps its length. Order matters: secrets first (they may contain spaces), then
 * whole tokens, then quoted values.
 */
export function scrubText(text: string, secrets: readonly string[]): string {
  let s = text;
  // Longest first, so the home folder wins over the user name inside it.
  for (const secret of [...secrets].filter((x) => x.length >= 3).sort((a, b) => b.length - a.length)) {
    if (/[\\/]/.test(secret)) {
      const variants = new Set([secret, secret.replace(/\\/g, '/'), secret.replace(/\//g, '\\')]);
      for (const v of variants) s = s.replace(new RegExp(escapeRegExp(v), 'gi'), '<home>');
    } else {
      // A user or host name, as a whole word only (a short name must not eat parts of other words).
      s = s.replace(new RegExp(`(?<![\\w])${escapeRegExp(secret)}(?![\\w])`, 'gi'), '<user>');
    }
  }
  s = s
    .replace(/\bdata:[^\s'"<>`]+/gi, '<data>')
    .replace(/[A-Za-z0-9+/=_-]{64,}/g, '<data>')
    .replace(/\bfile:\/\/[^\s'"<>`)]*/gi, '<path>')
    .replace(/<home>[^\s'"<>`]*/g, '<path>')
    .replace(/(?<!\w)[A-Za-z]:[\\/][^\s'"<>`|*?]*/g, '<path>')
    .replace(/\\\\[^\s'"<>`]+/g, '<path>')
    .replace(/(?<![\w/.:~-])~?\/[^\s'"<>`(),;]+/g, '<path>')
    .replace(new RegExp(`[^\\s'"<>\`/\\\\]+\\.(?:${IMAGE_EXTENSIONS})\\b`, 'gi'), '<file>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  const quoted = (open: string, close: string) =>
    new RegExp(`(?<!\\w)${open}([^${close}\\n]*)${close}(?!\\w)`, 'g');
  for (const [open, close] of [
    ["'", "'"],
    ['"', '"'],
    ['`', '`'],
    ['‘', '’'],
    ['“', '”'],
  ] as const) {
    s = s.replace(quoted(open, close), (_m, inner: string) =>
      SAFE_QUOTED.test(inner) && inner.length <= 60 ? `${open}${inner}${close}` : `${open}<redacted>${close}`,
    );
  }
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

/** Bundle-relative file names (`app:///assets/index.js`, `app:///out/main/index.js`); no install paths. */
export function normaliseFilename(raw: string): string {
  const f = raw.replace(/\\/g, '/');
  if (f.startsWith('node:')) return f;
  const web = /^(?:app:\/\/[^/]+|https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)(\/[^?#]*)/.exec(f);
  if (web) return `app://${web[1]}`;
  const nm = f.lastIndexOf('/node_modules/');
  if (nm >= 0) return `app:///${f.slice(nm + 1)}`;
  const out = f.lastIndexOf('/out/');
  if (out >= 0) return `app:///${f.slice(out + 1)}`;
  return '<external>';
}

const FRAME = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;

/** V8 stack → Sentry frames (oldest first), at most MAX_FRAMES of the most recent calls. */
export function parseStack(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of stack.split('\n')) {
    const m = FRAME.exec(line);
    if (!m) continue;
    const filename = normaliseFilename(m[2]!);
    const fn = m[1]?.trim() ?? '';
    frames.push({
      function: /^[\w$.<>[\] -]{1,120}$/.test(fn) ? fn : '?',
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: filename.startsWith('app:///') && !filename.includes('node_modules'),
    });
    if (frames.length === MAX_FRAMES) break;
  }
  return frames.reverse();
}

/** `https://<key>@<host>/<project>` → the envelope endpoint, or null. HTTP only for a local test server. */
export function envelopeUrl(dsn: string): string | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const project = segments.pop();
  if (!url.username || !project || !/^\d+$/.test(project)) return null;
  const prefix = segments.length ? `/${segments.join('/')}` : '';
  const key = encodeURIComponent(decodeURIComponent(url.username));
  return `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/?sentry_version=7&sentry_key=${key}`;
}

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/** Process-gone reasons worth a report (not a clean exit or a kill by the app or the OS). */
const CRASH_REASONS = new Set([
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'abnormal-exit',
  'memory-eviction',
]);

type Exception = {
  type: string;
  value: string;
  stacktrace?: { frames: Frame[] };
  mechanism: { type: string; handled: false };
};

export type CrashReporterOptions = {
  /** Sentry-compatible DSN from the build (or the E2E override); null: this build never sends anything. */
  dsn: string | null;
  /** Preferences › Privacy › Send crash reports (off by default). Read for every report. */
  enabled(): boolean;
  context: CrashContext;
  send(url: string, body: string): Promise<void>;
  onWarning(message: string, err?: unknown): void;
  maxPerSession?: number;
  now?: () => Date;
  eventId?: () => string;
};

export class CrashReporter {
  private readonly url: string | null;
  private readonly seen = new Set<string>();
  private sent = 0;

  constructor(private readonly opts: CrashReporterOptions) {
    this.url = opts.dsn ? envelopeUrl(opts.dsn) : null;
    if (opts.dsn && !this.url) opts.onWarning('Ignoring an invalid crash report DSN');
  }

  /** This build can send reports (it has a DSN). */
  get available(): boolean {
    return this.url !== null;
  }

  /** An uncaught exception or unhandled rejection in main or a window. */
  exception(
    process: 'main' | 'renderer',
    mechanism: 'onerror' | 'onunhandledrejection',
    error: { name: string; message: string; stack: string | null },
  ): Promise<void> {
    if (!this.wanted()) return Promise.resolve();
    const { secrets } = this.opts.context;
    const type = /^[A-Za-z_$][\w$]{0,60}$/.test(error.name) ? error.name : 'Error';
    const frames = error.stack ? parseStack(error.stack) : [];
    const ex: Exception = {
      type,
      value: scrubText(error.message, secrets),
      ...(frames.length ? { stacktrace: { frames } } : {}),
      mechanism: { type: mechanism, handled: false },
    };
    const top = frames.at(-1);
    const key = `${process}|${type}|${ex.value}|${top ? `${top.filename}:${top.lineno}:${top.colno}` : ''}`;
    return this.submit(key, { level: 'error', tags: { process }, exception: { values: [ex] } });
  }

  /** Any thrown value from main (uncaughtExceptionMonitor). */
  mainError(err: unknown, origin: string): Promise<void> {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
    return this.exception('main', origin === 'unhandledRejection' ? 'onunhandledrejection' : 'onerror', {
      name: e.name,
      message: e.message,
      stack: e.stack ?? null,
    });
  }

  /** An uncaught error a window sent over IPC ('crash.report'). */
  rendererError(input: CrashReportInput): Promise<void> {
    return this.exception(
      'renderer',
      input.kind === 'unhandledrejection' ? 'onunhandledrejection' : 'onerror',
      input,
    );
  }

  /** A renderer, GPU or utility process died ('render-process-gone' / 'child-process-gone'). */
  processGone(processType: string, reason: string, exitCode: number): Promise<void> {
    if (!CRASH_REASONS.has(reason) || !this.wanted()) return Promise.resolve();
    const proc = /^[\w.-]{1,40}$/.test(processType) ? processType.toLowerCase() : 'other';
    return this.submit(`gone|${proc}|${reason}`, {
      level: 'fatal',
      tags: { process: proc, reason },
      fingerprint: ['process-gone', proc, reason],
      exception: {
        values: [
          {
            type: 'ProcessGone',
            value: `${proc} process: ${reason} (exit code ${Math.trunc(exitCode)})`,
            mechanism: { type: 'process-gone', handled: false },
          },
        ],
      },
    });
  }

  private wanted(): boolean {
    return this.url !== null && this.opts.enabled();
  }

  private submit(key: string, body: Record<string, unknown> & { tags: Record<string, string> }) {
    if (this.seen.has(key) || this.sent >= (this.opts.maxPerSession ?? 10)) return Promise.resolve();
    this.seen.add(key);
    this.sent++;
    const ctx = this.opts.context;
    const now = (this.opts.now ?? (() => new Date()))();
    const eventId = (this.opts.eventId ?? (() => randomUUID().replace(/-/g, '')))();
    const event = {
      event_id: eventId,
      timestamp: now.getTime() / 1000,
      platform: 'node',
      logger: 'image-editor',
      release: `image-editor@${ctx.version}`,
      environment: ctx.channel() === 'beta' ? 'beta' : 'production',
      sdk: { name: 'image-editor.crash-reports', version: '1.0.0' },
      contexts: {
        os: { name: OS_NAMES[ctx.platform] ?? ctx.platform, version: ctx.osVersion },
        runtime: { name: 'Electron', version: ctx.electron },
        browser: { name: 'Chrome', version: ctx.chrome },
        app: { app_version: ctx.version },
      },
      ...body,
      tags: { ...body.tags, arch: ctx.arch },
    };
    const payload = JSON.stringify(event);
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: now.toISOString() }),
      JSON.stringify({ type: 'event', length: Buffer.byteLength(payload) }),
      payload,
    ].join('\n');
    return this.opts
      .send(this.url!, `${envelope}\n`)
      .catch((err: unknown) => this.opts.onWarning('Could not send a crash report', err));
  }
}
