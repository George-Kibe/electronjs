import { TILE_SIZE, type Tile } from '../tiles/tile';

/**
 * GPU cache of tile textures keyed by immutable tile id (ADR-0003: the GPU is a cache, CPU tiles are the
 * source of truth). Textures hold premultiplied alpha with mipmaps so zoomed-out views filter correctly.
 * Least-recently-used textures are evicted beyond `maxTextures`.
 */
export class TextureCache {
  private readonly textures = new Map<number, WebGLTexture>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxTextures = 4096,
  ) {}

  get(tile: Tile): WebGLTexture {
    const gl = this.gl;
    const cached = this.textures.get(tile.id);
    if (cached) {
      // refresh LRU position
      this.textures.delete(tile.id);
      this.textures.set(tile.id, cached);
      return cached;
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
    this.textures.set(tile.id, tex);
    this.evict();
    return tex;
  }

  get size(): number {
    return this.textures.size;
  }

  private evict(): void {
    for (const [id, tex] of this.textures) {
      if (this.textures.size <= this.maxTextures) break;
      this.gl.deleteTexture(tex);
      this.textures.delete(id);
    }
  }

  /** After a context loss every handle is invalid; textures are re-created lazily from CPU tiles. */
  reset(): void {
    this.textures.clear();
  }

  dispose(): void {
    for (const tex of this.textures.values()) this.gl.deleteTexture(tex);
    this.textures.clear();
  }
}
