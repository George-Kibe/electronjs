#version 300 es
// Draws one 256×256 tile quad at its document position (docs/02 §5.2).
in vec2 a_unit;
uniform vec2 u_tileOrigin; // document px
uniform float u_tileSize;
uniform mat3 u_docToClip;
out vec2 v_uv;

void main() {
  vec2 doc = u_tileOrigin + a_unit * u_tileSize;
  v_uv = a_unit;
  vec3 clip = u_docToClip * vec3(doc, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
