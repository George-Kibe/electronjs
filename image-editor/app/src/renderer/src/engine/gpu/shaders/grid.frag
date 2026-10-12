#version 300 es
// Pixel grid (FR-NAV-01, shown at ≥ 800 %): a 1-device-px line on every document pixel boundary, as a
// translucent grey drawn over the composite (premultiplied, source-over). No formula source: UI overlay.
precision highp float;
uniform float u_zoom;   // CSS px per document px
uniform vec2 u_pan;     // CSS px
uniform float u_dpr;
uniform float u_height; // device px (gl_FragCoord.y grows upwards)
out vec4 o_color;

void main() {
  vec2 css = vec2(gl_FragCoord.x, u_height - gl_FragCoord.y) / u_dpr;
  vec2 doc = (css - u_pan) / u_zoom;
  // Device px between this fragment's centre and the boundary to its left / above.
  vec2 d = fract(doc) * u_zoom * u_dpr;
  if (d.x >= 1.0 && d.y >= 1.0) discard;
  o_color = vec4(vec3(0.5) * 0.35, 0.35);
}
