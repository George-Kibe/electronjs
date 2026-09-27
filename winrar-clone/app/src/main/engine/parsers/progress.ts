/**
 * Parses a `-bsp1` progress segment such as "  0%", " 64% 12 - kenya/IMG_2231.jpg" or " 50% 2".
 * Returns null for segments that are not progress updates.
 */
export type ProgressUpdate = { percent: number; files: number | null; current: string | null };

const PROGRESS = /^\s*(\d{1,3})%(?:\s+(\d+))?(?:\s+[-+UTR=.]\s(.*))?\s*$/;

export function parseProgress(segment: string): ProgressUpdate | null {
  const m = PROGRESS.exec(segment);
  if (!m) return null;
  const percent = Math.min(100, Number(m[1]));
  const current = m[3]?.trim();
  return { percent, files: m[2] === undefined ? null : Number(m[2]), current: current ? current : null };
}

/** Per-file line printed with `-bb1`: "- path/inside/archive". */
export function parseFileLine(line: string): string | null {
  const m = /^- (.+)$/.exec(line);
  return m ? m[1]! : null;
}
