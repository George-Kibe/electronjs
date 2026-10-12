/** Colour conversions for the colour picker (FR-PNT-07). sRGB 0..255; hue 0..360, saturation/brightness 0..100. */
export type RGB = [number, number, number];
export type HSB = { h: number; s: number; b: number };

export function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Accepts `#RGB`, `#RRGGBB`, with or without `#`, any case. Null if invalid. */
export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

export function rgbToHsb([r, g, b]: RGB): HSB {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, b: (max / 255) * 100 };
}

export function hsbToRgb({ h, s, b }: HSB): RGB {
  const v = b / 100;
  const c = v * (s / 100);
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  // RGB before adding the minimum, for each 60° sector of the hue circle.
  const sectors: RGB[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const m = v - c;
  return sectors[Math.min(5, Math.floor(hp))]!.map((ch) => Math.round((ch + m) * 255)) as RGB;
}

export const sameColor = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
