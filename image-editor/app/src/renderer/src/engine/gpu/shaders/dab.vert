#version 300 es
// One instanced quad per brush dab, rendered into a 256×256 stroke tile.
in vec2 a_unit;
in vec4 a_dab; // x, y, radius (document px), alpha (flow)
uniform vec2 u_tileOrigin;
out vec4 v_dab;

void main() {
  v_dab = a_dab;
  vec2 local = a_dab.xy - u_tileOrigin + (a_unit * 2.0 - 1.0) * (a_dab.z + 1.0);
  // Texel row 0 = top document row of the tile, so no y flip here.
  gl_Position = vec4(local / 128.0 - 1.0, 0.0, 1.0);
}
