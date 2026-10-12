import { useEffect, useRef, type RefObject } from 'react';

/**
 * Brush outline at the actual brush size (docs/03 §4 cursor conventions). Follows the pointer by writing
 * the transform directly, so pointer moves never re-render React. Below 4 screen px the host shows a
 * crosshair instead (`diameter` is 0 then).
 */
export function BrushCursor({ host, diameter }: { host: RefObject<HTMLElement | null>; diameter: number }) {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    const r = ring.current;
    if (!el || !r) return;
    const move = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      r.style.transform = `translate(${e.clientX - box.left - diameter / 2}px, ${e.clientY - box.top - diameter / 2}px)`;
      r.style.visibility = 'visible';
    };
    const hide = () => (r.style.visibility = 'hidden');
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', hide);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', hide);
    };
  }, [host, diameter]);
  if (diameter <= 0) return null;
  return (
    <div
      ref={ring}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 rounded-full border border-white mix-blend-difference"
      style={{ width: diameter, height: diameter, visibility: 'hidden' }}
    />
  );
}
