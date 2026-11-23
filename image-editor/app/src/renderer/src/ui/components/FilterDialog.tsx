import { useId } from 'react';
import type { EditorSnapshot } from '../../engine/editor';
import { defaultFilter, FILTER_LABELS, type Filter } from '../../engine/ops/filters';
import { Button } from './Button';
import { Modal } from './Modal';
import { Check, Slider } from './PropertiesPanel';

/**
 * Filter › … (FR-FLT-01, docs/03 §5.3): the filter's settings; the canvas previews the tiles in view (Preview
 * off shows the original), and OK applies it to the layer within the selection.
 */
export function FilterDialog(props: {
  filtering: NonNullable<EditorSnapshot['filtering']>;
  onChange: (f: Filter) => void;
  onPreview: (on: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const { filter: f, preview, updating } = props.filtering;
  const set = props.onChange;
  return (
    <Modal
      title={FILTER_LABELS[f.kind]}
      onCancel={props.onCancel}
      backdrop="clear"
      align="end"
      width="w-[340px]"
      footer={
        <>
          <Check label="Preview" checked={preview} onChange={props.onPreview} />
          <span className="text-ui-muted flex-1 text-xs" role="status">
            {updating && preview ? 'Updating preview…' : ''}
          </span>
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button type="submit" form={id} variant="primary">
            OK
          </Button>
        </>
      }
    >
      <form
        id={id}
        aria-label={`${FILTER_LABELS[f.kind]} settings`}
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          props.onApply();
        }}
      >
        {f.kind === 'gaussian-blur' && (
          <Slider
            label="Radius"
            value={f.radius}
            min={0.1}
            max={250}
            step={0.1}
            unit="px"
            onChange={(radius) => set({ ...f, radius })}
          />
        )}
        {f.kind === 'box-blur' && (
          <Slider
            label="Radius"
            value={f.radius}
            min={1}
            max={500}
            unit="px"
            onChange={(radius) => set({ ...f, radius })}
          />
        )}
        {f.kind === 'unsharp-mask' && (
          <>
            <Slider
              label="Amount"
              value={f.amount}
              min={1}
              max={500}
              unit="%"
              onChange={(amount) => set({ ...f, amount })}
            />
            <Slider
              label="Radius"
              value={f.radius}
              min={0.1}
              max={250}
              step={0.1}
              unit="px"
              onChange={(radius) => set({ ...f, radius })}
            />
            <Slider
              label="Threshold"
              value={f.threshold}
              min={0}
              max={255}
              onChange={(threshold) => set({ ...f, threshold })}
            />
          </>
        )}
        {f.kind === 'motion-blur' && (
          <>
            <Slider
              label="Angle"
              value={f.angle}
              min={-90}
              max={90}
              unit="°"
              onChange={(angle) => set({ ...f, angle })}
            />
            <Slider
              label="Distance"
              value={f.distance}
              min={1}
              max={500}
              unit="px"
              onChange={(distance) => set({ ...f, distance })}
            />
          </>
        )}
        {f.kind === 'add-noise' && (
          <>
            <Slider
              label="Amount"
              value={f.amount}
              min={0.1}
              max={400}
              step={0.1}
              unit="%"
              onChange={(amount) => set({ ...f, amount })}
            />
            <label className="flex items-center gap-2">
              <span className="text-ui-muted w-20">Distribution</span>
              <select
                aria-label="Distribution"
                value={f.distribution}
                onChange={(e) => set({ ...f, distribution: e.target.value as 'uniform' | 'gaussian' })}
                className="bg-ui-bg border-ui-border rounded border px-1 py-0.5"
              >
                <option value="uniform">Uniform</option>
                <option value="gaussian">Gaussian</option>
              </select>
            </label>
            <Check
              label="Monochromatic"
              checked={f.monochromatic}
              onChange={(monochromatic) => set({ ...f, monochromatic })}
            />
          </>
        )}
        {f.kind === 'reduce-noise' && (
          <Slider
            label="Radius"
            value={f.radius}
            min={1}
            max={10}
            unit="px"
            onChange={(radius) => set({ ...f, radius })}
          />
        )}
        {f.kind === 'mosaic' && (
          <Slider
            label="Cell Size"
            value={f.cellSize}
            min={2}
            max={200}
            unit="px"
            onChange={(cellSize) => set({ ...f, cellSize })}
          />
        )}
        {f.kind === 'emboss' && (
          <>
            <Slider
              label="Angle"
              value={f.angle}
              min={-180}
              max={180}
              unit="°"
              onChange={(angle) => set({ ...f, angle })}
            />
            <Slider
              label="Height"
              value={f.height}
              min={1}
              max={10}
              unit="px"
              onChange={(height) => set({ ...f, height })}
            />
            <Slider
              label="Amount"
              value={f.amount}
              min={1}
              max={500}
              unit="%"
              onChange={(amount) => set({ ...f, amount })}
            />
          </>
        )}
        {f.kind === 'vignette' && (
          <>
            <Slider
              label="Amount"
              value={f.amount}
              min={-100}
              max={100}
              onChange={(amount) => set({ ...f, amount })}
            />
            <Slider
              label="Midpoint"
              value={f.midpoint}
              min={0}
              max={100}
              onChange={(midpoint) => set({ ...f, midpoint })}
            />
          </>
        )}
        <div className="flex justify-end">
          <Button onClick={() => set(defaultFilter(f.kind))}>Reset</Button>
        </div>
      </form>
    </Modal>
  );
}
