import { rgbToHex, type RGB } from '../../lib/color';
import type { useSwatches } from '../useSwatches';

type Props = {
  recent: RGB[];
  /** Saved swatches, shared with the colour picker's "Add to swatches". */
  saved: ReturnType<typeof useSwatches>;
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
export function SwatchesPanel({ recent, saved, onForeground, onBackground }: Props) {
  const { swatches, remove } = saved;
  const pick = (c: RGB) => (bg: boolean) => (bg ? onBackground(c) : onForeground(c));
  return (
    // The dock (PanelDock) provides the section, the "Swatches" header and its Add button.
    <div className="px-3 py-2">
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
    </div>
  );
}
