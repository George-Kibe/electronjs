import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb, type HSB, type RGB } from '../../lib/color';
import { Button } from './Button';
import { Modal } from './Modal';

type Props = {
  title: string;
  initial: RGB;
  recent: RGB[];
  onOk: (color: RGB) => void;
  onCancel: () => void;
  onAddSwatch?: (color: RGB) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function NumberField(props: {
  label: string;
  /** Accessible name ("Red", "Hue"…). */
  name: string;
  value: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-end gap-1.5">
      <span className="text-ui-muted w-4 text-right">{props.label}</span>
      <input
        type="number"
        aria-label={props.name}
        min={0}
        max={props.max}
        value={Math.round(props.value)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) props.onChange(clamp(v, 0, props.max));
        }}
        className="bg-ui-bg border-ui-border w-14 rounded border px-1.5 py-0.5 tabular-nums"
      />
      <span className="text-ui-muted w-3">{props.unit ?? ''}</span>
    </label>
  );
}

/**
 * Colour picker (FR-PNT-07): saturation/brightness square + hue slider, HSB, RGB and hex fields, the
 * current vs new colour, and recent colours. Every control works from the keyboard (docs/03 §7).
 */
export function ColorPickerDialog({ title, initial, recent, onOk, onCancel, onAddSwatch }: Props) {
  // HSB is the source of truth so the hue survives greys and black.
  const [hsb, setHsb] = useState<HSB>(() => rgbToHsb(initial));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const rgb = hsbToRgb(hsb);
  const square = useRef<HTMLDivElement>(null);

  const setRgb = (c: RGB) => {
    const next = rgbToHsb(c);
    // Keep the current hue (and saturation for black) where RGB does not define them.
    if (next.s === 0 || next.b === 0) next.h = hsb.h;
    if (next.b === 0) next.s = hsb.s;
    setHsb(next);
  };

  const pickAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = square.current!.getBoundingClientRect();
    setHsb({
      h: hsb.h,
      s: clamp(((e.clientX - box.left) / box.width) * 100, 0, 100),
      b: clamp((1 - (e.clientY - box.top) / box.height) * 100, 0, 100),
    });
  };

  const onSquareKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    setHsb({
      h: hsb.h,
      s: clamp(Math.round(hsb.s) + d[0], 0, 100),
      b: clamp(Math.round(hsb.b) + d[1], 0, 100),
    });
  };

  const hex = rgbToHex(rgb);
  return (
    <Modal
      title={title}
      onCancel={onCancel}
      width="w-[460px]"
      footer={
        <>
          {onAddSwatch && (
            <Button className="mr-auto" onClick={() => onAddSwatch(rgb)}>
              Add to swatches
            </Button>
          )}
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onOk(rgb)}>
            OK
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div
          ref={square}
          role="slider"
          tabIndex={0}
          data-autofocus
          aria-label="Saturation and brightness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsb.s)}
          aria-valuetext={`Saturation ${Math.round(hsb.s)} percent, brightness ${Math.round(hsb.b)} percent`}
          onKeyDown={onSquareKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pickAt(e);
          }}
          onPointerMove={(e) => e.buttons === 1 && pickAt(e)}
          className="relative h-48 w-48 shrink-0 cursor-crosshair rounded"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsb.h} 100% 50%))`,
            touchAction: 'none',
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#000]"
            style={{ left: `${hsb.s}%`, top: `${100 - hsb.b}%` }}
          />
        </div>
        <input
          type="range"
          aria-label="Hue"
          min={0}
          max={359}
          value={Math.round(hsb.h) % 360}
          onChange={(e) => setHsb({ ...hsb, h: Number(e.target.value) })}
          className="hue-slider h-48 w-4"
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
        />
        <div className="flex flex-1 flex-col gap-2">
          <div className="border-ui-border flex h-12 overflow-hidden rounded border" aria-hidden>
            <div className="flex-1" style={{ background: rgbToHex(rgb) }} title="New" />
            <div className="flex-1" style={{ background: rgbToHex(initial) }} title="Current" />
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <NumberField
              label="H"
              name="Hue degrees"
              value={hsb.h}
              max={359}
              unit="°"
              onChange={(h) => setHsb({ ...hsb, h })}
            />
            <NumberField
              label="R"
              name="Red"
              value={rgb[0]}
              max={255}
              onChange={(r) => setRgb([r, rgb[1], rgb[2]])}
            />
            <NumberField
              label="S"
              name="Saturation"
              value={hsb.s}
              max={100}
              unit="%"
              onChange={(s) => setHsb({ ...hsb, s })}
            />
            <NumberField
              label="G"
              name="Green"
              value={rgb[1]}
              max={255}
              onChange={(g) => setRgb([rgb[0], g, rgb[2]])}
            />
            <NumberField
              label="B"
              name="Brightness"
              value={hsb.b}
              max={100}
              unit="%"
              onChange={(b) => setHsb({ ...hsb, b })}
            />
            <NumberField
              label="B"
              name="Blue"
              value={rgb[2]}
              max={255}
              onChange={(b) => setRgb([rgb[0], rgb[1], b])}
            />
          </div>
          <label className="flex items-center justify-end gap-1.5">
            <span className="text-ui-muted">#</span>
            <input
              aria-label="Hex"
              value={hexDraft ?? hex.slice(1)}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                setHexDraft(e.target.value);
                const parsed = hexToRgb(e.target.value);
                if (parsed && e.target.value.replace('#', '').length === 6) setRgb(parsed);
              }}
              onBlur={() => {
                const parsed = hexDraft !== null ? hexToRgb(hexDraft) : null;
                if (parsed) setRgb(parsed);
                setHexDraft(null);
              }}
              className="bg-ui-bg border-ui-border w-20 rounded border px-1.5 py-0.5 font-mono uppercase"
            />
            <span className="w-3" />
          </label>
        </div>
      </div>
      {recent.length > 0 && (
        <div className="mt-3">
          <h3 className="text-ui-muted mb-1">Recent colours</h3>
          <div className="flex flex-wrap gap-1">
            {recent.map((c) => (
              <button
                key={rgbToHex(c)}
                aria-label={`Recent colour ${rgbToHex(c)}`}
                title={rgbToHex(c)}
                onClick={() => setRgb(c)}
                className="border-ui-border h-5 w-5 rounded-sm border"
                style={{ background: rgbToHex(c) }}
              />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
