import { useState } from 'react';
import type { ModifyOp } from '../../engine/ops/modify';
import type { RGB } from '../../engine/doc/sample';
import { rgbToHex } from '../../lib/color';
import { Field, FormDialog } from './ImageDialogs';

export type ModifyKind = ModifyOp['kind'];

const MODIFY: Record<ModifyKind, { title: string; label: string; initial: number; max: number }> = {
  feather: { title: 'Feather Selection', label: 'Feather radius', initial: 5, max: 1000 },
  expand: { title: 'Expand Selection', label: 'Expand by', initial: 5, max: 500 },
  contract: { title: 'Contract Selection', label: 'Contract by', initial: 5, max: 500 },
  border: { title: 'Border Selection', label: 'Width', initial: 10, max: 200 },
  smooth: { title: 'Smooth Selection', label: 'Sample radius', initial: 2, max: 100 },
};

/** Select › Modify › … (FR-SEL-05): one amount in pixels. */
export function ModifyDialog(props: {
  kind: ModifyKind;
  onApply: (op: ModifyOp) => void;
  onCancel: () => void;
}) {
  const m = MODIFY[props.kind];
  const [value, setValue] = useState(m.initial);
  const valid = Number.isFinite(value) && value > 0 && value <= m.max;
  const op = (): ModifyOp => {
    switch (props.kind) {
      case 'feather':
        return { kind: 'feather', radius: value };
      case 'expand':
        return { kind: 'expand', by: value };
      case 'contract':
        return { kind: 'contract', by: value };
      case 'border':
        return { kind: 'border', width: value };
      default:
        return { kind: 'smooth', radius: value };
    }
  };
  return (
    <FormDialog title={m.title} valid={valid} onApply={() => props.onApply(op())} onCancel={props.onCancel}>
      <Field
        label={m.label}
        value={value}
        unit="px"
        min={props.kind === 'feather' ? 0.1 : 1}
        max={m.max}
        step={props.kind === 'feather' ? 0.1 : 1}
        onChange={setValue}
      />
    </FormDialog>
  );
}

/** Select › Color Range (FR-SEL-05, basic): pixels close to the foreground colour. */
export function ColorRangeDialog(props: {
  color: RGB;
  onApply: (fuzziness: number, sampleAll: boolean) => void;
  onCancel: () => void;
}) {
  const [fuzziness, setFuzziness] = useState(40);
  const [sampleAll, setSampleAll] = useState(true);
  return (
    <FormDialog
      title="Color Range"
      valid={fuzziness >= 0 && fuzziness <= 200}
      onApply={() => props.onApply(fuzziness, sampleAll)}
      onCancel={props.onCancel}
    >
      <p className="flex items-center gap-2">
        <span
          aria-hidden
          className="border-ui-border inline-block h-4 w-4 rounded border"
          style={{ background: rgbToHex(props.color) }}
        />
        Selects colours close to the foreground colour ({rgbToHex(props.color)}).
      </p>
      <Field label="Fuzziness" value={fuzziness} unit="" min={0} max={200} step={1} onChange={setFuzziness} />
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={sampleAll} onChange={(e) => setSampleAll(e.target.checked)} />
        Sample all layers
      </label>
    </FormDialog>
  );
}
