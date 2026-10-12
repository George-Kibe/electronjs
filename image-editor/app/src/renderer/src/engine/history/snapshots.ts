import { TreeCommand, type CanvasGeometry } from '../doc/commands';
import type { Document, Layer } from '../doc/document';
import { TileGrid } from '../tiles/tile';

/**
 * History snapshots (FR-HIS-02, docs/02 §6): named document states that never expire with the step limit.
 * A snapshot shares the immutable tiles but owns copies of every layer object and tile map, because paint
 * commands update a layer's TileGrid in place. Restoring one is an ordinary undoable command, so going to
 * a snapshot never discards history.
 */
export type DocState = {
  layers: Layer[];
  activeLayerId: string;
  canvas: CanvasGeometry;
};

function copyLayer(l: Layer): Layer {
  if (l.type === 'group') return { ...l, locks: { ...l.locks }, children: l.children.map(copyLayer) };
  const tiles = new TileGrid();
  for (const [k, t] of l.tiles.entries()) tiles.set(k, t);
  return { ...l, locks: { ...l.locks }, tiles };
}

export function captureState(doc: Document): DocState {
  return {
    layers: doc.layers.map(copyLayer),
    activeLayerId: doc.activeLayerId,
    canvas: {
      width: doc.width,
      height: doc.height,
      guides: { horizontal: [...doc.meta.guides.horizontal], vertical: [...doc.meta.guides.vertical] },
    },
  };
}

/** A command that puts the document back into `state` (copied again, so the snapshot stays pristine). */
export function restoreState(state: DocState, label: string): TreeCommand {
  return new TreeCommand(label, () => {
    const copy = captureStateOf(state);
    return { root: copy.layers, activeLayerId: copy.activeLayerId, canvas: copy.canvas };
  });
}

function captureStateOf(state: DocState): DocState {
  return {
    layers: state.layers.map(copyLayer),
    activeLayerId: state.activeLayerId,
    canvas: {
      ...state.canvas,
      guides: {
        horizontal: [...state.canvas.guides.horizontal],
        vertical: [...state.canvas.guides.vertical],
      },
    },
  };
}

/** Distinct tile ids in a layer tree (memory accounting: shared tiles count once). */
export function collectTileIds(layers: readonly Layer[], into: Set<number>): Set<number> {
  for (const l of layers) {
    if (l.type === 'group') collectTileIds(l.children, into);
    else for (const [, t] of l.tiles.entries()) into.add(t.id);
  }
  return into;
}
