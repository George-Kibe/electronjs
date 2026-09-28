import { TileGrid } from '../tiles/tile';

export type BlendMode = 'normal';

export type RasterLayer = {
  readonly id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
  readonly tiles: TileGrid;
};

let layerSeq = 1;

export function createRasterLayer(name: string, tiles = new TileGrid()): RasterLayer {
  return { id: `L${layerSeq++}`, name, visible: true, opacity: 1, blendMode: 'normal', tiles };
}

/**
 * Document model (docs/05 §1), M0 subset: a flat stack of raster layers (bottom → top). Mutated only by
 * Commands (engine/doc/commands.ts).
 */
export class Document {
  readonly layers: RasterLayer[] = [];
  activeLayerId: string;

  constructor(
    readonly width: number,
    readonly height: number,
    background: RasterLayer,
    readonly meta: { name: string; sourceProfile: string | null } = { name: 'Untitled', sourceProfile: null },
  ) {
    this.layers.push(background);
    this.activeLayerId = background.id;
  }

  layer(id: string): RasterLayer {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) throw new Error(`No layer ${id}`);
    return layer;
  }

  get activeLayer(): RasterLayer {
    return this.layer(this.activeLayerId);
  }

  indexOf(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }

  /** Composites all visible layers at one pixel (CPU reference for tests; normal blend, straight alpha). */
  compositePixel(x: number, y: number): [number, number, number, number] {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0; // premultiplied accumulation
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      const [lr, lg, lb, la] = layer.tiles.pixel(x, y);
      const sa = (la / 255) * layer.opacity;
      r = (lr / 255) * sa + r * (1 - sa);
      g = (lg / 255) * sa + g * (1 - sa);
      b = (lb / 255) * sa + b * (1 - sa);
      a = sa + a * (1 - sa);
    }
    if (a === 0) return [0, 0, 0, 0];
    return [
      Math.round((r / a) * 255),
      Math.round((g / a) * 255),
      Math.round((b / a) * 255),
      Math.round(a * 255),
    ];
  }
}
