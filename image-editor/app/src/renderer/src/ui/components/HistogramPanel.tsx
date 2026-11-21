import { useEffect, useState } from 'react';
import type { Editor, EditorSnapshot, HistogramSource } from '../../engine/editor';
import { stats, type Histogram } from '../../engine/ops/histogram';

export type HistogramChannel = 'rgb' | 'l' | 'r' | 'g' | 'b';

const CHANNEL_LABELS: Record<HistogramChannel, string> = {
  rgb: 'RGB',
  l: 'Luminosity',
  r: 'Red',
  g: 'Green',
  b: 'Blue',
};

const COLORS: Record<HistogramChannel, string> = {
  rgb: 'currentColor',
  l: 'currentColor',
  r: '#e5484d',
  g: '#30a46c',
  b: '#3e63dd',
};

/**
 * The histogram of `source`, recomputed in the ops worker a moment after the document (or the source)
 * changes; null until the first result, and never computed for a null source.
 */
export function useHistogram(
  editor: Editor,
  snap: EditorSnapshot,
  source: HistogramSource | null,
): Histogram | null {
  const [hist, setHist] = useState<Histogram | null>(null);
  const sourceKey = source === null ? 'none' : typeof source === 'string' ? source : `below:${source.below}`;
  const key = `${snap.doc?.id}|${snap.docVersion}|${sourceKey}|${snap.activeLayerId}|${snap.selection?.outline.length ?? 0}`;
  useEffect(() => {
    let live = true;
    if (source === null) return;
    const timer = window.setTimeout(() => {
      void editor.histogram(source).then((h) => {
        if (live && h) setHist(h);
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `key` covers `source` and every document change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- source is folded into key
  }, [editor, key]);
  return hist;
}

/** One channel's counts as an area graph (or the three colour channels over one another for RGB). */
export function HistogramGraph(props: {
  histogram: Histogram | null;
  channel: HistogramChannel;
  height?: number;
}) {
  const { histogram: h, channel } = props;
  const height = props.height ?? 80;
  const series = !h
    ? []
    : channel === 'rgb'
      ? (['r', 'g', 'b'] as const).map((c) => ({ c, bins: h[c] }))
      : [{ c: channel, bins: h[channel] }];
  // Scale to the second-largest bin so one spike (a flat background) does not flatten the rest.
  const all = series.flatMap((s) => [...s.bins]).sort((a, b) => b - a);
  const top = Math.max(1, all[1] ?? all[0] ?? 1);
  const path = (bins: Uint32Array) =>
    `M0,${height} ` +
    [...bins].map((n, v) => `L${v},${height - Math.min(1, n / top) * height}`).join(' ') +
    ` L255,${height} Z`;
  return (
    <svg
      role="img"
      aria-label={`${CHANNEL_LABELS[channel]} histogram`}
      viewBox={`0 0 256 ${height}`}
      preserveAspectRatio="none"
      className="bg-ui-bg border-ui-border h-20 w-full rounded border"
    >
      {series.map(({ c, bins }) => (
        <path
          key={c}
          d={path(bins)}
          fill={channel === 'rgb' ? COLORS[c] : 'currentColor'}
          fillOpacity={channel === 'rgb' ? 0.45 : 0.7}
          style={channel === 'rgb' ? { mixBlendMode: 'screen' } : undefined}
        />
      ))}
    </svg>
  );
}

/** Histogram panel (FR-ADJ-03): RGB, luminosity or one channel, of the image or the active layer. */
export function HistogramPanel({ editor, snap }: { editor: Editor; snap: EditorSnapshot }) {
  const [channel, setChannel] = useState<HistogramChannel>('rgb');
  const [source, setSource] = useState<'image' | 'layer'>('image');
  const hist = useHistogram(editor, snap, source);
  const bins = !hist ? null : channel === 'rgb' ? pooled(hist) : hist[channel];
  const s = bins ? stats(bins) : null;
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex gap-2">
        <select
          aria-label="Histogram channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as HistogramChannel)}
          className="bg-ui-bg border-ui-border rounded border px-1 py-0.5"
        >
          {(Object.keys(CHANNEL_LABELS) as HistogramChannel[]).map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABELS[c]}
            </option>
          ))}
        </select>
        <select
          aria-label="Histogram source"
          value={source}
          onChange={(e) => setSource(e.target.value as 'image' | 'layer')}
          className="bg-ui-bg border-ui-border rounded border px-1 py-0.5"
        >
          <option value="image">Entire image</option>
          <option value="layer">Selected layer</option>
        </select>
      </div>
      <HistogramGraph histogram={hist} channel={channel} />
      {s && (
        <dl className="text-ui-muted grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 text-xs tabular-nums">
          <dt>Mean</dt>
          <dd aria-label="Mean">{s.mean.toFixed(2)}</dd>
          <dt>Std Dev</dt>
          <dd aria-label="Std Dev">{s.stdDev.toFixed(2)}</dd>
          <dt>Median</dt>
          <dd aria-label="Median">{s.median}</dd>
          <dt>Pixels</dt>
          <dd aria-label="Pixels">{hist!.count}</dd>
        </dl>
      )}
    </div>
  );
}

/** RGB: the three channels' counts together (the composite histogram Photoshop shows for RGB). */
function pooled(h: Histogram): Uint32Array {
  const out = new Uint32Array(256);
  for (let v = 0; v < 256; v++) out[v] = (h.r[v]! + h.g[v]! + h.b[v]!) / 3;
  return out;
}
