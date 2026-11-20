import { expect, test } from '@playwright/test';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { launch, target } from './app';

type Received = { url: string; body: string };

/** A local stand-in for the Sentry ingest endpoint: records every envelope it gets. */
async function ingestServer() {
  const received: Received[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      received.push({ url: req.url ?? '', body });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { received, port, stop: () => new Promise<void>((done) => server.close(() => done())) };
}

const eventOf = (r: Received) => JSON.parse(r.body.trimEnd().split('\n')[2]!);

test(`[${target}] crash reports are off by default, opt-in, and carry no paths or file names (FR-GEN-07)`, async () => {
  const ingest = await ingestServer();
  const { win, close } = await launch([], undefined, {
    E2E_CRASH_REPORT_DSN: `http://e2ekey@127.0.0.1:${ingest.port}/42`,
  });
  try {
    const throwInPage = (message: string) =>
      win.evaluate((m) => {
        setTimeout(() => {
          throw new TypeError(m);
        });
      }, message);

    // Off by default: an uncaught error sends nothing.
    await throwInPage('First failure at /home/alice/Pictures/beach.png');
    await win.waitForTimeout(1500);
    expect(ingest.received).toHaveLength(0);

    // Opt in (Preferences › Privacy).
    await win.keyboard.press('ControlOrMeta+,');
    const prefs = win.getByRole('dialog', { name: 'Preferences' });
    await prefs.getByRole('tab', { name: 'Privacy' }).click();
    // Controlled by the saved settings, so it turns on when main has stored the change.
    const optIn = prefs.getByRole('checkbox', { name: 'Send crash reports' });
    await optIn.click();
    await expect(optIn).toBeChecked();
    await prefs.getByRole('button', { name: 'Done' }).click();

    await throwInPage(`Cannot open 'C:\\Users\\bob\\Holiday 2026\\kenya.jpg' or /Users/bob/art.iep`);
    await expect.poll(() => ingest.received.length).toBe(1);
    const [report] = ingest.received;
    expect(report!.url).toBe('/api/42/envelope/?sentry_version=7&sentry_key=e2ekey');
    const event = eventOf(report!);
    expect(event).toMatchObject({
      platform: 'node',
      environment: 'production',
      tags: { process: 'renderer' },
      exception: {
        // The quoted path has a space, so the whole quoted value goes.
        values: [{ type: 'TypeError', value: "Cannot open '<redacted>' or <path>" }],
      },
    });
    // Stack frames point into the bundle, never at the install folder.
    const frames: Array<{ filename: string }> = event.exception.values[0].stacktrace?.frames ?? [];
    for (const f of frames) expect(f.filename).toMatch(/^(app:\/\/\/|node:|<external>)/);
    expect(report!.body).not.toMatch(/bob|alice|kenya|Holiday|beach|art\.iep/i);

    // A crashed window is reported as well (from main, which survives it). CDP Page.crash crashes this
    // page's own renderer; navigating to chrome://crash can instead crash a speculative process for the
    // cross-origin-isolated navigation, which Electron does not report as the window's (seen on Linux CI).
    const cdp = await win.context().newCDPSession(win);
    // Not awaited: the reply never comes, because the session dies with the page.
    void cdp.send('Page.crash').catch(() => undefined);
    await expect.poll(() => ingest.received.length, { timeout: 15_000 }).toBe(2);
    expect(eventOf(ingest.received[1]!)).toMatchObject({
      level: 'fatal',
      tags: { process: 'renderer', reason: 'crashed' },
      exception: { values: [{ type: 'ProcessGone' }] },
    });
  } finally {
    await close();
    await ingest.stop();
  }
});
