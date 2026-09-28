import type { BrushSettings } from '../brush/brush';
import { blendModeIndex } from '../doc/blend';
import type { Document, Layer } from '../doc/document';
import type { Viewport } from '../render/viewport';
import { parseTileKey, TILE_SIZE, tileKey, type TileKey } from '../tiles/tile';
import { createProgram, createUnitQuad, type Program } from './program';
import blendGlsl from './shaders/blend.glsl?raw';
import checkerFrag from './shaders/checker.frag?raw';
import groupFrag from './shaders/group.frag?raw';
import layerFrag from './shaders/layer.frag?raw';
import quadVert from './shaders/quad.vert?raw';
import screenVert from './shaders/screen.vert?raw';
import tileVert from './shaders/tile.vert?raw';
import { StrokeBuffer, type StrokeFormat } from './stroke-buffer';
import { TextureCache } from './texture-cache';

export type StrokePreview = {
  buffer: StrokeBuffer;
  layerId: string;
  settings: BrushSettings;
  /** Transparency lock: the preview keeps each pixel's alpha (FR-LAY-02). */
  preserveAlpha: boolean;
};

type Size = { cssWidth: number; cssHeight: number; width: number; height: number; dpr: number };
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer };

const SURROUND = [0x3a / 255, 0x3a / 255, 0x3a / 255, 1] as const;
const withBlend = (source: string) => source.replace('//#include blend', blendGlsl);

/**
 * WebGL2 compositor (docs/02 §5.2): the layer tree is composited bottom → top into a screen-space buffer
 * (RGBA16F when the driver supports it), then presented over the transparency checkerboard.
 * - Normal layers use fixed-function premultiplied source-over (fast path).
 * - Other blend modes copy the current buffer to a backdrop texture and apply the W3C formula in-shader.
 * - Pass-through groups composite their children inline; other groups render into their own buffer first.
 * The CPU reference is doc/flatten.ts (compositeSpan); gpu.gpu.test.ts checks they agree.
 */
export class Compositor {
  readonly gl: WebGL2RenderingContext;
  readonly quad: WebGLBuffer;
  readonly textures: TextureCache;
  /** Format of the screen-space buffers; set from the stroke buffer's self-test (same capability). */
  targetFormat: StrokeFormat = 'rgba8';
  private readonly layerProgram: Program;
  private readonly groupProgram: Program;
  private readonly checkerProgram: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly linearSampler: WebGLSampler;
  private readonly nearestSampler: WebGLSampler;
  private pool: Target[] = [];
  private free: Target[] = [];
  private poolSize = { width: 0, height: 0, format: '' };

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.quad = createUnitQuad(gl);
    this.textures = new TextureCache(gl);
    this.layerProgram = createProgram(gl, tileVert, withBlend(layerFrag));
    this.groupProgram = createProgram(gl, screenVert, withBlend(groupFrag));
    this.checkerProgram = createProgram(gl, quadVert, checkerFrag);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.linearSampler = this.sampler(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
    this.nearestSampler = this.sampler(gl.NEAREST, gl.NEAREST);
  }

  private sampler(min: number, mag: number): WebGLSampler {
    const gl = this.gl;
    const s = gl.createSampler()!;
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, mag);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return s;
  }

  // ---- screen-space buffers --------------------------------------------------------------------

  private resizePool(width: number, height: number): void {
    const format = this.targetFormat;
    if (this.poolSize.width === width && this.poolSize.height === height && this.poolSize.format === format)
      return;
    this.disposePool();
    this.poolSize = { width, height, format };
  }

  /** A cleared buffer the size of the canvas. Return it with release(). */
  private acquire(): Target {
    const gl = this.gl;
    let t = this.free.pop();
    if (!t) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const { width, height } = this.poolSize;
      if (this.targetFormat === 'rgba16f') gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height);
      else gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      t = { texture, framebuffer };
      this.pool.push(t);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return t;
  }

  private release(t: Target): void {
    this.free.push(t);
  }

  /** A copy of `target` to read the backdrop from while drawing into `target`. */
  private backdropOf(target: Target): Target {
    const gl = this.gl;
    const copy = this.acquire();
    const { width, height } = this.poolSize;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy.framebuffer);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    return copy;
  }

  // ---- rendering -------------------------------------------------------------------------------

  /** Draws the document into the canvas (default framebuffer) of size (width × height) device pixels. */
  render(doc: Document, viewport: Viewport, size: Size, stroke?: StrokePreview): void {
    const gl = this.gl;
    this.resizePool(size.width, size.height);
    gl.viewport(0, 0, size.width, size.height);
    gl.bindVertexArray(this.vao);
    const docToClip = viewport.docToClip(size.cssWidth, size.cssHeight);

    const main = this.acquire();
    const visible = this.visibleTiles(doc, viewport, size);
    this.drawLayers(doc.layers, main, { docToClip, visible, viewport, size, stroke });

    // Present: surround, checkerboard under the document, then the composite (premultiplied source-over).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.clearColor(...SURROUND);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.checkerProgram.program);
    gl.uniformMatrix3fv(this.checkerProgram.uniform('u_docToClip'), false, docToClip);
    gl.uniform4f(this.checkerProgram.uniform('u_rect'), 0, 0, doc.width, doc.height);
    gl.uniform1f(this.checkerProgram.uniform('u_cell'), 8 * size.dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.drawBuffer(main, 1, 0);
    this.release(main);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  private drawLayers(
    layers: readonly Layer[],
    target: Target,
    ctx: {
      docToClip: Float32Array;
      visible: TileKey[];
      viewport: Viewport;
      size: Size;
      stroke?: StrokePreview;
    },
  ): void {
    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.type === 'group') {
        if (layer.passThrough && layer.opacity === 1) {
          this.drawLayers(layer.children, target, ctx);
          continue;
        }
        if (layer.opacity === 0) continue;
        const buffer = this.acquire();
        this.drawLayers(layer.children, buffer, ctx);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
        const mode = layer.passThrough ? 0 : blendModeIndex(layer.blendMode);
        const backdrop = mode === 0 ? null : this.backdropOf(target);
        this.drawBuffer(buffer, layer.opacity, mode, backdrop);
        if (backdrop) this.release(backdrop);
        this.release(buffer);
        continue;
      }
      const opacity = layer.opacity * layer.fillOpacity;
      const preview = ctx.stroke && ctx.stroke.layerId === layer.id ? ctx.stroke : undefined;
      if (opacity === 0) continue;
      const mode = blendModeIndex(layer.blendMode);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
      const backdrop = mode === 0 ? null : this.backdropOf(target);
      this.drawRaster(layer, opacity, mode, backdrop, ctx, preview);
      if (backdrop) this.release(backdrop);
    }
  }

  private drawRaster(
    layer: Extract<Layer, { type: 'raster' }>,
    opacity: number,
    mode: number,
    backdrop: Target | null,
    ctx: { docToClip: Float32Array; visible: TileKey[]; viewport: Viewport; size: Size },
    preview: StrokePreview | undefined,
  ): void {
    const gl = this.gl;
    const p = this.layerProgram;
    gl.useProgram(p.program);
    if (mode === 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, backdrop!.texture);
    }
    gl.uniformMatrix3fv(p.uniform('u_docToClip'), false, ctx.docToClip);
    gl.uniform1f(p.uniform('u_tileSize'), TILE_SIZE);
    gl.uniform1i(p.uniform('u_tile'), 0);
    gl.uniform1i(p.uniform('u_stroke'), 1);
    gl.uniform1i(p.uniform('u_backdrop'), 2);
    gl.uniform1i(p.uniform('u_blendMode'), mode);
    gl.uniform1f(p.uniform('u_layerOpacity'), opacity);
    gl.bindSampler(0, ctx.viewport.zoom * ctx.size.dpr >= 2 ? this.nearestSampler : this.linearSampler);
    if (preview) {
      const [r, g, b] = preview.settings.color;
      gl.uniform3f(p.uniform('u_color'), r / 255, g / 255, b / 255);
      gl.uniform1f(p.uniform('u_brushOpacity'), preview.settings.opacity);
      gl.uniform1i(p.uniform('u_mode'), preview.settings.mode === 'erase' ? 1 : 0);
      gl.uniform1i(p.uniform('u_preserveAlpha'), preview.preserveAlpha ? 1 : 0);
    }
    for (const key of ctx.visible) {
      const tile = layer.tiles.get(key);
      const strokeTex = preview?.buffer.texture(key);
      if (!tile && !strokeTex) continue;
      const [tx, ty] = parseTileKey(key);
      gl.uniform2f(p.uniform('u_tileOrigin'), tx * TILE_SIZE, ty * TILE_SIZE);
      gl.uniform1i(p.uniform('u_hasTile'), tile ? 1 : 0);
      gl.uniform1i(p.uniform('u_hasStroke'), strokeTex ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tile ? this.textures.get(tile) : null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, strokeTex ?? null);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindSampler(0, null);
  }

  /** Composites a screen-space buffer onto the bound framebuffer. */
  private drawBuffer(src: Target, opacity: number, mode: number, backdrop: Target | null = null): void {
    const gl = this.gl;
    const p = this.groupProgram;
    gl.useProgram(p.program);
    if (mode === 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, backdrop!.texture);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.texture);
    gl.uniform1i(p.uniform('u_src'), 0);
    gl.uniform1i(p.uniform('u_backdrop'), 2);
    gl.uniform1f(p.uniform('u_opacity'), opacity);
    gl.uniform1i(p.uniform('u_blendMode'), mode);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Tile keys inside both the document and the visible viewport. */
  private visibleTiles(
    doc: Document,
    viewport: Viewport,
    size: { cssWidth: number; cssHeight: number },
  ): TileKey[] {
    const r = viewport.visibleDocRect(size.cssWidth, size.cssHeight);
    const tx0 = Math.max(0, Math.floor(r.x0 / TILE_SIZE));
    const ty0 = Math.max(0, Math.floor(r.y0 / TILE_SIZE));
    const tx1 = Math.min(Math.ceil(doc.width / TILE_SIZE), Math.ceil(r.x1 / TILE_SIZE));
    const ty1 = Math.min(Math.ceil(doc.height / TILE_SIZE), Math.ceil(r.y1 / TILE_SIZE));
    const keys: TileKey[] = [];
    for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) keys.push(tileKey(tx, ty));
    return keys;
  }

  private disposePool(): void {
    const gl = this.gl;
    for (const t of this.pool) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    this.pool = [];
    this.free = [];
  }

  dispose(): void {
    this.disposePool();
    this.textures.dispose();
  }
}
