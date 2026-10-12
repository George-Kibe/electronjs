import { useState, type FormEvent, type ReactNode } from 'react';
import { MAX_DOCUMENT_SIDE } from '@shared/constants';
import type { Settings } from '@shared/settings';
import type { NewDocumentSpec } from '../useFileActions';
import { Button } from './Button';

type Preset = Settings['files']['documentPresets'][number];

/** Built-in presets (FR-DOC-01). */
export const BUILT_IN_PRESETS: Preset[] = [
  { name: 'Full HD 1080p', width: 1920, height: 1080, ppi: 72 },
  { name: 'Instagram post', width: 1080, height: 1080, ppi: 72 },
  { name: 'Instagram story', width: 1080, height: 1920, ppi: 72 },
  { name: 'A4 at 300 ppi', width: 2480, height: 3508, ppi: 300 },
  { name: '4K UHD', width: 3840, height: 2160, ppi: 72 },
];

const BACKGROUNDS = {
  white: [255, 255, 255, 255],
  black: [0, 0, 0, 255],
  transparent: [0, 0, 0, 0],
} as const;
type Background = keyof typeof BACKGROUNDS | 'color';

type Props = {
  onCreate: (spec: NewDocumentSpec) => void;
  /** Presets the user saved (Preferences store). */
  saved: Preset[];
  onSavePreset: (preset: Preset) => void;
  onDeletePreset: (name: string) => void;
  /** The current background colour, for the "Background colour" option. */
  backgroundColor: [number, number, number];
  children: (valid: boolean) => ReactNode;
};

const fieldClass = 'bg-ui-bg border-ui-border w-20 rounded border px-1.5 py-1';

/** New document (FR-DOC-01): presets, size, resolution and background. */
export function NewDocumentForm({
  onCreate,
  saved,
  onSavePreset,
  onDeletePreset,
  backgroundColor,
  children,
}: Props) {
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [ppi, setPpi] = useState(72);
  const [background, setBackground] = useState<Background>('white');
  const [naming, setNaming] = useState<string | null>(null);
  const valid =
    [width, height].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_DOCUMENT_SIDE) &&
    ppi >= 1 &&
    ppi <= 10_000;
  const all = [...BUILT_IN_PRESETS, ...saved];
  const current = all.find((p) => p.width === width && p.height === height && p.ppi === ppi)?.name ?? '';
  const isSaved = saved.some((p) => p.name === current);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const rgba = background === 'color' ? ([...backgroundColor, 255] as const) : BACKGROUNDS[background];
    onCreate({ width, height, ppi, background: [...rgba] as NewDocumentSpec['background'] });
  };
  return (
    <form onSubmit={submit} aria-label="New document" className="flex flex-col gap-2">
      <label className="flex items-center gap-2">
        <span className="text-ui-muted w-24 shrink-0">Preset</span>
        <select
          aria-label="Preset"
          value={current}
          onChange={(e) => {
            const p = all.find((x) => x.name === e.target.value);
            if (!p) return;
            setWidth(p.width);
            setHeight(p.height);
            setPpi(p.ppi);
          }}
          className="bg-ui-bg border-ui-border flex-1 rounded border px-1.5 py-1"
        >
          <option value="">Custom</option>
          <optgroup label="Presets">
            {BUILT_IN_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.width} × {p.height})
              </option>
            ))}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label="Saved">
              {saved.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.width} × {p.height})
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {isSaved ? (
          <Button
            aria-label={`Delete preset ${current}`}
            title="Delete this saved preset"
            onClick={() => onDeletePreset(current)}
          >
            🗑
          </Button>
        ) : (
          <Button
            aria-label="Save preset"
            title="Save these settings as a preset"
            onClick={() => setNaming('')}
          >
            ＋
          </Button>
        )}
      </label>
      {naming !== null && (
        <div className="flex items-center gap-2 pl-26">
          <input
            aria-label="Preset name"
            autoFocus
            maxLength={60}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (naming.trim()) onSavePreset({ name: naming.trim(), width, height, ppi });
                setNaming(null);
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setNaming(null);
              }
            }}
            placeholder="Preset name, then Enter"
            className="bg-ui-bg border-ui-border flex-1 rounded border px-1.5 py-1"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-ui-muted w-24 shrink-0">Size</span>
        <input
          type="number"
          aria-label="Width"
          min={1}
          max={MAX_DOCUMENT_SIDE}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className={fieldClass}
        />
        <span className="text-ui-muted">×</span>
        <input
          type="number"
          aria-label="Height"
          min={1}
          max={MAX_DOCUMENT_SIDE}
          value={height}
          onChange={(e) => setHeight(Number(e.target.value))}
          className={fieldClass}
        />
        <span className="text-ui-muted">px</span>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-ui-muted w-24 shrink-0">Resolution</span>
        <input
          type="number"
          aria-label="Resolution"
          min={1}
          max={10_000}
          value={ppi}
          onChange={(e) => setPpi(Number(e.target.value))}
          className={fieldClass}
        />
        <span className="text-ui-muted" title="Pixels per inch, for printing. It does not change the pixels.">
          ppi
        </span>
      </label>
      <label className="flex items-center gap-2">
        <span className="text-ui-muted w-24 shrink-0">Background</span>
        <select
          aria-label="Background"
          value={background}
          onChange={(e) => setBackground(e.target.value as Background)}
          className="bg-ui-bg border-ui-border rounded border px-1.5 py-1"
        >
          <option value="white">White</option>
          <option value="black">Black</option>
          <option value="transparent">Transparent</option>
          <option value="color">Background colour</option>
        </select>
      </label>
      {children(valid)}
    </form>
  );
}
