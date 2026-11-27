import { useSyncExternalStore } from 'react';
import type { Editor, EditorSnapshot } from '../../engine/editor';

type Props = {
  editor: Editor;
  selection: EditorSnapshot['selection'];
  marquee: EditorSnapshot['marquee'];
  lasso: EditorSnapshot['lasso'];
  gradientLine?: EditorSnapshot['gradientLine'];
  cloneSource?: EditorSnapshot['cloneSource'];
};

/** Black dashes over white, 1 screen px at any zoom (FR-SEL-06). */
function Ants({ children }: { children: (props: React.SVGProps<SVGElement>) => React.ReactNode }) {
  const common = { fill: 'none', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' } as const;
  return (
    <>
      {children({ ...common, stroke: '#fff' })}
      {children({ ...common, stroke: '#000', strokeDasharray: '4 4', className: 'marching-ants' })}
    </>
  );
}

/**
 * Marching ants around the selection and the marquee being dragged (docs/02 §5.4, FR-SEL-06). Drawn as SVG
 * in document pixels under the view transform, so the outline stays crisp at any zoom. The dashes stop
 * moving with prefers-reduced-motion (docs/03 §7). Display only: the editor handles input.
 */
export function SelectionOverlay({ editor, selection, marquee, lasso, gradientLine, cloneSource }: Props) {
  const { zoom, panX, panY } = useSyncExternalStore(editor.subscribeView, editor.getView);
  if (!selection && !marquee && !lasso && !gradientLine && !cloneSource) return null;
  // The Clone Stamp's source: a crosshair 8 screen px each way (FR-PNT-05).
  const arm = 8 / zoom;
  // The outline drawn so far; a polygon also shows the edge to the pointer.
  const lassoPoints = lasso ? [...lasso.points, ...(lasso.hover ? [lasso.hover] : [])] : [];
  const r = marquee?.rect;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <g transform={`translate(${panX} ${panY}) scale(${zoom})`}>
        {cloneSource && (
          <Ants>
            {(p) => (
              <path
                d={`M${cloneSource.x - arm} ${cloneSource.y}H${cloneSource.x + arm}M${cloneSource.x} ${cloneSource.y - arm}V${cloneSource.y + arm}`}
                {...(p as React.SVGProps<SVGPathElement>)}
              />
            )}
          </Ants>
        )}
        {gradientLine && (
          // The Gradient tool's drag (FR-PNT-04): from where the gradient starts to where it ends.
          <Ants>
            {(p) => (
              <line
                x1={gradientLine.start.x}
                y1={gradientLine.start.y}
                x2={gradientLine.end.x}
                y2={gradientLine.end.y}
                {...(p as React.SVGProps<SVGLineElement>)}
              />
            )}
          </Ants>
        )}
        {selection && (
          <Ants>{(p) => <path d={selection.outline} {...(p as React.SVGProps<SVGPathElement>)} />}</Ants>
        )}
        {marquee && r && marquee.shape === 'rect' && (
          <Ants>
            {(p) => (
              <rect
                x={r.x0}
                y={r.y0}
                width={r.x1 - r.x0}
                height={r.y1 - r.y0}
                {...(p as React.SVGProps<SVGRectElement>)}
              />
            )}
          </Ants>
        )}
        {marquee && r && marquee.shape === 'ellipse' && (
          <Ants>
            {(p) => (
              <ellipse
                cx={(r.x0 + r.x1) / 2}
                cy={(r.y0 + r.y1) / 2}
                rx={(r.x1 - r.x0) / 2}
                ry={(r.y1 - r.y0) / 2}
                {...(p as React.SVGProps<SVGEllipseElement>)}
              />
            )}
          </Ants>
        )}
        {lassoPoints.length > 1 && (
          <Ants>
            {(p) => (
              <polyline
                points={lassoPoints.map(([x, y]) => `${x},${y}`).join(' ')}
                {...(p as React.SVGProps<SVGPolylineElement>)}
              />
            )}
          </Ants>
        )}
      </g>
    </svg>
  );
}
