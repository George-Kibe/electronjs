#version 300 es
// Dab coverage; must stay identical to brush/brush.ts dabCoverage(). Accumulated with
// blendFunc(ONE, ONE_MINUS_SRC_ALPHA): s' = c + s·(1 − c).
precision highp float;
in vec4 v_dab;
uniform vec2 u_tileOrigin;
uniform float u_hardness;
out vec4 o_color;

float dabCoverage(float d, float radius, float hardness) {
  float feather = max(0.5, radius * (1.0 - hardness));
  float inner = max(0.0, radius - feather);
  if (d <= inner) return 1.0;
  if (d >= radius) return 0.0;
  float t = (d - inner) / (radius - inner);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}

void main() {
  vec2 doc = u_tileOrigin + gl_FragCoord.xy; // pixel centre (x + 0.5, y + 0.5)
  float c = dabCoverage(distance(doc, v_dab.xy), v_dab.z, u_hardness) * v_dab.w;
  if (c <= 0.0) discard;
  o_color = vec4(0.0, 0.0, 0.0, c);
}
