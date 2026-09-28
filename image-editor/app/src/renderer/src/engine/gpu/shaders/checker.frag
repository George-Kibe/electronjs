#version 300 es
// Transparency checkerboard, fixed size in screen pixels.
precision mediump float;
uniform float u_cell; // device px
out vec4 o_color;

void main() {
  vec2 c = floor(gl_FragCoord.xy / u_cell);
  float light = mod(c.x + c.y, 2.0);
  o_color = vec4(vec3(mix(0.8, 1.0, light)), 1.0);
}
