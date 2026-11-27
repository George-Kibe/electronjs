import { TILE_SIZE, type Tile } from '../tiles/tile';

/**
 * GPU cache of tile textures keyed by immutable tile id (ADR-0003: the GPU is a cache, CPU tiles are the
 * source of truth). Textures hold premultiplied alpha with mipmaps so zoomed-out views filter correctly.
 * The map is in least-recently-used order. Beyond `keepTextures`, textures not drawn in the last frame are
 * dropped after it: tiles out of view, and tiles no longer in the document at all (every edit makes new
 * tiles, so old ones would otherwise fill GPU memory). `maxTextures` bounds a single frame.
 */
export class TextureCache {
  private readonly textures = new Map<number, { texture: WebGLTexture; frame: number }>();
  private frame = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxTextures = 4096,
    private readonly keepTextures = 1024,
  ) {}

  /** A frame starts: the textures it draws are kept by endFrame. */
  beginFrame(): void {
    this.frame++;
  }

  /** A frame ended: beyond `keepTextures`, the textures it did not draw go. */
  endFrame(): void {
    // Drawn entries were moved to the end of the map, so the first one met ends the undrawn ones.
    for (const [id, entry] of this.textures) {
      if (this.textures.size <= this.keepTextures || entry.frame === this.frame) break;
      this.gl.deleteTexture(entry.texture);
      this.textures.delete(id);
    }
  }

  get(tile: Tile): WebGLTexture {
    const gl = this.gl;
    const cached = this.textures.get(tile.id);
    if (cached) {
      // refresh LRU position
      this.textures.delete(tile.id);
      cached.frame = this.frame;
      this.textures.set(tile.id, cached);
      return cached.texture;
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      TILE_SIZE,
      TILE_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(tile.data.buffer, tile.data.byteOffset, tile.data.byteLength),
    );
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.textures.set(tile.id, { texture: tex, frame: this.frame });
    this.evict();
    return tex;
  }

  get size(): number {
    return this.textures.size;
  }

  private evict(): void {
    for (const [id, entry] of this.textures) {
      if (this.textures.size <= this.maxTextures) break;
      this.gl.deleteTexture(entry.texture);
      this.textures.delete(id);
    }
  }

  /** After a context loss every handle is invalid; textures are re-created lazily from CPU tiles. */
  reset(): void {
    this.textures.clear();
  }

  dispose(): void {
    for (const entry of this.textures.values()) this.gl.deleteTexture(entry.texture);
    this.textures.clear();
  }
}
