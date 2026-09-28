/**
 * Streaming parser for `7zz l -slt` output (docs/04 §2.4).
 *
 * Layout: banner lines, then `--` followed by the archive property block (may contain an `ERRORS:` /
 * `WARNINGS:` section), then `----------` followed by one `Key = Value` block per entry separated by
 * blank lines. Unknown keys are kept in `raw`.
 */

export type RawBlock = Record<string, string>;

export type ParsedEntry = {
  path: string;
  isDir: boolean;
  size: number;
  packed: number | null;
  modified: string | null;
  crc: string | null;
  encrypted: boolean;
  method: string | null;
  attributes: string | null;
  link: { kind: 'symlink' | 'hardlink'; target: string } | null;
  raw: RawBlock;
};

export type ParsedArchive = {
  props: RawBlock;
  warnings: string[];
  entries: ParsedEntry[];
};

type State = 'banner' | 'props' | 'entries';

const KV = /^([^=]+?) = (.*)$/;

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value;
}

export function toEntry(block: RawBlock): ParsedEntry | null {
  const path = block['Path'];
  if (path === undefined || path === '') return null;
  const attributes = nonEmpty(block['Attributes']);
  const isDir = block['Folder'] === '+' || (attributes?.startsWith('D') ?? false);
  const symlink = nonEmpty(block['Symbolic Link']);
  const hardlink = nonEmpty(block['Hard Link']);
  return {
    // 7-Zip prints paths with the host separator; normalise to '/' inside the archive model.
    path: path.replaceAll('\\', '/'),
    isDir,
    size: toNumber(block['Size']) ?? 0,
    packed: toNumber(block['Packed Size']),
    modified: nonEmpty(block['Modified']),
    crc: nonEmpty(block['CRC']),
    encrypted: block['Encrypted'] === '+',
    method: nonEmpty(block['Method']),
    attributes,
    link: symlink
      ? { kind: 'symlink', target: symlink }
      : hardlink
        ? { kind: 'hardlink', target: hardlink }
        : null,
    raw: block,
  };
}

export class ListParser {
  private state: State = 'banner';
  private block: RawBlock = {};
  private inErrorSection = false;
  readonly result: ParsedArchive = { props: {}, warnings: [], entries: [] };

  constructor(private readonly onEntry?: (entry: ParsedEntry) => void) {}

  line(line: string): void {
    if (this.state === 'banner') {
      if (line === '--') this.state = 'props';
      return;
    }
    if (this.state === 'props') {
      if (line === '----------') {
        this.state = 'entries';
        return;
      }
      const m = KV.exec(line);
      if (m) {
        this.inErrorSection = false;
        this.result.props[m[1]!.trim()] = m[2]!;
      } else if (line === 'ERRORS:' || line === 'WARNINGS:') {
        this.inErrorSection = true;
      } else if (this.inErrorSection && line.trim() !== '') {
        this.result.warnings.push(line.trim());
      }
      return;
    }
    // entries
    if (line.trim() === '') {
      this.flush();
      return;
    }
    const m = KV.exec(line);
    if (m) this.block[m[1]!.trim()] = m[2]!;
  }

  end(): ParsedArchive {
    this.flush();
    return this.result;
  }

  private flush(): void {
    if (Object.keys(this.block).length === 0) return;
    const entry = toEntry(this.block);
    this.block = {};
    if (!entry) return;
    this.result.entries.push(entry);
    this.onEntry?.(entry);
  }
}

/** Convenience for tests and small outputs. */
export function parseList(output: string): ParsedArchive {
  const parser = new ListParser();
  for (const line of output.split(/\r?\n/)) parser.line(line);
  return parser.end();
}
