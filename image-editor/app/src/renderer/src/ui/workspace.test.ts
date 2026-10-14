import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import {
  applyPreset,
  movePanel,
  panelsOf,
  resizePanel,
  setWidth,
  toggleOpen,
  toggleVisible,
} from './workspace';

const ws = DEFAULT_SETTINGS.workspace;
const ids = (w: typeof ws) => panelsOf(w).map((p) => p.id);

describe('workspace (FR-GEN-01)', () => {
  it('starts with the Essentials preset', () => {
    expect(ws.preset).toBe('essentials');
    expect(ids(ws)).toEqual(['layers', 'swatches', 'history']);
  });

  it('collapses, hides and reorders panels, which makes the layout custom', () => {
    let w = toggleOpen(ws, 'swatches');
    expect(w.preset).toBe('custom');
    expect(panelsOf(w).find((p) => p.id === 'swatches')!.open).toBe(false);
    w = toggleVisible(w, 'history');
    expect(panelsOf(w).find((p) => p.id === 'history')!.visible).toBe(false);
    w = toggleVisible(w, 'swatches'); // hiding…
    w = toggleVisible(w, 'swatches'); // …and showing again expands it
    expect(panelsOf(w).find((p) => p.id === 'swatches')).toMatchObject({ visible: true, open: true });
    w = movePanel(w, 'history', 0);
    expect(ids(w)).toEqual(['history', 'layers', 'swatches']);
    w = movePanel(w, 'history', 99);
    expect(ids(w)).toEqual(['layers', 'swatches', 'history']);
  });

  it('resizing moves height between neighbours and respects a minimum', () => {
    const w = resizePanel(ws, 'layers', 100, 600);
    const [layers, swatches] = panelsOf(w);
    expect(layers!.size).toBeGreaterThan(2);
    expect(layers!.size + swatches!.size).toBeCloseTo(2.6);
    const squeezed = panelsOf(resizePanel(ws, 'layers', 10_000, 600));
    expect(squeezed[1]!.size * (600 / 3.6)).toBeGreaterThanOrEqual(59.9);
    expect(resizePanel(ws, 'history', 50, 600)).toBe(ws); // no open panel below
  });

  it('presets and reset replace the layout; damaged layouts are repaired', () => {
    const w = applyPreset(toggleOpen(ws, 'layers'), 'photography');
    expect(w.preset).toBe('photography');
    expect(ids(w)).toEqual(['layers', 'history', 'swatches']);
    expect(panelsOf(applyPreset(w, 'essentials'))).toEqual(panelsOf(ws));
    const broken = { ...ws, panels: [{ id: 'history' as const, visible: true, open: true, size: 1 }] };
    expect(ids(broken)).toEqual(['history', 'layers', 'swatches']);
    expect(setWidth(ws, 999).width).toBe(480);
  });
});
