import { accumulateDabs, type Dab } from '../brush/brush';
import { parseTileKey, TILE_SIZE, tileKey, type TileKey } from '../tiles/tile';
import { createProgram, type Program } from './program';
import dabFrag from './shaders/dab.frag?raw';
import dabVert from './shaders/dab.vert?raw';

type StrokeTile = { texture: WebGLTexture; framebuffer: WebGLFramebuffer };

/** Render-target format of the stroke buffer. RGBA16F preferred; RGBA8 when the driver can't blend floats. */
export type StrokeFormat = 'rgba16f' | 'rgba8';

const PROBE_DABS: Dab[] = [
  { x: 40, y: 40, radius: 20, alpha: 0.5 },
  { x: 52, y: 44, radius: 12, alpha: 0.7 },
];

/**
 * Per-tile RGBA16F coverage buffers for the stroke in progress (docs/02 §5.3). Tiled, so strokes work on
 * documents larger than MAX_TEXTURE_SIZE and only touched areas use memory.
 */
export class StrokeBuffer {
  private readonly tiles = new Map<TileKey, StrokeTile>();
  private readonly program: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly instances: WebGLBuffer;
  hardness = 1;
  /** Chosen by a startup self-test (see probe()). */
  readonly format: StrokeFormat;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    quad: WebGLBuffer,
    preferred: StrokeFormat = 'rgba16f',
  ) {
    this.program = createProgram(gl, dabVert, dabFrag);
    this.vao = gl.createVertexArray()!;
    this.instances = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const dabLoc = this.program.attrib('a_dab');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.enableVertexAttribArray(dabLoc);
    gl.vertexAttribPointer(dabLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(dabLoc, 1);
    gl.bindVertexArray(null);

    const candidates: StrokeFormat[] = preferred === 'rgba16f' ? ['rgba16f', 'rgba8'] : ['rgba8'];
    const working = candidates.find((f) => this.probe(f));
    if (!working) throw new Error('This GPU cannot render brush strokes (stroke buffer self-test failed).');
    this.format = working;
  }

  /**
   * Self-test: some drivers advertise EXT_color_buffer_float but cannot render or blend RGBA16F (seen with
   * software GL on Linux). Draw real dabs with the real shader, read back, and compare with the CPU
   * reference. Returns true if this format reproduces it.
   */
  private probe(format: StrokeFormat): boolean {
    if (format === 'rgba16f' && !this.gl.getExtension('EXT_color_buffer_float')) return false;
    (this as { format: StrokeFormat }).format = format;
    try {
      const saved = this.hardness;
      this.hardness = 0.5;
      this.addDabs(PROBE_DABS, TILE_SIZE, TILE_SIZE);
      this.hardness = saved;
      const gpu = this.readCoverage('0,0');
      const cpu = new Float32Array(TILE_SIZE * TILE_SIZE);
      accumulateDabs(cpu, 0, 0, PROBE_DABS, 0.5);
      const tolerance = format === 'rgba8' ? 2 / 255 : 2e-3;
      let covered = 0;
      for (let i = 0; i < cpu.length; i++) {
        if (Math.abs(cpu[i]! - gpu[i]!) > tolerance) return false;
        if (gpu[i]! > 0.1) covered++;
      }
      return covered > 100 && this.gl.getError() === this.gl.NO_ERROR;
    } catch {
      return false;
    } finally {
      this.clear();
    }
  }

  keys(): TileKey[] {
    return [...this.tiles.keys()];
  }

  texture(key: TileKey): WebGLTexture | undefined {
    return this.tiles.get(key)?.texture;
  }

  private tile(key: TileKey): StrokeTile {
    let t = this.tiles.get(key);
    if (t) return t;
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      1,
      this.format === 'rgba16f' ? gl.RGBA16F : gl.RGBA8,
      TILE_SIZE,
      TILE_SIZE,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Stroke buffer (${this.format}) is not renderable on this GPU`);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    t = { texture, framebuffer };
    this.tiles.set(key, t);
    return t;
  }

  /** Renders dabs into every stroke tile they touch, clipped to the document's tile range. */
  addDabs(dabs: readonly Dab[], docWidth: number, docHeight: number): TileKey[] {
    if (dabs.length === 0) return [];
    const gl = this.gl;
    const byTile = new Map<TileKey, number[]>();
    const maxTx = Math.ceil(docWidth / TILE_SIZE) - 1;
    const maxTy = Math.ceil(docHeight / TILE_SIZE) - 1;
    for (const d of dabs) {
      const tx0 = Math.max(0, Math.floor((d.x - d.radius) / TILE_SIZE));
      const tx1 = Math.min(maxTx, Math.floor((d.x + d.radius) / TILE_SIZE));
      const ty0 = Math.max(0, Math.floor((d.y - d.radius) / TILE_SIZE));
      const ty1 = Math.min(maxTy, Math.floor((d.y + d.radius) / TILE_SIZE));
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          const key = tileKey(tx, ty);
          let list = byTile.get(key);
          if (!list) byTile.set(key, (list = []));
          list.push(d.x, d.y, d.radius, d.alpha);
        }
    }
    gl.useProgram(this.program.program);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(this.program.uniform('u_hardness'), this.hardness);
    gl.viewport(0, 0, TILE_SIZE, TILE_SIZE);
    for (const [key, data] of byTile) {
      const [tx, ty] = parseTileKey(key);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tile(key).framebuffer);
      gl.uniform2f(this.program.uniform('u_tileOrigin'), tx * TILE_SIZE, ty * TILE_SIZE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, data.length / 4);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [...byTile.keys()];
  }

  /** Reads one stroke tile's coverage (row 0 = top row of the tile). */
  readCoverage(key: TileKey): Float32Array {
    const gl = this.gl;
    const coverage = new Float32Array(TILE_SIZE * TILE_SIZE);
    const t = this.tiles.get(key);
    if (!t) return coverage;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
    if (this.format === 'rgba16f') {
      const rgba = new Float32Array(TILE_SIZE * TILE_SIZE * 4);
      gl.readPixels(0, 0, TILE_SIZE, TILE_SIZE, gl.RGBA, gl.FLOAT, rgba);
      for (let i = 0; i < coverage.length; i++) coverage[i] = rgba[i * 4 + 3]!;
    } else {
      const rgba = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
      gl.readPixels(0, 0, TILE_SIZE, TILE_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      for (let i = 0; i < coverage.length; i++) coverage[i] = rgba[i * 4 + 3]! / 255;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return coverage;
  }

  clear(): void {
    for (const t of this.tiles.values()) {
      this.gl.deleteTexture(t.texture);
      this.gl.deleteFramebuffer(t.framebuffer);
    }
    this.tiles.clear();
  }
}
