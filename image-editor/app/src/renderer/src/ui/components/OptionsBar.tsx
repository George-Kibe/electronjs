import { BRUSH_TIPS, TIP_LABELS, type BrushTip } from '../../engine/brush/tips';
import type { CropRect } from '../../engine/doc/geometry';
import type { AlignEdge } from '../../engine/doc/translate';
import { CROP_RATIOS, RATIO_LABELS, type CropRatio } from '../../engine/tools/crop';
import type { SelectionOp } from '../../engine/doc/selection';
import type { MarqueeOptions as MarqueeOpts } from '../../engine/tools/marquee';
import {
  isPaintTool,
  type BrushOptions,
  type EditorSnapshot,
  type Tool,
  type ToolOptions,
} from '../../engine/editor';
import type { TransformParams } from '../../engine/tools/transform';
import { BLEND_MODE_LABELS, IMPLEMENTED_BLEND_MODES } from '../../engine/doc/blend';
import { GRADIENT_PRESET_LABELS, type GradientPreset, type GradientType } from '../../engine/ops/gradient';
import { Button } from './Button';

type Props = {
  tool: Tool;
  options: ToolOptions;
  zoom: number;
  onOptions: <T extends keyof ToolOptions>(tool: T, patch: Partial<ToolOptions[T]>) => void;
  onResetTool: (tool: keyof ToolOptions) => void;
  onAlign: (edge: AlignEdge) => void;
  crop: { rect: CropRect } | null;
  onCrop: {
    rect: (r: CropRect) => void;
    ratio: (r: CropRatio) => void;
    commit: () => void;
    reset: () => void;
  };
  onFit: () => void;
  onActualSize: () => void;
  /** Opens the colour picker for the Type tool's colour. */
  onEditTextColor?: () => void;
  transform: EditorSnapshot['transform'];
  onTransform: {
    params: (patch: Partial<TransformParams>) => void;
    commit: () => void;
    cancel: () => void;
  };
};

const TOOL_NAMES: Record<Tool, string> = {
  move: 'Move',
  marquee: 'Marquee',
  lasso: 'Lasso',
  wand: 'Magic Wand',
  crop: 'Crop',
  brush: 'Brush',
  pencil: 'Pencil',
  eraser: 'Eraser',
  eyedropper: 'Eyedropper',
  bucket: 'Paint Bucket',
  gradient: 'Gradient',
  clone: 'Clone Stamp',
  text: 'Type',
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
  tool: 'brush' | 'pencil' | 'eraser' | 'clone';
  options: ToolOptions;
  onOptions: Props['onOptions'];
}) {
  const o: BrushOptions = options[tool];
  const set = (patch: Partial<BrushOptions>) => onOptions(tool, patch);
  const aliased = tool === 'pencil' || (tool === 'eraser' && options.eraser.pencil);
  return (
    <>
      {(tool === 'brush' || tool === 'pencil') && (
        <Select
          label="Mode"
          value={o.blendMode ?? 'normal'}
          options={IMPLEMENTED_BLEND_MODES.map((m) => [m, BLEND_MODE_LABELS[m]] as const)}
          onChange={(blendMode) => set({ blendMode })}
        />
      )}
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

const CROP_FIELDS: Array<[label: string, name: string, key: keyof CropRect]> = [
  ['X', 'Crop X', 'x'],
  ['Y', 'Crop Y', 'y'],
  ['W', 'Crop width', 'width'],
  ['H', 'Crop height', 'height'],
];

/** Crop tool options (FR-TRF-01): ratio presets, numeric entry, delete cropped pixels, straighten. */
function CropOptions({
  options,
  crop,
  onOptions,
  onCrop,
}: Pick<Props, 'options' | 'crop' | 'onOptions' | 'onCrop'>) {
  const r = crop?.rect;
  return (
    <>
      <Select<CropRatio>
        label="Ratio"
        value={options.crop.ratio}
        options={CROP_RATIOS.map((c) => [c, RATIO_LABELS[c]] as const)}
        onChange={onCrop.ratio}
      />
      {r &&
        CROP_FIELDS.map(([label, name, key]) => (
          <label key={key} className="flex items-center gap-1">
            <span className="text-ui-muted">{label}</span>
            <input
              type="number"
              aria-label={name}
              min={key === 'width' || key === 'height' ? 1 : 0}
              value={Math.round(r[key])}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onCrop.rect({ ...r, [key]: v });
              }}
              className="bg-ui-bg border-ui-border w-16 rounded border px-1 py-0.5 tabular-nums"
            />
          </label>
        ))}
      <Toggle
        label="📐 Straighten"
        title="Straighten: draw a line along the horizon (or a vertical)"
        checked={options.crop.straighten}
        onChange={(straighten) => onOptions('crop', { straighten })}
      />
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={options.crop.deletePixels}
          onChange={(e) => onOptions('crop', { deletePixels: e.target.checked })}
        />
        <span>Delete cropped pixels</span>
      </label>
      <Button title="Reset the crop box (Esc)" onClick={onCrop.reset}>
        ✕ Reset
      </Button>
      <Button variant="primary" title="Crop (Enter)" onClick={onCrop.commit}>
        ✓ Crop
      </Button>
    </>
  );
}

const DEG = 180 / Math.PI;
const tenth = (v: number) => Math.round(v * 10) / 10;

/** Free Transform's numeric entry (FR-TRF-04): position, scale, rotation and skew, then apply or cancel. */
function TransformOptions({
  transform,
  onTransform,
}: {
  transform: NonNullable<Props['transform']>;
  onTransform: Props['onTransform'];
}) {
  const { box, params: p } = transform;
  const fields: ReadonlyArray<
    readonly [label: string, name: string, value: number, unit: string, set: (v: number) => void]
  > = [
    [
      'X',
      'Centre X',
      tenth((box.x0 + box.x1) / 2 + p.tx),
      'px',
      (v) => onTransform.params({ tx: v - (box.x0 + box.x1) / 2 }),
    ],
    [
      'Y',
      'Centre Y',
      tenth((box.y0 + box.y1) / 2 + p.ty),
      'px',
      (v) => onTransform.params({ ty: v - (box.y0 + box.y1) / 2 }),
    ],
    ['W', 'Width', tenth(p.sx * 100), '%', (v) => v !== 0 && onTransform.params({ sx: v / 100 })],
    ['H', 'Height', tenth(p.sy * 100), '%', (v) => v !== 0 && onTransform.params({ sy: v / 100 })],
    ['∠', 'Rotation', tenth(p.angle * DEG), '°', (v) => onTransform.params({ angle: v / DEG })],
    [
      'H',
      'Horizontal skew',
      tenth(p.skewX * DEG),
      '°',
      (v) => Math.abs(v) < 89 && onTransform.params({ skewX: v / DEG }),
    ],
    [
      'V',
      'Vertical skew',
      tenth(p.skewY * DEG),
      '°',
      (v) => Math.abs(v) < 89 && onTransform.params({ skewY: v / DEG }),
    ],
  ];
  return (
    <>
      {fields.map(([label, name, value, unit, set]) => (
        <label key={name} className="flex items-center gap-1" title={name}>
          <span className="text-ui-muted">{label}</span>
          <input
            type="number"
            aria-label={name}
            step={unit === 'px' ? 1 : 0.1}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(v)) set(v);
            }}
            // As in Photoshop: Enter confirms the field (press it again to apply), Esc cancels the transform.
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') onTransform.cancel();
            }}
            className="bg-ui-bg border-ui-border w-16 rounded border px-1 py-0.5 tabular-nums"
          />
          <span className="text-ui-muted">{unit}</span>
        </label>
      ))}
      <Button title="Flip horizontally" onClick={() => onTransform.params({ sx: -p.sx })}>
        ⇋ Flip H
      </Button>
      <Button title="Flip vertically" onClick={() => onTransform.params({ sy: -p.sy })}>
        ⇵ Flip V
      </Button>
      <Button className="ml-auto" title="Cancel the transform (Esc)" onClick={onTransform.cancel}>
        ✕ Cancel
      </Button>
      <Button variant="primary" title="Apply the transform (Enter)" onClick={onTransform.commit}>
        ✓ Apply
      </Button>
    </>
  );
}

const MODES: ReadonlyArray<readonly [SelectionOp, string, string]> = [
  ['replace', 'New', 'New selection'],
  ['add', 'Add', 'Add to selection (Shift)'],
  ['subtract', 'Subtract', 'Subtract from selection (Alt)'],
  ['intersect', 'Intersect', 'Intersect with selection (Shift+Alt)'],
];

/** Marquee options (FR-SEL-01/04): selection mode, shape, style with ratio or size, anti-alias. */
function MarqueeOptions({ options, onOptions }: { options: ToolOptions; onOptions: Props['onOptions'] }) {
  const o = options.marquee;
  const set = (patch: Partial<MarqueeOpts>) => onOptions('marquee', patch);
  const number = (label: string, key: 'ratioW' | 'ratioH' | 'width' | 'height', max: number) => (
    <label className="flex items-center gap-1">
      <span className="text-ui-muted">{label}</span>
      <input
        type="number"
        aria-label={label}
        min={1}
        max={max}
        value={o[key]}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (v >= 1 && v <= max) set({ [key]: v });
        }}
        className="bg-ui-bg border-ui-border w-16 rounded border px-1 py-0.5"
      />
    </label>
  );
  return (
    <>
      <div role="group" aria-label="Selection mode" className="flex gap-0.5">
        {MODES.map(([mode, text, title]) => (
          <Button
            key={mode}
            aria-pressed={o.mode === mode}
            active={o.mode === mode}
            title={title}
            onClick={() => set({ mode })}
          >
            {text}
          </Button>
        ))}
      </div>
      <Select
        label="Shape"
        value={o.shape}
        options={[
          ['rect', 'Rectangle'],
          ['ellipse', 'Ellipse'],
        ]}
        onChange={(shape) => set({ shape })}
      />
      <Select
        label="Style"
        value={o.style}
        options={[
          ['normal', 'Normal'],
          ['ratio', 'Fixed ratio'],
          ['size', 'Fixed size'],
        ]}
        onChange={(style) => set({ style })}
      />
      {o.style === 'ratio' && (
        <>
          {number('Ratio width', 'ratioW', 1000)}
          {number('Ratio height', 'ratioH', 1000)}
        </>
      )}
      {o.style === 'size' && (
        <>
          {number('Fixed width', 'width', 20_000)}
          {number('Fixed height', 'height', 20_000)}
        </>
      )}
      {o.shape === 'ellipse' && (
        <Toggle
          label="Anti-alias"
          title="Smooth the ellipse's edge"
          checked={o.antiAlias}
          onChange={(antiAlias) => set({ antiAlias })}
        />
      )}
    </>
  );
}

/** Lasso options (FR-SEL-02): kind, selection mode, anti-alias. */
function LassoOptions({ options, onOptions }: { options: ToolOptions; onOptions: Props['onOptions'] }) {
  const o = options.lasso;
  return (
    <>
      <div role="group" aria-label="Selection mode" className="flex gap-0.5">
        {MODES.map(([mode, text, title]) => (
          <Button
            key={mode}
            aria-pressed={o.mode === mode}
            active={o.mode === mode}
            title={title}
            onClick={() => onOptions('lasso', { mode })}
          >
            {text}
          </Button>
        ))}
      </div>
      <Select
        label="Kind"
        value={o.kind}
        options={[
          ['freehand', 'Freehand'],
          ['polygon', 'Polygonal'],
        ]}
        onChange={(kind) => onOptions('lasso', { kind })}
      />
      <Toggle
        label="Anti-alias"
        title="Smooth the selection's edge"
        checked={o.antiAlias}
        onChange={(antiAlias) => onOptions('lasso', { antiAlias })}
      />
      {o.kind === 'polygon' && (
        <span className="text-ui-muted">
          Click to add points · Enter or double-click to close · Esc to cancel
        </span>
      )}
    </>
  );
}

/** Magic Wand options (FR-SEL-03): mode, tolerance, contiguous, anti-alias, sample all layers. */
function WandOptions({ options, onOptions }: { options: ToolOptions; onOptions: Props['onOptions'] }) {
  const o = options.wand;
  return (
    <>
      <div role="group" aria-label="Selection mode" className="flex gap-0.5">
        {MODES.map(([mode, text, title]) => (
          <Button
            key={mode}
            aria-pressed={o.mode === mode}
            active={o.mode === mode}
            title={title}
            onClick={() => onOptions('wand', { mode })}
          >
            {text}
          </Button>
        ))}
      </div>
      <RegionOptions tool="wand" options={options} onOptions={onOptions} />
    </>
  );
}

/** Common families; any installed font can be typed (the font list arrives with Local Font Access). */
const FONT_SUGGESTIONS = [
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'Arial',
  'Helvetica',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Noto Sans',
  'Noto Serif',
  'Roboto',
  'DejaVu Sans',
  'Segoe UI',
];

const ALIGNS: ReadonlyArray<readonly [ToolOptions['text']['align'], string, string]> = [
  ['left', '⯇', 'Align left'],
  ['center', '≡', 'Centre'],
  ['right', '⯈', 'Align right'],
  ['justify', '☰', 'Justify'],
];

/** Type tool options (FR-TXT-02): font, style, size, colour, alignment, spacing, decoration. */
function TextOptions({
  options,
  onOptions,
  onEditColor,
}: {
  options: ToolOptions;
  onOptions: Props['onOptions'];
  onEditColor: () => void;
}) {
  const o = options.text;
  const set = (patch: Partial<ToolOptions['text']>) => onOptions('text', patch);
  const [r, g, b] = o.color;
  return (
    <>
      <label className="flex items-center gap-1">
        <span className="text-ui-muted">Font</span>
        <input
          aria-label="Font"
          list="font-suggestions"
          value={o.family}
          onChange={(e) => e.target.value.trim() && set({ family: e.target.value })}
          className="bg-ui-bg border-ui-border w-36 rounded border px-1 py-0.5"
        />
        <datalist id="font-suggestions">
          {FONT_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <Select
        label="Weight"
        value={o.weight}
        options={[
          [300, 'Light'],
          [400, 'Regular'],
          [500, 'Medium'],
          [700, 'Bold'],
          [900, 'Black'],
        ]}
        onChange={(weight) => set({ weight })}
      />
      <Toggle label="I" title="Italic" checked={o.italic} onChange={(italic) => set({ italic })} />
      <label className="flex items-center gap-1">
        <span className="text-ui-muted">Size</span>
        <input
          type="number"
          aria-label="Font size"
          min={1}
          max={2500}
          value={o.size}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 1 && v <= 2500) set({ size: v });
          }}
          className="bg-ui-bg border-ui-border w-16 rounded border px-1 py-0.5"
        />
        <span className="text-ui-muted">px</span>
      </label>
      <button
        aria-label={`Text colour rgb(${r}, ${g}, ${b})`}
        title="Text colour"
        className="border-ui-border h-5 w-5 rounded border"
        style={{ background: `rgb(${r}, ${g}, ${b})` }}
        onClick={onEditColor}
      />
      <div role="group" aria-label="Alignment" className="flex gap-0.5">
        {ALIGNS.map(([align, icon, title]) => (
          <Button
            key={align}
            aria-pressed={o.align === align}
            active={o.align === align}
            aria-label={title}
            title={title}
            onClick={() => set({ align })}
          >
            {icon}
          </Button>
        ))}
      </div>
      <label className="flex items-center gap-1">
        <span className="text-ui-muted">Spacing</span>
        <input
          type="number"
          aria-label="Letter spacing"
          step={0.5}
          value={o.letterSpacing}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= -1000 && v <= 1000) set({ letterSpacing: v });
          }}
          className="bg-ui-bg border-ui-border w-14 rounded border px-1 py-0.5"
        />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-ui-muted">Line</span>
        <input
          type="number"
          aria-label="Line height"
          step={0.1}
          min={0.5}
          max={5}
          value={o.lineHeight}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 0.5 && v <= 5) set({ lineHeight: v });
          }}
          className="bg-ui-bg border-ui-border w-14 rounded border px-1 py-0.5"
        />
      </label>
      <Toggle
        label="U"
        title="Underline"
        checked={o.underline}
        onChange={(underline) => set({ underline })}
      />
      <Toggle label="S" title="Strikethrough" checked={o.strike} onChange={(strike) => set({ strike })} />
    </>
  );
}

const GRADIENT_TYPE_BUTTONS: ReadonlyArray<readonly [GradientType, string, string]> = [
  ['linear', '▭', 'Linear gradient'],
  ['radial', '◎', 'Radial gradient'],
  ['angle', '◔', 'Angle gradient'],
  ['reflected', '⇔', 'Reflected gradient'],
  ['diamond', '◇', 'Diamond gradient'],
];

/** Gradient options (FR-PNT-04): colours, type, mode, opacity, reverse, dither. */
function GradientOptions({ options, onOptions }: { options: ToolOptions; onOptions: Props['onOptions'] }) {
  const o = options.gradient;
  return (
    <>
      <Select
        label="Colours"
        value={o.preset}
        options={Object.entries(GRADIENT_PRESET_LABELS) as Array<[GradientPreset, string]>}
        onChange={(preset) => onOptions('gradient', { preset })}
      />
      <div role="group" aria-label="Gradient type" className="flex gap-0.5">
        {GRADIENT_TYPE_BUTTONS.map(([type, icon, title]) => (
          <Button
            key={type}
            aria-pressed={o.type === type}
            active={o.type === type}
            aria-label={title}
            title={title}
            onClick={() => onOptions('gradient', { type })}
          >
            {icon}
          </Button>
        ))}
      </div>
      <Select
        label="Mode"
        value={o.mode}
        options={IMPLEMENTED_BLEND_MODES.map((m) => [m, BLEND_MODE_LABELS[m]] as const)}
        onChange={(mode) => onOptions('gradient', { mode })}
      />
      <Slider
        label="Opacity"
        value={Math.round(o.opacity * 100)}
        min={1}
        max={100}
        unit="%"
        onChange={(v) => onOptions('gradient', { opacity: v / 100 })}
      />
      <Toggle
        label="Reverse"
        title="Swap the gradient's colours"
        checked={o.reverse}
        onChange={(reverse) => onOptions('gradient', { reverse })}
      />
      <Toggle
        label="Dither"
        title="Smooth the banding of slow gradients"
        checked={o.dither}
        onChange={(dither) => onOptions('gradient', { dither })}
      />
    </>
  );
}

/**
 * The region of similar colour around a click: tolerance, contiguous, anti-alias, sample all layers. The
 * Magic Wand selects it (FR-SEL-03); the Paint Bucket fills it (FR-PNT-03).
 */
function RegionOptions({
  tool,
  options,
  onOptions,
}: {
  tool: 'wand' | 'bucket';
  options: ToolOptions;
  onOptions: Props['onOptions'];
}) {
  const o = options[tool];
  const set = (patch: Partial<ToolOptions['bucket']>) =>
    tool === 'wand' ? onOptions('wand', patch) : onOptions('bucket', patch);
  return (
    <>
      <label className="flex items-center gap-1">
        <span className="text-ui-muted">Tolerance</span>
        <input
          type="number"
          aria-label="Tolerance"
          min={0}
          max={255}
          value={o.tolerance}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value));
            if (v >= 0 && v <= 255) set({ tolerance: v });
          }}
          className="bg-ui-bg border-ui-border w-14 rounded border px-1 py-0.5"
        />
      </label>
      <Toggle
        label="Contiguous"
        title="Only the connected area around the click"
        checked={o.contiguous}
        onChange={(contiguous) => set({ contiguous })}
      />
      <Toggle
        label="Anti-alias"
        title={tool === 'wand' ? "Smooth the selection's edge" : "Smooth the filled area's edge"}
        checked={o.antiAlias}
        onChange={(antiAlias) => set({ antiAlias })}
      />
      <Toggle
        label="Sample all layers"
        title="Pick colours from the whole image, not just the active layer"
        checked={o.sampleAll}
        onChange={(sampleAll) => set({ sampleAll })}
      />
    </>
  );
}

export function OptionsBar({
  tool,
  options,
  zoom,
  onOptions,
  onResetTool,
  onAlign,
  crop,
  onCrop,
  onFit,
  onActualSize,
  onEditTextColor,
  transform,
  onTransform,
}: Props) {
  const resettable = tool === 'hand' || tool === 'zoom' ? null : tool;
  if (transform)
    return (
      <div
        role="toolbar"
        aria-label="Tool options"
        className="bg-ui-panel border-ui-border flex h-9 items-center gap-3 overflow-x-auto border-b px-3 whitespace-nowrap [scrollbar-width:thin]"
      >
        <span className="font-semibold">Free Transform</span>
        <TransformOptions transform={transform} onTransform={onTransform} />
      </div>
    );
  return (
    <div
      role="toolbar"
      aria-label="Tool options"
      className="bg-ui-panel border-ui-border flex h-9 items-center gap-3 overflow-x-auto border-b px-3 whitespace-nowrap [scrollbar-width:thin]"
    >
      <span className="font-semibold">{TOOL_NAMES[tool]}</span>
      {isPaintTool(tool) && <PaintOptions tool={tool} options={options} onOptions={onOptions} />}
      {tool === 'crop' && <CropOptions options={options} crop={crop} onOptions={onOptions} onCrop={onCrop} />}
      {tool === 'marquee' && <MarqueeOptions options={options} onOptions={onOptions} />}
      {tool === 'lasso' && <LassoOptions options={options} onOptions={onOptions} />}
      {tool === 'wand' && <WandOptions options={options} onOptions={onOptions} />}
      {tool === 'bucket' && <RegionOptions tool="bucket" options={options} onOptions={onOptions} />}
      {tool === 'gradient' && <GradientOptions options={options} onOptions={onOptions} />}
      {tool === 'text' && (
        <TextOptions
          options={options}
          onOptions={onOptions}
          onEditColor={onEditTextColor ?? (() => undefined)}
        />
      )}
      {tool === 'clone' && (
        <>
          <PaintOptions tool="clone" options={options} onOptions={onOptions} />
          <Toggle
            label="Aligned"
            title="Keep the distance to the source between strokes"
            checked={options.clone.aligned}
            onChange={(aligned) => onOptions('clone', { aligned })}
          />
          <Toggle
            label="Sample all layers"
            title="Clone from the whole image, not just the active layer"
            checked={options.clone.sampleAll}
            onChange={(sampleAll) => onOptions('clone', { sampleAll })}
          />
          <span className="text-ui-muted">Alt-click to set the source</span>
        </>
      )}
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
