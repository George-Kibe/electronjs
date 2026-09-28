import { randomUUID } from 'node:crypto';
import type { ArchiveIndex } from './archive-index';

type Session = { archivePath: string; index: ArchiveIndex };

/** Open archive sessions (in memory, per app run). Oldest are evicted beyond the cap. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly max = 16) {}

  add(session: Session): string {
    const id = randomUUID();
    this.sessions.set(id, session);
    while (this.sessions.size > this.max) {
      const oldest = this.sessions.keys().next().value as string;
      this.sessions.delete(oldest);
    }
    return id;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  close(id: string): void {
    this.sessions.delete(id);
  }
}
