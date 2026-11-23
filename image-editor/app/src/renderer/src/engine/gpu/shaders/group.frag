#version 300 es
// Composites an isolated group (or the finished document) held in a screen-space premultiplied buffer
// onto the current target. Formula source: W3C Compositing and Blending Level 1 (see blend.glsl).
precision highp float;
uniform sampler2D u_src;      // premultiplied
uniform float u_opacity;
uniform int u_blendMode;      // 0 = Normal and 9 = Dissolve (GL blending)
uniform vec4 u_screenToDoc;   // document px = frag.xy * (x, z) + (y, w), for Dissolve's noise
uniform sampler2D u_backdrop; // premultiplied copy of the target (only when u_blendMode != 0)
out vec4 o_color;

//#include blend

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(u_src, p, 0) * u_opacity;
  if (u_blendMode == 9) {
    vec2 doc = vec2(gl_FragCoord.x * u_screenToDoc.x + u_screenToDoc.y, gl_FragCoord.y * u_screenToDoc.z + u_screenToDoc.w);
    o_color = dissolve(s, doc);
  } else {
    o_color = u_blendMode == 0 ? s : compositeOver(u_blendMode, texelFetch(u_backdrop, p, 0), s);
  }
}
