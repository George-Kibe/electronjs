import { contentBounds } from '../ops/canvas';
import { cloneTree, TreeCommand, type TreeEdit } from './commands';
import { createGroupLayer, walkLayers, type Document, type Layer } from './document';
import { movedRasters, translateMoves, type AlignEdge, type TranslateCommand } from './translate';

/**
 * Several selected layers at once (FR-LAY-08): move, align and distribute, group and delete. Each is one
 * command. A group and a layer inside it never both act: the group already covers its children.
 */

/** `ids` without layers whose group is also selected, in stacking order (bottom → top, depth first). */
export function topSelected(doc: Document, ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  const out: string[] = [];
  const visit = (layers: Layer[], covered: boolean) => {
    for (const l of layers) {
      const picked = !covered && wanted.has(l.id);
      if (picked) out.push(l.id);
      if (l.type === 'group') visit(l.children, covered || picked);
    }
  };
  visit(doc.layers, false);
  return out;
}

type Box = { id: string; x0: number; y0: number; x1: number; y1: number };

function boxes(doc: Document, ids: string[]): Box[] {
  return ids.flatMap((id) => {
    const b = contentBounds(movedRasters(doc, id).map((l) => l.tiles));
    return b ? [{ id, ...b }] : [];
  });
}

/** Align the selected layers to each other: to the edges or centre of their combined bounds (Photoshop). */
export function alignLayers(doc: Document, ids: Iterable<string>, edge: AlignEdge): TranslateCommand | null {
  const list = boxes(doc, topSelected(doc, ids));
  if (list.length < 2) return null;
  const u = {
    x0: Math.min(...list.map((b) => b.x0)),
    y0: Math.min(...list.map((b) => b.y0)),
    x1: Math.max(...list.map((b) => b.x1)),
    y1: Math.max(...list.map((b) => b.y1)),
  };
  const moves = list.map((b) => {
    switch (edge) {
      case 'left':
        return { id: b.id, dx: u.x0 - b.x0, dy: 0 };
      case 'right':
        return { id: b.id, dx: u.x1 - b.x1, dy: 0 };
      case 'hcenter':
        return { id: b.id, dx: Math.round((u.x0 + u.x1 - b.x0 - b.x1) / 2), dy: 0 };
      case 'top':
        return { id: b.id, dx: 0, dy: u.y0 - b.y0 };
      case 'bottom':
        return { id: b.id, dx: 0, dy: u.y1 - b.y1 };
      case 'vcenter':
        return { id: b.id, dx: 0, dy: Math.round((u.y0 + u.y1 - b.y0 - b.y1) / 2) };
    }
  });
  return translateMoves(doc, moves, 'Align');
}

/**
 * Distribute (3 or more layers): the outermost two stay, and the others move so the chosen edge or centre
 * is evenly spaced between them.
 */
export function distributeLayers(
  doc: Document,
  ids: Iterable<string>,
  edge: AlignEdge,
): TranslateCommand | null {
  const list = boxes(doc, topSelected(doc, ids));
  if (list.length < 3) return null;
  const horizontal = edge === 'left' || edge === 'hcenter' || edge === 'right';
  const at = (b: Box) =>
    edge === 'left'
      ? b.x0
      : edge === 'right'
        ? b.x1
        : edge === 'hcenter'
          ? (b.x0 + b.x1) / 2
          : edge === 'top'
            ? b.y0
            : edge === 'bottom'
              ? b.y1
              : (b.y0 + b.y1) / 2;
  const sorted = [...list].sort((a, b) => at(a) - at(b));
  const first = at(sorted[0]!);
  const step = (at(sorted.at(-1)!) - first) / (sorted.length - 1);
  const moves = sorted.map((b, i) => {
    const d = Math.round(first + i * step - at(b));
    return horizontal ? { id: b.id, dx: d, dy: 0 } : { id: b.id, dx: 0, dy: d };
  });
  return translateMoves(doc, moves, 'Distribute');
}

/**
 * Layer › Group Layers (Ctrl+G) with several selected: they move into one new group, keeping their order,
 * placed where the topmost of them was.
 */
export function groupLayers(doc: Document, ids: Iterable<string>): TreeCommand | null {
  const picked = topSelected(doc, ids);
  if (picked.length === 0) return null;
  return new TreeCommand('Group Layers', (d): TreeEdit => {
    const root = cloneTree(d.layers);
    const set = new Set(picked);
    const locs = [...walkLayers(root)].filter((l) => set.has(l.layer.id));
    const top = locs.at(-1)!;
    // The topmost's position after the others leave its container.
    const at = top.siblings.slice(0, top.index).filter((l) => !set.has(l.id)).length;
    const container = top.siblings;
    for (const loc of [...locs].reverse()) loc.siblings.splice(loc.siblings.indexOf(loc.layer), 1);
    const count = [...walkLayers(root)].filter((l) => l.layer.type === 'group').length;
    const group = createGroupLayer(
      `Group ${count + 1}`,
      locs.map((l) => l.layer),
    );
    container.splice(at, 0, group);
    return { root, activeLayerId: group.id };
  });
}

/** Delete with several selected (at least one layer must stay in the document). */
export function deleteLayers(doc: Document, ids: Iterable<string>): TreeCommand | null {
  const picked = topSelected(doc, ids).filter((id) => !doc.layer(id).locks.all);
  if (picked.length === 0) return null;
  const set = new Set(picked);
  if (doc.layers.every((l) => set.has(l.id))) return null;
  return new TreeCommand(picked.length > 1 ? 'Delete Layers' : 'Delete Layer', (d): TreeEdit => {
    const root = cloneTree(d.layers);
    const strip = (list: Layer[]): Layer[] =>
      list
        .filter((l) => !set.has(l.id))
        .map((l) => (l.type === 'group' ? { ...l, children: strip(l.children) } : l));
    const kept = strip(root);
    const remaining = [...walkLayers(kept)].map((l) => l.layer.id);
    return { root: kept, activeLayerId: remaining.at(-1)! };
  });
}
