#version 300 es
// Layer tile with optional live brush preview. Formula source: W3C Compositing and Blending Level 1,
// §5.1 "source-over" (Normal), in premultiplied form. Must match brush/brush.ts applyStroke().
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tile;   // premultiplied RGBA8
uniform bool u_hasTile;
uniform sampler2D u_stroke; // RGBA16F, alpha = accumulated coverage
uniform bool u_hasStroke;
uniform vec3 u_color;       // straight 0..1
uniform float u_brushOpacity;
uniform int u_mode;         // 0 = paint, 1 = erase
uniform float u_layerOpacity;
out vec4 o_color;

void main() {
  vec4 d = u_hasTile ? texture(u_tile, v_uv) : vec4(0.0);
  if (u_hasStroke) {
    float a = texture(u_stroke, v_uv).a * u_brushOpacity;
    d = u_mode == 0 ? vec4(u_color * a, a) + d * (1.0 - a) : d * (1.0 - a);
  }
  o_color = d * u_layerOpacity;
}
