import { useSyncExternalStore } from 'react';
import type { Editor } from '../../engine/editor';

/**
 * View › Grid (FR-NAV-04): gridlines every `spacing` px with fainter subdivisions, over the visible part of
 * the canvas. Lines closer than a few screen px are left out. Display only.
 */
export function GridOverlay(props: {
  editor: Editor;
  doc: { width: number; height: number };
  spacing: number;
  subdivisions: number;
}) {
  const { zoom, panX, panY, width, height } = useSyncExternalStore(
    props.editor.subscribeView,
    props.editor.getView,
  );
  const { doc } = props;
  const step = props.spacing / props.subdivisions;
  const show = (s: number) => s * zoom >= 6;
  const left = Math.max(0, -panX / zoom);
  const top = Math.max(0, -panY / zoom);
  const right = Math.min(doc.width, (width - panX) / zoom);
  const bottom = Math.min(doc.height, (height - panY) / zoom);
  if (right <= left || bottom <= top) return null;
  const lines: Array<{ key: string; d: string; major: boolean }> = [];
  const each = (s: number, from: number, to: number, f: (v: number) => void) => {
    for (let v = Math.ceil(from / s) * s; v <= to; v += s) f(v);
  };
  const add = (s: number, major: boolean) => {
    if (!show(s)) return;
    each(s, left, right, (x) => {
      if (!major && Math.abs(x / props.spacing - Math.round(x / props.spacing)) < 1e-9) return;
      const sx = Math.round(x * zoom + panX) + 0.5;
      lines.push({
        key: `${major ? 'X' : 'x'}${x}`,
        major,
        d: `M${sx},${top * zoom + panY}V${bottom * zoom + panY}`,
      });
    });
    each(s, top, bottom, (y) => {
      if (!major && Math.abs(y / props.spacing - Math.round(y / props.spacing)) < 1e-9) return;
      const sy = Math.round(y * zoom + panY) + 0.5;
      lines.push({
        key: `${major ? 'Y' : 'y'}${y}`,
        major,
        d: `M${left * zoom + panX},${sy}H${right * zoom + panX}`,
      });
    });
  };
  add(props.spacing, true);
  if (props.subdivisions > 1) add(step, false);
  return (
    <svg aria-hidden data-testid="grid" className="pointer-events-none absolute inset-0 h-full w-full">
      {lines.map((l) => (
        <path
          key={l.key}
          d={l.d}
          stroke={l.major ? 'rgba(128,128,128,0.75)' : 'rgba(128,128,128,0.35)'}
          strokeDasharray={l.major ? undefined : '2 3'}
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
