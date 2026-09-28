/**
 * Splits a byte stream from 7-Zip into logical lines. 7-Zip redraws progress in place using backspaces
 * (\b) and carriage returns, so those count as separators too. Empty segments are kept for \n only,
 * because blank lines delimit blocks in `-slt` listings.
 */
export class LineSplitter {
  private buffer = '';

  constructor(private readonly onLine: (line: string, terminator: '\n' | '\r' | '\b') => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch === '\r') {
        // "\r\n" (Windows line ending) is one newline, not a redraw followed by an empty line.
        if (i + 1 === this.buffer.length) break; // wait for the next chunk to decide
        if (this.buffer[i + 1] === '\n') {
          this.onLine(this.buffer.slice(start, i), '\n');
          start = i + 2;
          i++;
          continue;
        }
      }
      if (ch === '\n' || ch === '\r' || ch === '\b') {
        const line = this.buffer.slice(start, i);
        if (ch === '\n') this.onLine(line, '\n');
        else if (line.trim() !== '') this.onLine(line, ch);
        start = i + 1;
      }
    }
    this.buffer = this.buffer.slice(start);
  }

  /** Returns the unterminated tail (used to detect prompts like "Enter password:" that end without \n). */
  pending(): string {
    return this.buffer;
  }

  end(): void {
    if (this.buffer !== '') this.onLine(this.buffer, '\n');
    this.buffer = '';
  }
}
