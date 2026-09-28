import { useState, type FormEvent } from 'react';
import { MAX_DOCUMENT_SIDE, PRODUCT_NAME } from '@shared/constants';
import { Button } from './Button';

type Props = { onNew: (w: number, h: number) => void; onOpen: () => void };

export function Welcome({ onNew, onOpen }: Props) {
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const valid = [width, height].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_DOCUMENT_SIDE);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onNew(width, height);
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="bg-ui-panel border-ui-border flex w-[420px] flex-col gap-4 rounded-lg border p-6 shadow-xl">
        <h1 className="text-lg font-semibold">{PRODUCT_NAME}</h1>
        <p className="text-ui-muted">
          Open an image or create a new document. You can also drop an image here.
        </p>
        <Button variant="primary" onClick={onOpen} className="py-2">
          Open image…
        </Button>
        <form
          onSubmit={submit}
          aria-label="New document"
          className="border-ui-border flex flex-col gap-2 border-t pt-4"
        >
          <span className="font-semibold">New document</span>
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
          <Button type="submit" disabled={!valid} className="bg-ui-raised self-start">
            Create
          </Button>
        </form>
      </div>
    </div>
  );
}
