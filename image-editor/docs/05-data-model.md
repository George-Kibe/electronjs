# 05 — Data Model & `.iep` Project Format: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Source of truth | `app/src/shared/iep-schema.ts`, `app/src/renderer/src/engine/doc/**` |

## 1. In-memory document model

```ts
type BlendMode = 'normal'|'dissolve'|'darken'|'multiply'|'color-burn'|'lighten'|'screen'|'color-dodge'
  |'linear-dodge'|'overlay'|'soft-light'|'hard-light'|'difference'|'exclusion'|'hue'|'saturation'|'color'|'luminosity';

interface Document {
  id: string; name: string; fileRef?: FileRef; format?: 'iep'|'psd'|'png'|'jpeg'|...;
  width: number; height: number; ppi: number;
  colorSpace: 'sRGB';                          // working space (ADR-0004)
  root: GroupLayer;                            // layer tree root (not shown)
  activeLayerId: string; selectedLayerIds: string[];
  selection: Mask | null;
  guides: { horizontal: number[]; vertical: number[] };
  meta: { exif?: ExifSummary; sourceProfile?: string; createdAt: number; modifiedAt: number };
}

interface LayerBase {
  id: string; name: string; visible: boolean;
  opacity: number;        // 0..1
  fillOpacity: number;    // 0..1 (affects content, not layer styles)
  blendMode: BlendMode;
  locks: { all: boolean; pixels: boolean; position: boolean; transparency: boolean };
  mask?: Mask; clipped: boolean; styles?: LayerStyles;
}

interface RasterLayer extends LayerBase { type: 'raster'; tiles: TileGrid; }         // tile grid in document coordinates
interface GroupLayer  extends LayerBase { type: 'group'; children: Layer[]; passThrough: boolean; collapsed: boolean; }
interface AdjustmentLayer extends LayerBase { type: 'adjustment'; adjustment: Adjustment; }
interface TextLayer   extends LayerBase { type: 'text'; text: TextModel; transform: Mat3; cache: TileGrid; }
interface ShapeLayer  extends LayerBase { type: 'shape'; shape: ShapeModel; transform: Mat3; cache: TileGrid; }

interface Mask { tiles: TileGrid /* 1 channel */; defaultValue: 0 | 255; enabled: boolean; linked: boolean; }

type Adjustment =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; legacy: boolean }
  | { kind: 'levels'; channels: Record<'rgb'|'r'|'g'|'b', { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }> }
  | { kind: 'curves'; channels: Record<'rgb'|'r'|'g'|'b', Array<[number, number]>> }  // control points 0..255
  | { kind: 'exposure'; exposure: number; offset: number; gamma: number }
  | { kind: 'vibrance'; vibrance: number; saturation: number }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number; colorize: boolean }
  | { kind: 'color-balance'; shadows: RGB; midtones: RGB; highlights: RGB; preserveLuminosity: boolean }
  | { kind: 'black-white'; weights: { r: number; y: number; g: number; c: number; b: number; m: number }; tint?: RGB }
  | { kind: 'photo-filter'; color: RGB; density: number; preserveLuminosity: boolean }
  | { kind: 'invert' } | { kind: 'posterize'; levels: number } | { kind: 'threshold'; level: number };

interface TextModel {
  mode: 'point' | 'box'; box?: { w: number; h: number };
  paragraphs: Array<{ align: 'left'|'center'|'right'|'justify'; lineHeight: number;
    runs: Array<{ text: string; font: { family: string; postscriptName?: string; weight: number; style: 'normal'|'italic' };
                  size: number; color: RGBA; letterSpacing: number; underline: boolean; strike: boolean }> }>;
}

interface ShapeModel {
  kind: 'rect'|'rounded-rect'|'ellipse'|'line'|'polygon'|'star';
  params: Record<string, number>;            // w, h, radius, sides, innerRadius, arrow heads...
  fill: { type: 'none'|'solid'; color?: RGBA };
  stroke: { color: RGBA; width: number; align: 'inside'|'center'|'outside'; dash?: number[] } | null;
}
```

### 1.1 Tiles

```ts
type TileKey = `${number},${number}`;                 // tx,ty (tile coordinates, 256 px)
type Tile = { readonly id: number; readonly data: Uint8Array /* 256*256*C */; readonly channels: 1 | 4 };
type TileEntry = Tile | { uniform: number /* packed RGBA or A */ };
interface TileGrid { channels: 1 | 4; entries: Map<TileKey, TileEntry>; bounds(): Rect }
```

Tiles are immutable and reference-counted by the TilePool (live document + history), which frees them at
refcount 0. Uniform tiles cost about 16 bytes.

## 2. `.iep` project format (v1)

A ZIP container ([ADR-0007](adr/0007-native-project-format-iep.md)), with `mimetype` as the first entry,
stored uncompressed (the ODF/EPUB convention, so tools can sniff the type).

```
project.iep (zip)
├── mimetype                       "application/x-imageeditor-project"   (stored, first)
├── manifest.json                  document + layer tree (below)
├── preview.png                    flattened, max 1024 px (thumbnails, Quick Look, recent files)
├── layers/<layerId>/tiles.bin     raster/text/shape cache tiles (see tile encoding)
├── masks/<layerId>/tiles.bin      mask tiles (1 channel)
├── selection/tiles.bin            optional saved selection
└── fonts.json                     fonts referenced by text layers (family/postscript names; fonts are NOT embedded)
```

### 2.1 `manifest.json`

```json
{
  "format": "iep",
  "version": 1,
  "app": { "name": "ImageEditor", "version": "1.0.0" },
  "document": { "width": 6000, "height": 4000, "ppi": 300, "colorSpace": "sRGB",
                "guides": { "horizontal": [], "vertical": [2000] }, "activeLayerId": "L3" },
  "layers": [
    { "id": "L1", "type": "raster", "name": "Background", "visible": true, "opacity": 1, "fillOpacity": 1,
      "blendMode": "normal", "locks": { "all": false, "pixels": false, "position": true, "transparency": false },
      "clipped": false, "tiles": "layers/L1/tiles.bin" },
    { "id": "L2", "type": "adjustment", "name": "Levels 1", "adjustment": { "kind": "levels", "channels": { "rgb": { "inBlack": 12, "inWhite": 240, "gamma": 1.1, "outBlack": 0, "outWhite": 255 } } },
      "mask": { "defaultValue": 255, "enabled": true, "linked": true, "tiles": "masks/L2/tiles.bin" } },
    { "id": "L3", "type": "text", "name": "Sale", "text": { "mode": "point", "paragraphs": [] }, "transform": [1,0,0,0,1,0,0,0,1],
      "cache": "layers/L3/tiles.bin" },
    { "id": "G1", "type": "group", "name": "Group", "passThrough": true, "children": [] }
  ]
}
```

Layers are listed bottom → top. Groups nest their children. `document` may also carry `name`,
`sourceProfile` and `exif` (a path to `meta/exif.bin`, the source image's raw EXIF, kept for the export
metadata policy). Tile paths are derived from the raster layer's depth-first position
(`layers/<n>/tiles.bin`), never from its id, because ids come from files. Groups (`type: "group"`) carry
`passThrough`, `collapsed` and nested `children`; nesting is limited to 32 levels and 1,000 layers in total,
and layer ids must be unique across the whole tree. A layer type the reader does not know is left out and
the document opens read-only (Save becomes Save As), so it is never silently dropped from the original
file. The manifest is validated with zod on load. Unknown fields are preserved on save (forward
compatibility).

### 2.2 Tile encoding (`tiles.bin`)

```
Header:  magic "IEPT" | u16 version=1 | u8 channels (1|4) | u8 alphaMode=0 (straight) | u16 tileSize=256 | u32 count
Entries (count ×): i32 tx | i32 ty | u8 kind (0=data, 1=uniform) | u32 payloadLen | payload
  kind 0: deflate(raw 256*256*channels bytes)   kind 1: u32 packed value
```

Little-endian. Only non-empty tiles are written. Text and shape layers store their cache so files render
even when the fonts are missing. On load, if the fonts are available, text re-rasterizes on the first edit.

### 2.3 Versioning & compatibility

- `version` is an integer. Readers support every version ≤ their own and migrate in memory.
- A file with a newer `version` opens read-only with a warning, if the manifest parses at all.
- Golden `.iep` fixtures per version live in `test/fixtures/iep/v*/` and must load forever.

### 2.4 Safety limits on load

Max 20,000 × 20,000 document, 1,000 layers, 10,000 tiles per layer, and a total uncompressed tile size
checked against the memory budget **before** inflating. Zip entries with `..` or absolute names are
rejected. A declared uncompressed size mismatch aborts the load (zip-bomb guard).

## 3. Settings (electron-store, zod-validated, migrated)

```ts
const Settings = z.object({
  schemaVersion: z.literal(1),
  general: z.object({ theme: z.enum(['system','light','dark']).default('dark'), language: z.string().default('en'),
                      interfaceScale: z.number().min(0.9).max(1.5).default(1), units: z.enum(['px','in','cm']).default('px') }),
  performance: z.object({ memoryBudgetMB: z.number().optional(), historySteps: z.number().int().min(20).max(1000).default(100),
                          scratchLimitGB: z.number().default(20), gpu: z.enum(['auto','off']).default('auto') }),
  files: z.object({ autosaveMinutes: z.number().min(0).max(60).default(2), defaultExport: ExportPreset,
                    metadataPolicy: z.enum(['keep','remove-gps','remove-all']).default('remove-gps') }),
  tools: z.record(z.string(), z.unknown()).default({}),       // per-tool options, validated by each tool's schema
  workspace: z.object({ preset: z.enum(['essentials','photography','custom']).default('essentials'), layout: z.unknown().optional() }),
  keymap: z.record(z.string(), z.string()).default({}),       // overrides only
  ai: z.object({ installedModels: z.array(z.string()).default([]), provider: z.enum(['auto','webgpu','wasm']).default('auto') }),
  updates: z.object({ channel: z.enum(['latest','beta']).default('latest') }),
  privacy: z.object({ crashReports: z.boolean().default(false) }),
});
```

## 4. On-disk locations

```
<userData>/                       %APPDATA%/ImageEditor · ~/Library/Application Support/ImageEditor · ~/.config/ImageEditor
├── settings.json
├── recent.json + thumbs/         (recent files, 256 px thumbnails)
├── recovery/<docId>.iep          (autosave snapshots)
├── models/<name>-<version>.onnx  (AI models, SHA-256 verified)
├── batch-presets.json
├── logs/
└── (OPFS, managed by Chromium)   history spill scratch files, capped by scratchLimitGB, wiped on start
```
