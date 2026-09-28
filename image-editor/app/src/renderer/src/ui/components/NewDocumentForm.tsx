import { useState, type FormEvent, type ReactNode } from 'react';
import { MAX_DOCUMENT_SIDE } from '@shared/constants';

type Props = { onCreate: (w: number, h: number) => void; children: (valid: boolean) => ReactNode };

/** Width × height fields for a new document (FR-DOC-01; presets and background arrive with the full dialog). */
export function NewDocumentForm({ onCreate, children }: Props) {
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const valid = [width, height].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_DOCUMENT_SIDE);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onCreate(width, height);
  };
  return (
    <form onSubmit={submit} aria-label="New document" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {(
          [
            ['Width', width, setWidth],
            ['Height', height, setHeight],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label} className="flex items-center gap-1">
            <span className="text-ui-muted">{label}</span>
            <input
              type="number"
              min={1}
              max={MAX_DOCUMENT_SIDE}
              value={value}
              onChange={(e) => set(Number(e.target.value))}
              className="bg-ui-bg border-ui-border w-20 rounded border px-1.5 py-1"
            />
          </label>
        ))}
        <span className="text-ui-muted">px</span>
      </div>
      {children(valid)}
    </form>
  );
}
