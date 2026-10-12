import { useCallback, useState } from 'react';
import { sameColor, type RGB } from '../lib/color';

const KEY = 'imageeditor.swatches.v1';

/** Starter palette for the Swatches panel (FR-PNT-07). */
export const DEFAULT_SWATCHES: RGB[] = [
  [0, 0, 0],
  [64, 64, 64],
  [128, 128, 128],
  [192, 192, 192],
  [255, 255, 255],
  [224, 49, 49],
  [247, 103, 7],
  [250, 176, 5],
  [64, 192, 87],
  [12, 166, 120],
  [21, 170, 191],
  [28, 126, 214],
  [76, 110, 245],
  [121, 80, 242],
  [190, 75, 219],
  [230, 73, 128],
];

const isRgb = (v: unknown): v is RGB =>
  Array.isArray(v) && v.length === 3 && v.every((c) => Number.isInteger(c) && c >= 0 && c <= 255);

/** Saved swatches. Stored in this app's local storage until Preferences (M1 slice 6) take over. */
function load(): RGB[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(parsed) && parsed.every(isRgb)) return parsed;
  } catch {
    // unavailable or damaged: fall back to the defaults
  }
  return DEFAULT_SWATCHES;
}

function save(swatches: RGB[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(swatches));
  } catch {
    // not persisted; the panel still works for this session
  }
}

export function useSwatches() {
  const [swatches, setSwatches] = useState<RGB[]>(load);
  const update = useCallback((next: RGB[]) => {
    setSwatches(next);
    save(next);
  }, []);
  const add = useCallback(
    (c: RGB) => update([...swatches.filter((s) => !sameColor(s, c)), c].slice(-64)),
    [swatches, update],
  );
  const remove = useCallback(
    (c: RGB) => update(swatches.filter((s) => !sameColor(s, c))),
    [swatches, update],
  );
  const reset = useCallback(() => update(DEFAULT_SWATCHES), [update]);
  return { swatches, add, remove, reset };
}
