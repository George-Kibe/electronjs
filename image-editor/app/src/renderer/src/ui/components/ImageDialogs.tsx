import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { MAX_DOCUMENT_SIDE } from '@shared/constants';
import type { Anchor } from '../../engine/doc/geometry';
import { FILTER_LABELS, RESAMPLE_FILTERS, type ResampleFilter } from '../../engine/ops/resample';
import { Button } from './Button';
import { Modal } from './Modal';

type Size = { width: number; height: number };

const validSide = (v: number) => Number.isInteger(v) && v >= 1 && v <= MAX_DOCUMENT_SIDE;

function Field(props: {
  label: string;
  value: number;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-ui-muted w-14">{props.label}</span>
      <input
        type="number"
        min={props.min ?? 1}
        max={props.max ?? MAX_DOCUMENT_SIDE}
        step={props.step ?? 1}
        value={Number.isFinite(props.value) ? props.value : ''}
        onChange={(e) => props.onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        className="bg-ui-bg border-ui-border w-24 rounded border px-1.5 py-1 tabular-nums"
      />
      <span className="text-ui-muted">{props.unit}</span>
    </label>
  );
}

/** Modal with a form: Enter applies, Escape cancels. */
function FormDialog(props: {
  title: string;
  valid: boolean;
  onApply: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (props.valid) props.onApply();
  };
  return (
    <Modal
      title={props.title}
      onCancel={props.onCancel}
      footer={
        <>
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button type="submit" form={id} variant="primary" disabled={!props.valid}>
            OK
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={submit} aria-label={props.title} className="flex flex-col gap-2">
        {props.children}
      </form>
    </Modal>
  );
}

/** Image › Image Size (FR-TRF-02): new pixel size, constrained proportions, resampling method. */
export function ImageSizeDialog(props: {
  current: Size;
  onApply: (size: Size, filter: ResampleFilter) => void;
  onCancel: () => void;
}) {
  const { current } = props;
  const [size, setSize] = useState<Size>(current);
  const [constrain, setConstrain] = useState(true);
  const [filter, setFilter] = useState<ResampleFilter>('bicubic');
  const ratio = current.width / current.height;
  const setWidth = (width: number) =>
    setSize({
      width,
      height: constrain && Number.isFinite(width) ? Math.max(1, Math.round(width / ratio)) : size.height,
    });
  const setHeight = (height: number) =>
    setSize({
      height,
      width: constrain && Number.isFinite(height) ? Math.max(1, Math.round(height * ratio)) : size.width,
    });
  const valid = validSide(size.width) && validSide(size.height);
  return (
    <FormDialog
      title="Image Size"
      valid={valid}
      onApply={() => props.onApply(size, filter)}
      onCancel={props.onCancel}
    >
      <p className="text-ui-muted">
        Currently {current.width} × {current.height} px
      </p>
      <Field label="Width" value={size.width} unit="px" onChange={setWidth} />
      <Field label="Height" value={size.height} unit="px" onChange={setHeight} />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={constrain} onChange={(e) => setConstrain(e.target.checked)} />
        Constrain proportions
      </label>
      <label className="flex items-center gap-2">
        <span className="text-ui-muted w-14">Resample</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ResampleFilter)}
          className="bg-ui-bg border-ui-border rounded border px-1 py-1"
        >
          {RESAMPLE_FILTERS.map((f) => (
            <option key={f} value={f}>
              {FILTER_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
    </FormDialog>
  );
}

const ANCHORS: Anchor['x'][] = [0, 0.5, 1];
const ROW_NAMES = { 0: 'Top', 0.5: 'Middle', 1: 'Bottom' } as const;
const COLUMN_NAMES = { 0: 'left', 0.5: 'centre', 1: 'right' } as const;
const anchorName = (x: Anchor['x'], y: Anchor['y']) =>
  x === 0.5 && y === 0.5 ? 'Centre' : `${ROW_NAMES[y]} ${COLUMN_NAMES[x]}`;

/** Image › Canvas Size (FR-TRF-02): new canvas size and where the current image sits in it. */
export function CanvasSizeDialog(props: {
  current: Size;
  onApply: (size: Size, anchor: Anchor) => void;
  onCancel: () => void;
}) {
  const [size, setSize] = useState<Size>(props.current);
  const [anchor, setAnchor] = useState<Anchor>({ x: 0.5, y: 0.5 });
  const valid = validSide(size.width) && validSide(size.height);
  return (
    <FormDialog
      title="Canvas Size"
      valid={valid}
      onApply={() => props.onApply(size, anchor)}
      onCancel={props.onCancel}
    >
      <p className="text-ui-muted">
        Currently {props.current.width} × {props.current.height} px. New area is transparent.
      </p>
      <Field label="Width" value={size.width} unit="px" onChange={(width) => setSize({ ...size, width })} />
      <Field
        label="Height"
        value={size.height}
        unit="px"
        onChange={(height) => setSize({ ...size, height })}
      />
      <div className="flex items-start gap-2">
        <span className="text-ui-muted w-14">Anchor</span>
        <div role="radiogroup" aria-label="Anchor" className="grid grid-cols-3 gap-0.5">
          {ANCHORS.map((y) =>
            ANCHORS.map((x) => {
              const checked = anchor.x === x && anchor.y === y;
              return (
                <button
                  key={`${x},${y}`}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={anchorName(x, y)}
                  onClick={() => setAnchor({ x, y })}
                  className={`border-ui-border h-6 w-6 rounded-sm border ${checked ? 'bg-brand' : 'bg-ui-bg hover:bg-ui-raised'}`}
                />
              );
            }),
          )}
        </div>
      </div>
    </FormDialog>
  );
}

/** Image › Image Rotation › Arbitrary (FR-TRF-03). */
export function RotateDialog(props: { onApply: (clockwiseDegrees: number) => void; onCancel: () => void }) {
  const [angle, setAngle] = useState(15);
  const [clockwise, setClockwise] = useState(true);
  const valid = Number.isFinite(angle) && Math.abs(angle) <= 359.99 && angle !== 0;
  return (
    <FormDialog
      title="Rotate Canvas"
      valid={valid}
      onApply={() => props.onApply(clockwise ? angle : -angle)}
      onCancel={props.onCancel}
    >
      <Field
        label="Angle"
        value={angle}
        unit="°"
        min={-359.99}
        max={359.99}
        step={0.01}
        onChange={setAngle}
      />
      <div role="radiogroup" aria-label="Direction" className="flex gap-4">
        {(
          [
            [true, 'Clockwise'],
            [false, 'Counter-clockwise'],
          ] as const
        ).map(([value, label]) => (
          <label key={label} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="direction"
              checked={clockwise === value}
              onChange={() => setClockwise(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="text-ui-muted">The canvas grows to fit; new corners are transparent.</p>
    </FormDialog>
  );
}
