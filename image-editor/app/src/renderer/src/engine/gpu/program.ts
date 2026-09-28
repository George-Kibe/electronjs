export type Program = {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
  attrib(name: string): number;
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, 'a_unit');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform: (name) => {
      if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name));
      return uniforms.get(name)!;
    },
    attrib: (name) => gl.getAttribLocation(program, name),
  };
}

/** Unit quad (two triangles) bound to attribute 0, shared by every program. */
export function createUnitQuad(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  return buffer;
}
