import type { BrushSettings } from '../brush/brush';
import type { Document } from '../doc/document';
import type { Viewport } from '../render/viewport';
import { parseTileKey, TILE_SIZE, tileKey, type TileKey } from '../tiles/tile';
import { createProgram, createUnitQuad, type Program } from './program';
import checkerFrag from './shaders/checker.frag?raw';
import layerFrag from './shaders/layer.frag?raw';
import quadVert from './shaders/quad.vert?raw';
import tileVert from './shaders/tile.vert?raw';
import { StrokeBuffer } from './stroke-buffer';
import { TextureCache } from './texture-cache';

export type StrokePreview = { buffer: StrokeBuffer; layerId: string; settings: BrushSettings };

const SURROUND = [0x3a / 255, 0x3a / 255, 0x3a / 255, 1] as const;

/**
 * WebGL2 compositor (docs/02 §5.2), M0 subset: Normal blend + layer opacity, bottom → top, drawing only the
 * visible tiles. The live brush preview is composited into the active layer with the same formula as the
 * CPU commit.
 */
export class Compositor {
  readonly gl: WebGL2RenderingContext;
  readonly quad: WebGLBuffer;
  readonly textures: TextureCache;
  private readonly layerProgram: Program;
  private readonly checkerProgram: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly linearSampler: WebGLSampler;
  private readonly nearestSampler: WebGLSampler;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.quad = createUnitQuad(gl);
    this.textures = new TextureCache(gl);
    this.layerProgram = createProgram(gl, tileVert, layerFrag);
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

  /** Draws the document into the current framebuffer of size (width × height) device pixels. */
  render(
    doc: Document,
    viewport: Viewport,
    size: { cssWidth: number; cssHeight: number; width: number; height: number; dpr: number },
    stroke?: StrokePreview,
  ): void {
    const gl = this.gl;
    gl.viewport(0, 0, size.width, size.height);
    gl.disable(gl.BLEND);
    gl.clearColor(...SURROUND);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const docToClip = viewport.docToClip(size.cssWidth, size.cssHeight);
    gl.bindVertexArray(this.vao);

    // Transparency checkerboard under the document.
    gl.useProgram(this.checkerProgram.program);
    gl.uniformMatrix3fv(this.checkerProgram.uniform('u_docToClip'), false, docToClip);
    gl.uniform4f(this.checkerProgram.uniform('u_rect'), 0, 0, doc.width, doc.height);
    gl.uniform1f(this.checkerProgram.uniform('u_cell'), 8 * size.dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Layers, premultiplied source-over.
    const p = this.layerProgram;
    gl.useProgram(p.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix3fv(p.uniform('u_docToClip'), false, docToClip);
    gl.uniform1f(p.uniform('u_tileSize'), TILE_SIZE);
    gl.uniform1i(p.uniform('u_tile'), 0);
    gl.uniform1i(p.uniform('u_stroke'), 1);
    gl.bindSampler(0, viewport.zoom * size.dpr >= 2 ? this.nearestSampler : this.linearSampler);

    const visible = this.visibleTiles(doc, viewport, size);
    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity === 0) continue;
      const preview = stroke && stroke.layerId === layer.id ? stroke : undefined;
      gl.uniform1f(p.uniform('u_layerOpacity'), layer.opacity);
      if (preview) {
        const [r, g, b] = preview.settings.color;
        gl.uniform3f(p.uniform('u_color'), r / 255, g / 255, b / 255);
        gl.uniform1f(p.uniform('u_brushOpacity'), preview.settings.opacity);
        gl.uniform1i(p.uniform('u_mode'), preview.settings.mode === 'erase' ? 1 : 0);
      }
      for (const key of visible) {
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
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
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

  dispose(): void {
    this.textures.dispose();
  }
}
