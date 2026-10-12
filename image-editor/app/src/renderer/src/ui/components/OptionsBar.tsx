import { BRUSH_TIPS, TIP_LABELS, type BrushTip } from '../../engine/brush/tips';
import type { AlignEdge } from '../../engine/doc/translate';
import { isPaintTool, type BrushOptions, type Tool, type ToolOptions } from '../../engine/editor';
import { Button } from './Button';

type Props = {
  tool: Tool;
  options: ToolOptions;
  zoom: number;
  onOptions: <T extends keyof ToolOptions>(tool: T, patch: Partial<ToolOptions[T]>) => void;
  onResetTool: (tool: keyof ToolOptions) => void;
  onAlign: (edge: AlignEdge) => void;
  onFit: () => void;
  onActualSize: () => void;
};

const TOOL_NAMES: Record<Tool, string> = {
  move: 'Move',
  brush: 'Brush',
  pencil: 'Pencil',
  eraser: 'Eraser',
  eyedropper: 'Eyedropper',
  hand: 'Hand',
  zoom: 'Zoom',
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
        className="w-16"
      />
      <span className="w-10 tabular-nums">
        {props.value}
        {props.unit}
      </span>
    </label>
  );
}

function Toggle(props: { label: string; title: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Button
      aria-pressed={props.checked}
      active={props.checked}
      aria-label={props.title}
      title={props.title}
      onClick={() => props.onChange(!props.checked)}
    >
      {props.label}
    </Button>
  );
}

function Select<T extends string | number>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-ui-muted">{props.label}</span>
      <select
        aria-label={props.label}
        value={String(props.value)}
        onChange={(e) => {
          const hit = props.options.find(([v]) => String(v) === e.target.value);
          if (hit) props.onChange(hit[0]);
        }}
        className="bg-ui-bg border-ui-border rounded border px-1 py-0.5"
      >
        {props.options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const pct = (v: number) => Math.round(v * 100);

/** Brush, pencil and eraser options (FR-PNT-01/02). */
function PaintOptions({
  tool,
  options,
  onOptions,
}: {
  tool: 'brush' | 'pencil' | 'eraser';
  options: ToolOptions;
  onOptions: Props['onOptions'];
}) {
  const o: BrushOptions = options[tool];
  const set = (patch: Partial<BrushOptions>) => onOptions(tool, patch);
  const aliased = tool === 'pencil' || (tool === 'eraser' && options.eraser.pencil);
  return (
    <>
      {tool === 'eraser' && (
        <Select
          label="Mode"
          value={options.eraser.pencil ? 'pencil' : 'brush'}
          options={[
            ['brush', 'Brush'],
            ['pencil', 'Pencil'],
          ]}
          onChange={(v) => onOptions('eraser', { pencil: v === 'pencil' })}
        />
      )}
      {tool === 'brush' && (
        <Select<BrushTip>
          label="Tip"
          value={o.tip}
          options={BRUSH_TIPS.map((t) => [t, TIP_LABELS[t]] as const)}
          onChange={(tip) => set({ tip })}
        />
      )}
      <Slider label="Size" value={o.size} min={1} max={500} unit="px" onChange={(size) => set({ size })} />
      {!aliased && (
        <Slider
          label="Hardness"
          value={pct(o.hardness)}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => set({ hardness: v / 100 })}
        />
      )}
      <Slider
        label="Opacity"
        value={pct(o.opacity)}
        min={1}
        max={100}
        unit="%"
        onChange={(v) => set({ opacity: v / 100 })}
      />
      <Slider
        label="Flow"
        value={pct(o.flow)}
        min={1}
        max={100}
        unit="%"
        onChange={(v) => set({ flow: v / 100 })}
      />
      {!aliased && (
        <Slider
          label="Spacing"
          value={pct(o.spacing)}
          min={1}
          max={200}
          unit="%"
          onChange={(v) => set({ spacing: v / 100 })}
        />
      )}
      <Slider
        label="Smoothing"
        value={pct(o.smoothing)}
        min={0}
        max={100}
        unit="%"
        onChange={(v) => set({ smoothing: v / 100 })}
      />
      <Toggle
        label="⤿ Size"
        title="Pen pressure controls size"
        checked={o.pressureSize}
        onChange={(pressureSize) => set({ pressureSize })}
      />
      <Toggle
        label="⤿ Opacity"
        title="Pen pressure controls opacity"
        checked={o.pressureOpacity}
        onChange={(pressureOpacity) => set({ pressureOpacity })}
      />
    </>
  );
}

const ALIGN: Array<[AlignEdge, string, string]> = [
  ['left', '⇤', 'Align left edges'],
  ['hcenter', '↔', 'Align horizontal centres'],
  ['right', '⇥', 'Align right edges'],
  ['top', '⤒', 'Align top edges'],
  ['vcenter', '↕', 'Align vertical centres'],
  ['bottom', '⤓', 'Align bottom edges'],
];

export function OptionsBar({
  tool,
  options,
  zoom,
  onOptions,
  onResetTool,
  onAlign,
  onFit,
  onActualSize,
}: Props) {
  const resettable = tool === 'hand' || tool === 'zoom' ? null : tool;
  return (
    <div
      role="toolbar"
      aria-label="Tool options"
      className="bg-ui-panel border-ui-border flex h-9 items-center gap-3 overflow-x-auto border-b px-3 whitespace-nowrap [scrollbar-width:thin]"
    >
      <span className="font-semibold">{TOOL_NAMES[tool]}</span>
      {isPaintTool(tool) && <PaintOptions tool={tool} options={options} onOptions={onOptions} />}
      {tool === 'eyedropper' && (
        <>
          <Select
            label="Sample size"
            value={options.eyedropper.size}
            options={[
              [1, 'Point sample'],
              [3, '3 by 3 average'],
              [5, '5 by 5 average'],
            ]}
            onChange={(size) => onOptions('eyedropper', { size })}
          />
          <Select
            label="Sample"
            value={options.eyedropper.source}
            options={[
              ['layer', 'Current layer'],
              ['all', 'All layers'],
            ]}
            onChange={(source) => onOptions('eyedropper', { source })}
          />
        </>
      )}
      {tool === 'move' && (
        <>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={options.move.autoSelect}
              onChange={(e) => onOptions('move', { autoSelect: e.target.checked })}
            />
            <span>Auto-select</span>
          </label>
          <select
            aria-label="Auto-select target"
            value={options.move.autoSelectMode}
            onChange={(e) => onOptions('move', { autoSelectMode: e.target.value as 'layer' | 'group' })}
            className="bg-ui-bg border-ui-border rounded border px-1 py-0.5"
          >
            <option value="layer">Layer</option>
            <option value="group">Group</option>
          </select>
          <span role="group" aria-label="Align to canvas" className="flex items-center gap-0.5">
            {ALIGN.map(([edge, icon, label]) => (
              <Button
                key={edge}
                aria-label={label}
                title={`${label} (to the canvas)`}
                onClick={() => onAlign(edge)}
              >
                {icon}
              </Button>
            ))}
          </span>
        </>
      )}
      {(tool === 'hand' || tool === 'zoom') && (
        <>
          <Button onClick={onFit}>Fit on screen</Button>
          <Button onClick={onActualSize}>100 %</Button>
          <span className="text-ui-muted tabular-nums">{Math.round(zoom * 100)} %</span>
        </>
      )}
      {resettable && (
        <Button className="ml-auto" title="Reset this tool's options" onClick={() => onResetTool(resettable)}>
          Reset tool
        </Button>
      )}
    </div>
  );
}
