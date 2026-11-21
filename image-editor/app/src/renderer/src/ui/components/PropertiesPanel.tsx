import { useId, useState, type ReactNode } from 'react';
import type { Editor, EditorSnapshot } from '../../engine/editor';
import {
  ADJUSTMENT_LABELS,
  curveFn,
  defaultAdjustment,
  type Adjustment,
  type AdjustmentOf,
  type ChannelKey,
  type LevelsChannel,
  type RGB,
} from '../../engine/ops/adjust';
import { Button } from './Button';
import { Modal } from './Modal';

type Props = { editor: Editor; snap: EditorSnapshot };

/** Changes one adjustment layer; `drag` coalesces the changes of one gesture into one undo step. */
type Change = (next: Adjustment, drag?: boolean) => void;

/**
 * Properties panel (docs/03 §5.2): the controls of the active adjustment layer (FR-ADJ-01). Every change is
 * live on the canvas; a slider drag is one undo step.
 */
export function PropertiesPanel({ editor, snap }: Props) {
  const active = snap.activeAdjustment;
  if (!active)
    return (
      <p className="text-ui-muted p-3">
        Select an adjustment layer to change its settings. Add one with the ◑ button in Layers or Layer › New
        Adjustment Layer.
      </p>
    );
  const { id, adjustment } = active;
  const change: Change = (next, drag = false) => editor.setAdjustment(id, next, { coalesce: drag });
  const end = () => editor.endAdjustmentEdit();
  return (
    <section
      aria-label={`${ADJUSTMENT_LABELS[adjustment.kind]} properties`}
      className="flex flex-col gap-2 overflow-auto p-2"
      // A drag ends wherever the pointer is released; the next change is a new step.
      onPointerUp={end}
      onKeyUp={end}
    >
      <header className="flex items-center justify-between">
        <h2 className="font-semibold">{ADJUSTMENT_LABELS[adjustment.kind]}</h2>
        <Button
          title="Back to the default settings"
          onClick={() => {
            end();
            change(defaultAdjustment(adjustment.kind));
          }}
        >
          Reset
        </Button>
      </header>
      <Controls adjustment={adjustment} change={change} />
    </section>
  );
}

export function Controls({ adjustment: a, change }: { adjustment: Adjustment; change: Change }) {
  switch (a.kind) {
    case 'brightness-contrast':
      return (
        <>
          <Slider
            label="Brightness"
            value={a.brightness}
            min={-150}
            max={150}
            onChange={(v, d) => change({ ...a, brightness: v }, d)}
          />
          <Slider
            label="Contrast"
            value={a.contrast}
            min={a.legacy ? -100 : -50}
            max={100}
            onChange={(v, d) => change({ ...a, contrast: v }, d)}
          />
          <Check
            label="Use Legacy"
            checked={a.legacy}
            onChange={(legacy) =>
              change({ ...a, legacy, contrast: legacy ? a.contrast : Math.max(-50, a.contrast) })
            }
          />
        </>
      );
    case 'levels':
      return <LevelsControls a={a} change={change} />;
    case 'curves':
      return <CurvesControls a={a} change={change} />;
    case 'exposure':
      return (
        <>
          <Slider
            label="Exposure"
            value={a.exposure}
            min={-20}
            max={20}
            step={0.01}
            onChange={(v, d) => change({ ...a, exposure: v }, d)}
          />
          <Slider
            label="Offset"
            value={a.offset}
            min={-0.5}
            max={0.5}
            step={0.0001}
            onChange={(v, d) => change({ ...a, offset: v }, d)}
          />
          <Slider
            label="Gamma Correction"
            value={a.gamma}
            min={0.01}
            max={9.99}
            step={0.01}
            onChange={(v, d) => change({ ...a, gamma: v }, d)}
          />
        </>
      );
    case 'vibrance':
      return (
        <>
          <Slider
            label="Vibrance"
            value={a.vibrance}
            min={-100}
            max={100}
            onChange={(v, d) => change({ ...a, vibrance: v }, d)}
          />
          <Slider
            label="Saturation"
            value={a.saturation}
            min={-100}
            max={100}
            onChange={(v, d) => change({ ...a, saturation: v }, d)}
          />
        </>
      );
    case 'hue-saturation':
      return (
        <>
          <Slider
            label="Hue"
            value={a.hue}
            min={a.colorize ? 0 : -180}
            max={a.colorize ? 360 : 180}
            onChange={(v, d) => change({ ...a, hue: v }, d)}
          />
          <Slider
            label="Saturation"
            value={a.saturation}
            min={a.colorize ? 0 : -100}
            max={100}
            onChange={(v, d) => change({ ...a, saturation: v }, d)}
          />
          <Slider
            label="Lightness"
            value={a.lightness}
            min={-100}
            max={100}
            onChange={(v, d) => change({ ...a, lightness: v }, d)}
          />
          <Check
            label="Colorize"
            checked={a.colorize}
            // Colorize starts from Photoshop's values: a hue on the colour wheel and 25 % saturation.
            onChange={(colorize) =>
              change(
                colorize
                  ? { ...a, colorize, hue: ((Math.round(a.hue) % 360) + 360) % 360, saturation: 25 }
                  : { ...a, colorize, hue: 0, saturation: 0 },
              )
            }
          />
        </>
      );
    case 'color-balance':
      return <ColorBalanceControls a={a} change={change} />;
    case 'black-white': {
      const w = a.weights;
      const names = [
        ['r', 'Reds'],
        ['y', 'Yellows'],
        ['g', 'Greens'],
        ['c', 'Cyans'],
        ['b', 'Blues'],
        ['m', 'Magentas'],
      ] as const;
      return (
        <>
          {names.map(([k, label]) => (
            <Slider
              key={k}
              label={label}
              value={w[k]}
              min={-200}
              max={300}
              unit="%"
              onChange={(v, d) => change({ ...a, weights: { ...w, [k]: v } }, d)}
            />
          ))}
          <Check
            label="Tint"
            checked={Boolean(a.tint)}
            onChange={(on) => {
              const { tint: _tint, ...rest } = a;
              change(on ? { ...rest, tint: [225, 211, 179] } : rest);
            }}
          />
          {a.tint && (
            <ColorField label="Tint colour" value={a.tint} onChange={(tint) => change({ ...a, tint })} />
          )}
        </>
      );
    }
    case 'photo-filter':
      return (
        <>
          <ColorField label="Filter colour" value={a.color} onChange={(color) => change({ ...a, color })} />
          <Slider
            label="Density"
            value={a.density}
            min={0}
            max={100}
            unit="%"
            onChange={(v, d) => change({ ...a, density: v }, d)}
          />
          <Check
            label="Preserve Luminosity"
            checked={a.preserveLuminosity}
            onChange={(preserveLuminosity) => change({ ...a, preserveLuminosity })}
          />
        </>
      );
    case 'invert':
      return <p className="text-ui-muted">Invert has no settings.</p>;
    case 'posterize':
      return (
        <Slider
          label="Levels"
          value={a.levels}
          min={2}
          max={255}
          onChange={(v, d) => change({ ...a, levels: v }, d)}
        />
      );
    case 'threshold':
      return (
        <Slider
          label="Threshold Level"
          value={a.level}
          min={1}
          max={255}
          onChange={(v, d) => change({ ...a, level: v }, d)}
        />
      );
  }
}

const CHANNELS: ReadonlyArray<readonly [ChannelKey, string]> = [
  ['rgb', 'RGB'],
  ['r', 'Red'],
  ['g', 'Green'],
  ['b', 'Blue'],
];

function ChannelSelect(props: { value: ChannelKey; onChange: (c: ChannelKey) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-ui-muted w-20">Channel</span>
      <select
        aria-label="Channel"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as ChannelKey)}
        className="bg-ui-bg border-ui-border rounded border px-1 py-0.5"
      >
        {CHANNELS.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LevelsControls({ a, change }: { a: AdjustmentOf<'levels'>; change: Change }) {
  const [channel, setChannel] = useState<ChannelKey>('rgb');
  const c = a.channels[channel];
  const set = (patch: Partial<LevelsChannel>, drag?: boolean) =>
    change({ ...a, channels: { ...a.channels, [channel]: { ...c, ...patch } } }, drag);
  return (
    <>
      <ChannelSelect value={channel} onChange={setChannel} />
      <Slider
        label="Input black"
        value={c.inBlack}
        min={0}
        max={c.inWhite - 2}
        onChange={(v, d) => set({ inBlack: v }, d)}
      />
      <Slider
        label="Midtones"
        value={c.gamma}
        min={0.1}
        max={9.99}
        step={0.01}
        onChange={(v, d) => set({ gamma: v }, d)}
      />
      <Slider
        label="Input white"
        value={c.inWhite}
        min={c.inBlack + 2}
        max={255}
        onChange={(v, d) => set({ inWhite: v }, d)}
      />
      <Slider
        label="Output black"
        value={c.outBlack}
        min={0}
        max={255}
        onChange={(v, d) => set({ outBlack: v }, d)}
      />
      <Slider
        label="Output white"
        value={c.outWhite}
        min={0}
        max={255}
        onChange={(v, d) => set({ outWhite: v }, d)}
      />
    </>
  );
}

const SIDE = 200;

/**
 * Curves (docs/03 §5.2): click the graph to add a point, drag a point to move it, drag it off the graph
 * (or double-click it) to remove it. The end points stay at the left and right edges.
 */
function CurvesControls({ a, change }: { a: AdjustmentOf<'curves'>; change: Change }) {
  const [channel, setChannel] = useState<ChannelKey>('rgb');
  const [dragging, setDragging] = useState<number | null>(null);
  const points = a.channels[channel];
  const setPoints = (next: Array<[number, number]>, drag?: boolean) =>
    change({ ...a, channels: { ...a.channels, [channel]: next } }, drag);
  const f = curveFn(points);
  const path = Array.from({ length: 65 }, (_, i) => {
    const x = (i / 64) * 255;
    return `${i ? 'L' : 'M'}${(x / 255) * SIDE},${SIDE - f(x / 255) * SIDE}`;
  }).join(' ');
  const toValue = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 255;
    const y = 255 - ((e.clientY - r.top) / r.height) * 255;
    return [Math.round(x), Math.round(y)];
  };
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  return (
    <>
      <ChannelSelect value={channel} onChange={setChannel} />
      <svg
        role="img"
        aria-label={`Curve for ${CHANNELS.find(([k]) => k === channel)![1]}`}
        viewBox={`0 0 ${SIDE} ${SIDE}`}
        className="bg-ui-bg border-ui-border w-full max-w-[200px] touch-none rounded border"
        onPointerDown={(e) => {
          const [x, y] = toValue(e);
          const hit = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 10);
          e.currentTarget.setPointerCapture(e.pointerId);
          if (hit >= 0) return setDragging(hit);
          if (points.length >= 16) return;
          const next = [...points, [clamp(x), clamp(y)] as [number, number]].sort((p, q) => p[0] - q[0]);
          setDragging(next.findIndex(([px]) => px === clamp(x)));
          setPoints(next, true);
        }}
        onPointerMove={(e) => {
          if (dragging === null) return;
          const [x, y] = toValue(e);
          const first = dragging === 0;
          const last = dragging === points.length - 1;
          // Interior points stay between their neighbours; the ends stay on the edges' x range.
          const lo = first ? 0 : points[dragging - 1]![0] + 1;
          const hi = last ? 255 : points[dragging + 1]![0] - 1;
          const next = points.map((p, i) =>
            i === dragging ? ([Math.max(lo, Math.min(hi, x)), clamp(y)] as [number, number]) : p,
          );
          setPoints(next, true);
        }}
        onPointerUp={(e) => {
          if (dragging === null) return;
          const [x, y] = toValue(e);
          const off = x < -20 || x > 275 || y < -20 || y > 275;
          if (off && points.length > 2)
            setPoints(
              points.filter((_, i) => i !== dragging),
              true,
            );
          setDragging(null);
        }}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * 255;
          const y = 255 - ((e.clientY - r.top) / r.height) * 255;
          const hit = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 10);
          if (hit >= 0 && points.length > 2) setPoints(points.filter((_, i) => i !== hit));
        }}
      >
        {[1, 2, 3].map((q) => (
          <g key={q} stroke="currentColor" strokeOpacity={0.15}>
            <line x1={(q * SIDE) / 4} y1={0} x2={(q * SIDE) / 4} y2={SIDE} />
            <line x1={0} y1={(q * SIDE) / 4} x2={SIDE} y2={(q * SIDE) / 4} />
          </g>
        ))}
        <line x1={0} y1={SIDE} x2={SIDE} y2={0} stroke="currentColor" strokeOpacity={0.25} />
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
        {points.map(([x, y], i) => (
          <rect
            key={i}
            x={(x / 255) * SIDE - 4}
            y={SIDE - (y / 255) * SIDE - 4}
            width={8}
            height={8}
            fill={i === dragging ? 'currentColor' : 'none'}
            stroke="currentColor"
          />
        ))}
      </svg>
      <p className="text-ui-muted text-xs">Click to add a point; drag a point off the graph to remove it.</p>
    </>
  );
}

function ColorBalanceControls({ a, change }: { a: AdjustmentOf<'color-balance'>; change: Change }) {
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const values = a[tone];
  const set = (i: number, v: number, drag?: boolean) =>
    change({ ...a, [tone]: values.map((x, j) => (j === i ? v : x)) as RGB }, drag);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="text-ui-muted w-20">Tone</span>
        <select
          aria-label="Tone"
          value={tone}
          onChange={(e) => setTone(e.target.value as typeof tone)}
          className="bg-ui-bg border-ui-border rounded border px-1 py-0.5"
        >
          <option value="shadows">Shadows</option>
          <option value="midtones">Midtones</option>
          <option value="highlights">Highlights</option>
        </select>
      </label>
      <Slider label="Cyan – Red" value={values[0]} min={-100} max={100} onChange={(v, d) => set(0, v, d)} />
      <Slider
        label="Magenta – Green"
        value={values[1]}
        min={-100}
        max={100}
        onChange={(v, d) => set(1, v, d)}
      />
      <Slider
        label="Yellow – Blue"
        value={values[2]}
        min={-100}
        max={100}
        onChange={(v, d) => set(2, v, d)}
      />
      <Check
        label="Preserve Luminosity"
        checked={a.preserveLuminosity}
        onChange={(preserveLuminosity) => change({ ...a, preserveLuminosity })}
      />
    </>
  );
}

/** A labelled range slider with a number field; the slider's drag coalesces into one undo step. */
function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number, drag: boolean) => void;
}) {
  const id = useId();
  const step = props.step ?? 1;
  const decimals = step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0;
  const fit = (v: number) => Math.max(props.min, Math.min(props.max, v));
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-ui-muted w-20 shrink-0 truncate" title={props.label}>
        {props.label}
      </label>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={step}
        value={props.value}
        onChange={(e) => props.onChange(fit(Number(e.target.value)), true)}
        className="min-w-0 flex-1"
      />
      <input
        type="number"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={step}
        value={Number(props.value.toFixed(decimals))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) props.onChange(fit(v), false);
        }}
        className="bg-ui-bg border-ui-border w-16 rounded border px-1 py-0.5 tabular-nums"
      />
      {props.unit && <span className="text-ui-muted -ml-1">{props.unit}</span>}
    </div>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

function ColorField(props: { label: string; value: RGB; onChange: (v: RGB) => void }): ReactNode {
  const hex = `#${props.value.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  return (
    <label className="flex items-center gap-2">
      <span className="text-ui-muted w-20">{props.label}</span>
      <input
        type="color"
        aria-label={props.label}
        value={hex}
        onChange={(e) => {
          const h = e.target.value;
          props.onChange([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB);
        }}
      />
    </label>
  );
}

/**
 * Image › Adjustments › … (FR-ADJ-01, docs/03 §5.2): the same controls as Properties, applied to the active
 * layer's pixels (within the selection) on OK. The canvas previews them live; Preview off shows the original.
 */
export function AdjustmentDialog(props: {
  adjusting: NonNullable<EditorSnapshot['adjusting']>;
  onChange: (a: Adjustment) => void;
  onPreview: (on: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const { adjustment, preview } = props.adjusting;
  return (
    <Modal
      title={ADJUSTMENT_LABELS[adjustment.kind]}
      onCancel={props.onCancel}
      backdrop="clear"
      align="end"
      width="w-[340px]"
      footer={
        <>
          <Check label="Preview" checked={preview} onChange={props.onPreview} />
          <span className="flex-1" />
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button type="submit" form={id} variant="primary">
            OK
          </Button>
        </>
      }
    >
      <form
        id={id}
        aria-label={`${ADJUSTMENT_LABELS[adjustment.kind]} settings`}
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          props.onApply();
        }}
      >
        <Controls adjustment={adjustment} change={(next) => props.onChange(next)} />
        <div className="flex justify-end">
          <Button onClick={() => props.onChange(defaultAdjustment(adjustment.kind))}>Reset</Button>
        </div>
      </form>
    </Modal>
  );
}
