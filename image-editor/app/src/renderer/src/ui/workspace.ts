import { PANEL_IDS, type PanelId, type PanelState, type Settings } from '@shared/settings';

/**
 * Workspaces (FR-GEN-01, docs/03 §3): the right-hand dock's panels, their order, which are shown and
 * expanded, and how the height is shared. Pure functions over the saved layout, so they are unit-tested;
 * the dock component only renders and calls them.
 */
export type Workspace = Settings['workspace'];
export type Preset = Exclude<Workspace['preset'], 'custom'>;

export const PANEL_TITLES: Record<PanelId, string> = {
  layers: 'Layers',
  swatches: 'Swatches',
  history: 'History',
};

/**
 * Presets. Essentials keeps everything at hand; Photography gives Layers and History the room and starts
 * with Swatches collapsed. (Its Histogram, Navigator and Adjustments panels arrive with those features, M2.)
 */
export const PRESETS: Record<Preset, PanelState[]> = {
  essentials: [
    { id: 'layers', visible: true, open: true, size: 2 },
    { id: 'swatches', visible: true, open: true, size: 0.6 },
    { id: 'history', visible: true, open: true, size: 1 },
  ],
  photography: [
    { id: 'layers', visible: true, open: true, size: 3 },
    { id: 'history', visible: true, open: true, size: 1.5 },
    { id: 'swatches', visible: true, open: false, size: 0.6 },
  ],
};

/** The layout in effect: the saved one (repaired: every panel exactly once) or the preset's. */
export function panelsOf(ws: Workspace): PanelState[] {
  const base = ws.panels ?? PRESETS[ws.preset === 'custom' ? 'essentials' : ws.preset];
  const seen = new Set<PanelId>();
  const out = base.filter((p) => !seen.has(p.id) && seen.add(p.id));
  for (const id of PANEL_IDS)
    if (!seen.has(id)) out.push({ ...PRESETS.essentials.find((p) => p.id === id)! });
  return out;
}

/** Any change makes the layout custom. */
const custom = (ws: Workspace, panels: PanelState[]): Workspace => ({ ...ws, preset: 'custom', panels });

const update = (ws: Workspace, id: PanelId, patch: Partial<PanelState>): Workspace =>
  custom(
    ws,
    panelsOf(ws).map((p) => (p.id === id ? { ...p, ...patch } : p)),
  );

export const toggleOpen = (ws: Workspace, id: PanelId) =>
  update(ws, id, { open: !panelsOf(ws).find((p) => p.id === id)!.open });

/** Window › <panel>: show or hide it (a shown panel is also expanded). */
export const toggleVisible = (ws: Workspace, id: PanelId) => {
  const p = panelsOf(ws).find((x) => x.id === id)!;
  return update(ws, id, p.visible ? { visible: false } : { visible: true, open: true });
};

/** Moves a panel to `index` in the dock order (drag and drop, Alt+Arrow keys). */
export function movePanel(ws: Workspace, id: PanelId, index: number): Workspace {
  const panels = panelsOf(ws);
  const from = panels.findIndex((p) => p.id === id);
  const [moved] = panels.splice(from, 1);
  panels.splice(Math.max(0, Math.min(index, panels.length)), 0, moved!);
  return custom(ws, panels);
}

/**
 * Dragging the splitter below panel `id` by `dy` px, in a dock whose open panels share `available` px:
 * moves height from the next open panel to this one (or back), keeping both above a minimum.
 */
export function resizePanel(ws: Workspace, id: PanelId, dy: number, available: number): Workspace {
  const panels = panelsOf(ws);
  const open = panels.filter((p) => p.visible && p.open);
  const i = open.findIndex((p) => p.id === id);
  const next = open[i + 1];
  if (i < 0 || !next || available <= 0) return ws;
  const total = open.reduce((n, p) => n + p.size, 0);
  const pxPerUnit = available / total;
  const a = open[i]!;
  const minUnits = 60 / pxPerUnit; // ~60 px minimum each
  const pair = a.size + next.size;
  const aSize = Math.min(pair - minUnits, Math.max(minUnits, a.size + dy / pxPerUnit));
  const sizes = new Map([
    [a.id, aSize],
    [next.id, pair - aSize],
  ]);
  const clamp = (v: number) => Math.min(10, Math.max(0.1, v));
  return custom(
    ws,
    panels.map((p) => (sizes.has(p.id) ? { ...p, size: clamp(sizes.get(p.id)!) } : p)),
  );
}

export const applyPreset = (ws: Workspace, preset: Preset): Workspace => ({ ...ws, preset, panels: null });

export const setWidth = (ws: Workspace, width: number): Workspace => ({
  ...ws,
  width: Math.round(Math.min(480, Math.max(200, width))),
});
