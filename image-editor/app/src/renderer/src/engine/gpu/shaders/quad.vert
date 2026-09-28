#version 300 es
// Full rectangle in document space (used for the transparency checkerboard).
in vec2 a_unit;
uniform vec4 u_rect; // x, y, w, h in document px
uniform mat3 u_docToClip;

void main() {
  vec3 clip = u_docToClip * vec3(u_rect.xy + a_unit * u_rect.zw, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
