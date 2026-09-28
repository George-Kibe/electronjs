import type { BrushSettings } from '../../engine/brush/brush';
import type { Tool } from '../../engine/editor';
import { Button } from './Button';

type Props = {
  tool: Tool;
  brush: BrushSettings;
  zoom: number;
  onBrush: (patch: Partial<BrushSettings>) => void;
  onFit: () => void;
  onActualSize: () => void;
};

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const id = `opt-${props.label.toLowerCase()}`;
  return (
    <label htmlFor={id} className="flex items-center gap-1.5">
      <span className="text-ui-muted">{props.label}</span>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-24"
      />
      <span className="w-12 tabular-nums">
        {props.value}
        {props.unit}
      </span>
    </label>
  );
}

const toHex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

export function OptionsBar({ tool, brush, zoom, onBrush, onFit, onActualSize }: Props) {
  const painting = tool === 'brush' || tool === 'eraser';
  return (
    <div
      role="toolbar"
      aria-label="Tool options"
      className="bg-ui-panel border-ui-border flex h-9 items-center gap-4 border-b px-3"
    >
      <span className="font-semibold capitalize">{tool}</span>
      {painting ? (
        <>
          <Slider
            label="Size"
            value={brush.size}
            min={1}
            max={500}
            unit="px"
            onChange={(size) => onBrush({ size })}
          />
          <Slider
            label="Hardness"
            value={Math.round(brush.hardness * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => onBrush({ hardness: v / 100 })}
          />
          <Slider
            label="Opacity"
            value={Math.round(brush.opacity * 100)}
            min={1}
            max={100}
            unit="%"
            onChange={(v) => onBrush({ opacity: v / 100 })}
          />
          <Slider
            label="Flow"
            value={Math.round(brush.flow * 100)}
            min={1}
            max={100}
            unit="%"
            onChange={(v) => onBrush({ flow: v / 100 })}
          />
          {tool === 'brush' && (
            <label className="flex items-center gap-1.5">
              <span className="text-ui-muted">Colour</span>
              <input
                type="color"
                aria-label="Brush colour"
                value={toHex(brush.color)}
                onChange={(e) => onBrush({ color: fromHex(e.target.value) })}
                className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
              />
            </label>
          )}
        </>
      ) : (
        <>
          <Button onClick={onFit}>Fit on screen</Button>
          <Button onClick={onActualSize}>100 %</Button>
          <span className="text-ui-muted tabular-nums">{Math.round(zoom * 100)} %</span>
        </>
      )}
    </div>
  );
}
