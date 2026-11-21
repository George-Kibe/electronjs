#version 300 es
// Quick Mask overlay (FR-SEL-06): unselected pixels shown under a 50 % red, drawn over the composite. A Quick
// Mask stroke moves coverage toward u_target exactly as brush/brush.ts applySelectionStroke does on commit.
precision highp float;
in vec2 v_uv;
uniform int u_maskMode;       // 0 = fully selected (or no selection), 1 = tile in u_mask, 2 = nothing selected
uniform sampler2D u_mask;     // R8 selection coverage of this tile (doc/selection.ts)
uniform bool u_hasStroke;
uniform sampler2D u_stroke;   // RGBA16F, alpha = accumulated coverage
uniform float u_brushOpacity;
uniform float u_target;       // 0..1: black deselects, white selects
uniform bool u_hasGrain;
uniform sampler2D u_grain;
uniform vec2 u_tileOrigin;    // document px
uniform vec2 u_docSize;
out vec4 o_color;

void main() {
  vec2 doc = u_tileOrigin + v_uv * 256.0;
  if (doc.x < 0.0 || doc.y < 0.0 || doc.x >= u_docSize.x || doc.y >= u_docSize.y) discard;
  ivec2 px = min(ivec2(floor(v_uv * 256.0)), ivec2(255));
  float m = u_maskMode == 1 ? texelFetch(u_mask, px, 0).r : (u_maskMode == 0 ? 1.0 : 0.0);
  if (u_hasStroke) {
    float a = texture(u_stroke, v_uv).a * u_brushOpacity;
    if (u_hasGrain) a *= texelFetch(u_grain, px % 128, 0).r;
    m = mix(m, u_target, a);
  }
  o_color = vec4(1.0, 0.0, 0.0, 1.0) * (0.5 * (1.0 - m)); // premultiplied red
}
