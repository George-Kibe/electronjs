import { rgbToHex, type RGB } from '../../lib/color';
import type { useSwatches } from '../useSwatches';

type Props = {
  recent: RGB[];
  /** Saved swatches, shared with the colour picker's "Add to swatches". */
  saved: ReturnType<typeof useSwatches>;
  foreground: RGB;
  onForeground: (c: RGB) => void;
  onBackground: (c: RGB) => void;
};

function Swatch(props: { color: RGB; label: string; onPick: (bg: boolean) => void; onDelete?: () => void }) {
  const hex = rgbToHex(props.color);
  return (
    <button
      aria-label={`${props.label} ${hex}`}
      title={`${hex} — click: foreground, Alt+click: background${props.onDelete ? ', right-click or Delete: remove' : ''}`}
      onClick={(e) => props.onPick(e.altKey)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onDelete?.();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && props.onDelete) {
          e.preventDefault();
          props.onDelete();
        }
      }}
      className="border-ui-border h-4 w-4 rounded-sm border"
      style={{ background: hex }}
    />
  );
}

/** Swatches panel (FR-PNT-07): recently painted colours and saved swatches. */
export function SwatchesPanel({ recent, saved, foreground, onForeground, onBackground }: Props) {
  const { swatches, add, remove } = saved;
  const pick = (c: RGB) => (bg: boolean) => (bg ? onBackground(c) : onForeground(c));
  return (
    <section aria-labelledby="swatches-title" className="border-ui-border border-b px-3 pt-2 pb-2">
      <div className="mb-1 flex items-center">
        <h2 id="swatches-title" className="text-[11px] font-semibold tracking-wide uppercase">
          Swatches
        </h2>
        <button
          className="text-ui-muted hover:text-ui-text ml-auto px-1"
          aria-label="Add foreground colour to swatches"
          title="Add foreground colour to swatches"
          onClick={() => add(foreground)}
        >
          ＋
        </button>
      </div>
      {recent.length > 0 && (
        <div role="group" aria-label="Recent colours" className="mb-1.5 flex flex-wrap gap-1">
          {recent.map((c) => (
            <Swatch key={rgbToHex(c)} color={c} label="Recent colour" onPick={pick(c)} />
          ))}
        </div>
      )}
      <div role="group" aria-label="Saved swatches" className="flex flex-wrap gap-1">
        {swatches.map((c) => (
          <Swatch key={rgbToHex(c)} color={c} label="Swatch" onPick={pick(c)} onDelete={() => remove(c)} />
        ))}
      </div>
    </section>
  );
}
