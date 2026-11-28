/**
 * Installed font families for the Type tool (FR-TXT-02), from the Local Font Access API (main grants
 * only the `local-fonts` permission, docs/06). Asked on the first click into the font field, since the
 * browser may need a user gesture; null when the API is missing or refused (the field then suggests
 * common families and takes any name typed).
 */
type FontData = { family: string };
type WithFonts = { queryLocalFonts?: () => Promise<FontData[]> };

let families: Promise<string[] | null> | null = null;

export function installedFonts(): Promise<string[] | null> {
  families ??= (async () => {
    const query = (window as WithFonts).queryLocalFonts;
    if (!query) return null;
    try {
      const fonts = await query.call(window);
      return [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    } catch {
      families = null; // e.g. no user gesture yet: ask again on the next click
      return null;
    }
  })();
  return families;
}
