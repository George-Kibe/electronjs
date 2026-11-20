import { describe, expect, it, vi } from 'vitest';
import { CrashReporter, envelopeUrl, normaliseFilename, parseStack, scrubText } from './crash-reports';

const SECRETS = ['/home/alice', 'C:\\Users\\Alice Smith', 'alice', 'alices-laptop'];

describe('scrubText: no file names, paths or user data (FR-GEN-07)', () => {
  it.each([
    [
      "ENOENT: no such file or directory, open '/home/alice/Pictures/beach.png'",
      "ENOENT: no such file or directory, open '<path>'",
    ],
    // Spaces end a path token; what follows is still scrubbed.
    ['Could not read C:\\Users\\Alice Smith\\Pictures\\my beach.png', 'Could not read <path> <file>'],
    ['Failed at D:\\Photos\\2026\\kenya.jpg now', 'Failed at <path> now'],
    ['share \\\\nas\\photos\\x.tif gone', 'share <path> gone'],
    ['open /tmp/ie-123/doc.iep failed', 'open <path> failed'],
    ['see ~/Desktop/x', 'see <path>'],
    ['url file:///Users/bob/a.png)', 'url <path>)'],
    ['decode holiday.JPEG failed', 'decode <file> failed'],
    ['src data:image/png;base64,iVBORw0KGgo= bad', 'src <data> bad'],
    [`blob ${'A'.repeat(80)} end`, 'blob <data> end'],
    ['mail bob@example.com please', 'mail <email> please'],
    ['user alice on alices-laptop', 'user <user> on <user>'],
    ['Layer "Kenya trip 2026" not found', 'Layer "<redacted>" not found'],
    ['Document “Untitled-3” is locked', 'Document “<redacted>” is locked'],
  ])('%s', (input, expected) => expect(scrubText(input, SECRETS)).toBe(expected));

  it('keeps what makes an error useful', () => {
    expect(scrubText("Cannot read properties of undefined (reading 'width')", SECRETS)).toBe(
      "Cannot read properties of undefined (reading 'width')",
    );
    expect(scrubText("Can't merge: 'layer.opacity' is 3 / 4 of 1/2", SECRETS)).toBe(
      "Can't merge: 'layer.opacity' is 3 / 4 of 1/2",
    );
    expect(scrubText('Tile 3,4 out of range at app://editor/assets/index.js', SECRETS)).toBe(
      'Tile 3,4 out of range at app://editor/assets/index.js',
    );
    // A user name inside another word is left alone.
    expect(scrubText('malice aforethought', ['alice'])).toBe('malice aforethought');
  });

  it('caps the length', () => {
    expect(scrubText('x '.repeat(2000), []).length).toBeLessThanOrEqual(1001);
  });
});

describe('stack frames', () => {
  it('keeps bundle-relative names, never install or user paths', () => {
    expect(normaliseFilename('app://editor/assets/index-abc.js')).toBe('app:///assets/index-abc.js');
    expect(normaliseFilename('http://localhost:5173/src/ui/App.tsx?t=1')).toBe('app:///src/ui/App.tsx');
    expect(normaliseFilename('/opt/ImageEditor/resources/app.asar/out/main/index.js')).toBe(
      'app:///out/main/index.js',
    );
    expect(
      normaliseFilename(
        'C:\\Users\\Alice\\AppData\\Local\\ImageEditor\\resources\\app.asar\\out\\main\\index.js',
      ),
    ).toBe('app:///out/main/index.js');
    expect(normaliseFilename('/x/app.asar/node_modules/zod/index.js')).toBe(
      'app:///node_modules/zod/index.js',
    );
    expect(normaliseFilename('node:internal/process/task_queues')).toBe('node:internal/process/task_queues');
    expect(normaliseFilename('/home/alice/evil.js')).toBe('<external>');
  });

  it('parses V8 stacks, oldest frame first', () => {
    const frames = parseStack(
      [
        'TypeError: x is undefined',
        '    at Editor.paint (app://editor/assets/index.js:10:5)',
        '    at async load (app://editor/assets/index.js:20:7)',
        '    at app://editor/assets/worker.js:3:1',
        '    at Array.map (<anonymous>)',
        '    at Module._compile (node:internal/modules/cjs/loader:1:2)',
      ].join('\n'),
    );
    expect(frames.map((f) => [f.function, f.filename, f.lineno, f.in_app])).toEqual([
      ['Module._compile', 'node:internal/modules/cjs/loader', 1, false],
      ['?', 'app:///assets/worker.js', 3, true],
      ['load', 'app:///assets/index.js', 20, true],
      ['Editor.paint', 'app:///assets/index.js', 10, true],
    ]);
  });
});

describe('envelopeUrl', () => {
  it('maps a DSN to the envelope endpoint', () => {
    expect(envelopeUrl('https://abc123@o1.ingest.sentry.io/4507')).toBe(
      'https://o1.ingest.sentry.io/api/4507/envelope/?sentry_version=7&sentry_key=abc123',
    );
    expect(envelopeUrl('https://k@glitchtip.example.org/sub/2')).toBe(
      'https://glitchtip.example.org/sub/api/2/envelope/?sentry_version=7&sentry_key=k',
    );
    expect(envelopeUrl('http://k@127.0.0.1:9999/1')).toBe(
      'http://127.0.0.1:9999/api/1/envelope/?sentry_version=7&sentry_key=k',
    );
  });

  it('rejects plain HTTP to other hosts and malformed DSNs', () => {
    expect(envelopeUrl('http://k@sentry.example.org/1')).toBeNull();
    expect(envelopeUrl('https://sentry.example.org/1')).toBeNull(); // no key
    expect(envelopeUrl('https://k@sentry.example.org/abc')).toBeNull();
    expect(envelopeUrl('not a url')).toBeNull();
  });
});

function reporter(enabled = true, dsn: string | null = 'https://key@sentry.example.org/7') {
  const send = vi.fn(async (_url: string, _body: string) => undefined);
  const r = new CrashReporter({
    dsn,
    enabled: () => enabled,
    send,
    onWarning: () => undefined,
    context: {
      version: '0.1.0',
      channel: () => 'latest',
      platform: 'linux',
      osVersion: '6.8.0',
      arch: 'x64',
      electron: '44.4.5',
      chrome: '140.0',
      secrets: SECRETS,
    },
    now: () => new Date('2026-11-20T10:00:00Z'),
    eventId: () => 'f'.repeat(32),
  });
  const events = () =>
    send.mock.calls.map(([, body]) => {
      const [header, item, payload] = body.trimEnd().split('\n');
      return { header: JSON.parse(header!), item: JSON.parse(item!), event: JSON.parse(payload!) };
    });
  return { r, send, events };
}

describe('CrashReporter', () => {
  it('sends nothing unless the user opted in, or without a DSN', async () => {
    const off = reporter(false);
    await off.r.rendererError({ kind: 'error', name: 'Error', message: 'boom', stack: null });
    await off.r.processGone('GPU', 'crashed', 139);
    expect(off.send).not.toHaveBeenCalled();

    const none = reporter(true, null);
    expect(none.r.available).toBe(false);
    await none.r.rendererError({ kind: 'error', name: 'Error', message: 'boom', stack: null });
    expect(none.send).not.toHaveBeenCalled();
  });

  it('sends a scrubbed Sentry envelope with no personal data', async () => {
    const { r, send, events } = reporter();
    await r.rendererError({
      kind: 'unhandledrejection',
      name: 'TypeError',
      message: "Cannot open '/home/alice/Pictures/beach.png' for alice",
      stack: 'TypeError: x\n    at f (app://editor/assets/index.js:1:2)',
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toBe(
      'https://sentry.example.org/api/7/envelope/?sentry_version=7&sentry_key=key',
    );
    const { header, item, event } = events()[0]!;
    expect(header).toEqual({ event_id: 'f'.repeat(32), sent_at: '2026-11-20T10:00:00.000Z' });
    expect(item.type).toBe('event');
    expect(event).toMatchObject({
      release: 'image-editor@0.1.0',
      environment: 'production',
      level: 'error',
      tags: { process: 'renderer', arch: 'x64' },
      contexts: { os: { name: 'Linux', version: '6.8.0' } },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: "Cannot open '<path>' for <user>",
            mechanism: { type: 'onunhandledrejection', handled: false },
            stacktrace: { frames: [{ filename: 'app:///assets/index.js', lineno: 1, colno: 2 }] },
          },
        ],
      },
    });
    const raw = JSON.stringify(event);
    for (const leak of ['alice', 'beach', 'Pictures', 'server_name', 'user"'])
      expect(raw).not.toContain(leak);
    expect(item.length).toBe(Buffer.byteLength(JSON.stringify(event)));
  });

  it('reports crashed processes, not clean exits or kills', async () => {
    const { r, events } = reporter();
    await r.processGone('GPU', 'crashed', 139);
    await r.processGone('Utility', 'clean-exit', 0);
    await r.processGone('renderer', 'killed', 9);
    const sent = events();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.event).toMatchObject({
      level: 'fatal',
      tags: { process: 'gpu', reason: 'crashed' },
      fingerprint: ['process-gone', 'gpu', 'crashed'],
      exception: { values: [{ type: 'ProcessGone', value: 'gpu process: crashed (exit code 139)' }] },
    });
  });

  it('sends each distinct error once and at most 10 per session', async () => {
    const { r, send } = reporter();
    const err = { kind: 'error' as const, name: 'Error', message: 'same', stack: null };
    await r.rendererError(err);
    await r.rendererError(err);
    expect(send).toHaveBeenCalledOnce();
    for (let i = 0; i < 20; i++) await r.rendererError({ ...err, message: `n${i}` });
    expect(send).toHaveBeenCalledTimes(10);
  });

  it('reads the opt-in for every report and survives send failures', async () => {
    let on = false;
    const send = vi.fn(async () => {
      throw new Error('offline');
    });
    const warn = vi.fn();
    const r = new CrashReporter({
      dsn: 'https://k@s.example.org/1',
      enabled: () => on,
      send,
      onWarning: warn,
      context: {
        version: '1',
        channel: () => 'beta',
        platform: 'win32',
        osVersion: '10',
        arch: 'arm64',
        electron: '1',
        chrome: '1',
        secrets: [],
      },
    });
    await r.mainError(new Error('a'), 'uncaughtException');
    expect(send).not.toHaveBeenCalled();
    on = true;
    await r.mainError('thrown string', 'unhandledRejection');
    expect(send).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('Could not send a crash report', expect.any(Error));
  });

  it('keeps unknown error names and process types out of tags', async () => {
    const { r, events } = reporter();
    await r.rendererError({ kind: 'error', name: 'Error: /home/alice', message: 'm', stack: null });
    await r.processGone('../../etc', 'oom', 1);
    const [a, b] = events();
    expect(a!.event.exception.values[0].type).toBe('Error');
    expect(b!.event.tags.process).toBe('other');
  });
});
