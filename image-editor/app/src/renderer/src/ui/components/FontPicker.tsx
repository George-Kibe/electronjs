import { useId, useState } from 'react';
import { installedFonts } from '../../lib/fonts';

/** Common families, when the installed fonts cannot be listed. */
const SUGGESTIONS = [
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'Arial',
  'Helvetica',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Noto Sans',
  'Noto Serif',
  'Roboto',
  'DejaVu Sans',
  'Segoe UI',
];

/**
 * The Type tool's font field (FR-TXT-02, docs/03 §5.6): a searchable list of the installed families, each
 * shown in its own font. Typing filters it; Enter, a click or leaving the field picks the family.
 */
export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<string[]>(SUGGESTIONS);
  const [active, setActive] = useState(0);
  const listId = useId();
  const text = draft ?? value;
  const query = (draft ?? '').toLowerCase();
  const matches = fonts.filter((f) => f.toLowerCase().includes(query)).slice(0, 100);

  const pick = (family: string | undefined) => {
    setOpen(false);
    setDraft(null);
    if (family?.trim()) onChange(family.trim());
  };
  const load = () => {
    setOpen(true);
    void installedFonts().then((list) => list?.length && setFonts(list));
  };
  return (
    <span className="relative flex items-center gap-1">
      <span className="text-ui-muted">Font</span>
      <input
        role="combobox"
        aria-label="Font"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={text}
        onFocus={load}
        onMouseDown={load}
        onChange={(e) => {
          setDraft(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => pick(draft ?? undefined)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(matches.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter') pick(matches[active] ?? draft ?? undefined);
          else if (e.key === 'Escape') {
            setDraft(null);
            setOpen(false);
          } else return;
          e.preventDefault();
        }}
        className="bg-ui-bg border-ui-border w-40 rounded border px-1 py-0.5"
      />
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Fonts"
          className="bg-ui-panel border-ui-border absolute top-full left-8 z-50 max-h-72 w-60 overflow-y-auto rounded border shadow-lg"
        >
          {matches.map((f, i) => (
            <li
              key={f}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer truncate px-2 py-1 ${i === active ? 'bg-brand text-white' : ''}`}
              style={{ fontFamily: `"${f.replace(/"/g, '')}", sans-serif` }}
              // Before the input's blur, which would pick the typed text instead.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(f);
              }}
            >
              {f}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
