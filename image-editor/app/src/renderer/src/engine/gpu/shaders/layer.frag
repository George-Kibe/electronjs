#version 300 es
// Layer tile with optional live brush preview, composited onto the backdrop. Formula source: W3C
// Compositing and Blending Level 1 — §5.1 source-over (Normal, via GL blending) and, for other modes, the
// general formula in blend.glsl reading the backdrop copy. Must match brush/brush.ts applyStroke() and
// doc/blend.ts.
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tile;   // premultiplied RGBA8
uniform bool u_hasTile;
uniform sampler2D u_stroke; // RGBA16F, alpha = accumulated coverage
uniform bool u_hasStroke;
uniform vec3 u_color;       // straight 0..1
uniform float u_brushOpacity;
uniform int u_mode;         // 0 = paint, 1 = erase
uniform bool u_preserveAlpha; // transparency lock: painting keeps the existing alpha
uniform float u_layerOpacity;
uniform int u_blendMode;    // 0 = Normal (GL blending), else index into blend.glsl
uniform sampler2D u_backdrop; // premultiplied copy of the target (only when u_blendMode != 0)
out vec4 o_color;

//#include blend

void main() {
  vec4 d = u_hasTile ? texture(u_tile, v_uv) : vec4(0.0);
  if (u_hasStroke) {
    float a = texture(u_stroke, v_uv).a * u_brushOpacity;
    if (u_preserveAlpha) {
      d = u_mode == 0 ? vec4(mix(d.rgb, u_color * d.a, a), d.a) : d;
    } else {
      d = u_mode == 0 ? vec4(u_color * a, a) + d * (1.0 - a) : d * (1.0 - a);
    }
  }
  d *= u_layerOpacity;
  if (u_blendMode == 0) {
    o_color = d;
  } else {
    o_color = compositeOver(u_blendMode, texelFetch(u_backdrop, ivec2(gl_FragCoord.xy), 0), d);
  }
}
