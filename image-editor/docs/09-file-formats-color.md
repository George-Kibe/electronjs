# 09 — File Formats & Colour Management: ImageEditor

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Related | [ADR-0004](adr/0004-colour-management-srgb-8bit.md) · [ADR-0007](adr/0007-native-project-format-iep.md) · [ADR-0008](adr/0008-codec-host-utility-process.md) |

## 1. Format support matrix

| Format | Import | Export | Engine | Notes |
| --- | --- | --- | --- | --- |
| `.iep` (native) | ✅ | ✅ | fflate (worker) | Everything is preserved ([05 §2](05-data-model.md#2-iep-project-format-v1)) |
| PNG | ✅ (8/16-bit → 8-bit, palette, grey, alpha) | ✅ (compression level, optional palette quantisation) | sharp | 16-bit is downconverted with dithering |
| JPEG | ✅ (incl. CMYK/YCCK → sRGB, progressive) | ✅ (quality 1–100, progressive, 4:4:4/4:2:0, mozjpeg) | sharp | EXIF orientation applied on import |
| WebP | ✅ (still; the first frame of animations) | ✅ (lossy/lossless, quality, alpha quality) | sharp | |
| AVIF | ✅ | ✅ (quality, effort, 8-bit) | sharp (libheif + aom, bundled in sharp's prebuilds) | Encoding is slow at high effort. Default effort 4. |
| GIF | ✅ (first frame) | ✅ (single frame, palette + dithering) | sharp | Animation is a non-goal |
| BMP | ✅ | ✅ | Small built-in codec in codec-host (`bmp.ts`): sharp/libvips has no BMP support at all. | Import: 1/4/8-bit palette, 16/24/32-bit, BI_RGB/BITFIELDS (RLE rejected). Export: 24-bit (matte) or 32-bit BGRA. |
| TIFF | ✅ (first page; 8/16-bit; LZW/ZIP/JPEG) | ✅ (LZW/ZIP, 8-bit, single layer) | sharp | Multi-page and layered TIFF → first page / composite only |
| PSD | ✅ | ✅ | ag-psd (worker) | See §3. PSB (large document) is import-only, if ag-psd handles the size within limits. |
| HEIC/HEIF | ❌ (Future) | ❌ | — | HEVC patent licensing. Future option: OS codecs (Windows HEIF/HEVC extensions, macOS ImageIO) through a small native helper. |
| SVG | ❌ (Future, rasterize) | ❌ | — | See [Security §3](06-security.md#3-resource-limits-decompression-bombs) |
| Clipboard | ✅ (PNG/bitmap) | ✅ (PNG) | Chromium clipboard | Transparency is preserved where the OS supports PNG on the clipboard |

## 2. Codecs

- **sharp** (libvips) in the codec-host utilityProcess handles decode, ICC conversion, orientation and
  encode. The pipeline for import:

```js
sharp(path, { limitInputPixels: 400_000_000, failOn: 'error', sequentialRead: true, unlimited: false })
  .rotate()                               // apply EXIF orientation, then drop the tag
  .toColourspace('srgb')                  // uses embedded ICC (or assumes sRGB) → sRGB
  .ensureAlpha()
  .raw({ depth: 'uchar' })
  .toBuffer({ resolveWithObject: true })  // streamed in chunks to the renderer (see 04 §1.1)
```

- Export pipeline: raw RGBA8 (straight alpha) → `sharp(raw, { raw: { width, height, channels: 4 } })` →
  format-specific options → `.withIccProfile('srgb')` → metadata per policy (`.keepExif()` minus GPS, or none)
  → buffer → main writes atomically.
- Browser-native decoding (`createImageBitmap`) is used only for clipboard images and small UI
  thumbnails. It is not used for documents, because it would bypass our ICC/orientation handling
  (Chromium applies its own colour conversion and premultiplication).

## 3. PSD mapping

| PSD feature | Import | Export |
| --- | --- | --- |
| Raster layers, position, opacity, fill opacity, visibility, name | ✅ | ✅ |
| Blend modes (our 18) | ✅. Others (e.g. Vivid Light, Pin Light, Hard Mix, Subtract, Divide, Darker/Lighter Color) → Normal, with a notice | ✅ |
| Groups (+ pass-through) | ✅ | ✅ |
| Layer masks (raster) | ✅ | ✅ |
| Vector masks | Rasterized into a layer mask | ❌ |
| Clipping masks | ✅ | ✅ |
| Adjustment layers: Levels, Curves, Brightness/Contrast, Hue/Sat, Color Balance, Exposure, Vibrance, B&W, Photo Filter, Invert, Posterize, Threshold | ✅ (parameters mapped) | ✅ |
| Other adjustment layers (Gradient map, Selective color, Channel mixer, LUTs) | Kept as an **opaque passthrough layer**: rendered as no-op, preserved on PSD re-export where ag-psd supports round trip. Notice shown. | round-trip only |
| Text layers | ✅ editable if the fonts are installed (font, size, colour, alignment, tracking, leading). Advanced features (warp, paths, OpenType features) → keep the raster with an "Edit will reset formatting" warning. | ✅ basic text engine data + raster |
| Shape layers | Rasterized (v1) | Rasterized |
| Layer styles: drop shadow, stroke, outer glow | ✅ (M3) | ✅ |
| Other layer styles | Ignored, with a notice. The composite is still available. | — |
| Smart objects | Rasterized from the embedded composite | — |
| 16/32-bit, CMYK, Lab, multichannel | Converted to 8-bit sRGB from the composite (layers dropped) with a notice. ag-psd reads RGB 8/16. | — |
| Colour profile | Embedded ICC → sRGB conversion of layer pixels (via codec-host on raw buffers) | sRGB ICC embedded |

**Compatibility promise:** a PSD made by ImageEditor re-opens in Photoshop, GIMP and Photopea with its
layers, masks, groups, blend modes, opacity and text intact (verified manually each release with a
checklist file).

## 4. Colour management

### 4.1 Model (ADR-0004)

- **Working space:** sRGB IEC61966-2.1, 8 bits per channel, straight alpha in storage.
- **Import:** every image is converted from its embedded ICC profile to sRGB (relative colorimetric
  intent, black point compensation) by libvips/LittleCMS in codec-host. No profile → assume sRGB. For
  wide-gamut sources (Display-P3 phone photos), the status bar shows "Converted from Display P3" so users
  understand small saturation changes.
- **Display:** the canvas shows sRGB values. Chromium colour-manages the canvas to the monitor profile
  (Electron uses the system colour profile by default), so sRGB content looks correct on wide-gamut
  displays. We do **not** force `--force-color-profile=srgb`.
- **Export:** always embed the sRGB ICC profile (except when the user unticks it for tiny web assets).
- **Colour picker / eyedropper:** values shown are sRGB document values (not the monitor-converted colour).

### 4.2 Blending & resampling space

- Blending, opacity and adjustments operate on **gamma-encoded sRGB values**. This matches Photoshop's
  default RGB behaviour, the W3C Compositing spec, and what users expect for layer interactions.
- Resampling (resize, transform) and blurs also operate in gamma space in v1, for consistency with
  Photoshop defaults. An optional "Linear light resampling" preference is a Could for M5, because it gives
  more accurate downscaling of high-contrast detail.
- Intermediate render targets are RGBA16F where supported, to avoid banding when many layers and
  adjustments stack. Results are dithered when quantised to 8-bit for export and readback.

### 4.3 Out of scope (v1)

Soft proofing, CMYK, working in Display-P3/Adobe RGB, 16-bit/32-bit per channel, monitor calibration.
The data model keeps `colorSpace` and tile `channels`/depth fields so a later ADR can extend it.

## 5. Export options (Export As dialog)

**Metadata policy (FR-DOC-09).** The source EXIF block travels with the document as opaque bytes (also in
`.iep`). On export, codec-host parses it and **rebuilds** a new block from an allow-list (`exif.ts`) instead of
deleting tags in place, so dropped data cannot survive as unreferenced bytes: "Remove location" keeps camera,
exposure, date and copyright tags; "Keep" also keeps GPS and serial numbers; maker notes, thumbnails and size
tags are never kept, and Orientation is always 1 (pixels are exported upright). The block is inserted as an
APP1 segment (JPEG) or an `eXIf` chunk (PNG). Other formats are written without camera metadata in v1.


| Option | Formats | Default |
| --- | --- | --- |
| Quality | JPEG, WebP (lossy), AVIF | 85 / 80 / 60 |
| Lossless | WebP | off |
| Progressive | JPEG | on |
| Chroma subsampling | JPEG | 4:2:0 (quality < 90), 4:4:4 (≥ 90) |
| Compression level | PNG | 6 |
| Palette (quantise) + colours + dither | PNG, GIF | off (PNG) / on (GIF) |
| Resize on export | all | off |
| Matte colour for transparency | JPEG, BMP (24-bit) | white |
| Metadata | JPEG, PNG (others are written without camera metadata) | Remove location |
| Embed sRGB profile | all except BMP/GIF | on |
