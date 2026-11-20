import { describe, expect, it, vi } from 'vitest';
import { installCrashCapture } from './crash-capture';

function fire(target: EventTarget, type: string, props: Record<string, unknown>) {
  target.dispatchEvent(Object.assign(new Event(type), props));
}

describe('installCrashCapture (FR-GEN-07)', () => {
  it('forwards uncaught errors and rejections as name, message and stack only', () => {
    const target = new EventTarget();
    const report = vi.fn(async (_r: unknown) => undefined);
    const uninstall = installCrashCapture(report, target as never);
    const err = new TypeError('bad');
    fire(target, 'error', { error: err, message: 'Uncaught TypeError: bad' });
    fire(target, 'unhandledrejection', { reason: 'just a string' });
    fire(target, 'unhandledrejection', { reason: { not: 'an error' } });
    expect(report.mock.calls.map(([r]) => r)).toEqual([
      { kind: 'error', name: 'TypeError', message: 'bad', stack: err.stack },
      { kind: 'unhandledrejection', name: 'Error', message: 'just a string', stack: null },
      { kind: 'unhandledrejection', name: 'Error', message: 'A non-error value was thrown', stack: null },
    ]);
    uninstall();
    fire(target, 'error', { error: new Error('after') });
    expect(report).toHaveBeenCalledTimes(3);
  });

  it('stops after 20 errors and never throws when main is unreachable', () => {
    const target = new EventTarget();
    const report = vi.fn(async () => {
      throw new Error('IPC down');
    });
    installCrashCapture(report, target as never);
    for (let i = 0; i < 30; i++) fire(target, 'error', { error: new Error(`e${i}`) });
    expect(report).toHaveBeenCalledTimes(20);
  });
});
