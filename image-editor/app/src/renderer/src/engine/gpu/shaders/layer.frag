#version 300 es
// Layer tile with optional live brush preview, composited onto the backdrop. Formula source: W3C
// Compositing and Blending Level 1 — §5.1 source-over (Normal, via GL blending) and, for other modes, the
// general formula in blend.glsl reading the backdrop copy. Must match brush/brush.ts applyStroke() and
// doc/blend.ts. The selection clips the preview exactly as Editor.commitStroke clips the commit. A brush
// blend mode (FR-PNT-10) uses the same general formula against the layer's own pixel.
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tile;   // premultiplied RGBA8
uniform bool u_hasTile;
uniform sampler2D u_stroke; // RGBA16F, alpha = accumulated coverage
uniform bool u_hasStroke;
uniform vec3 u_color;       // straight 0..1
uniform float u_brushOpacity;
uniform int u_mode;         // 0 = paint, 1 = erase
uniform int u_paintBlend;   // the brush's blend mode (FR-PNT-10), index into blend.glsl; 9 = Dissolve
uniform bool u_preserveAlpha; // transparency lock: painting keeps the existing alpha
uniform bool u_hasGrain;
uniform sampler2D u_grain;  // R8 GRAIN_SIZE² brush grain (brush/tips.ts), sampled at whole document pixels
uniform bool u_hasMask;
uniform sampler2D u_mask;   // R8 selection coverage of this tile (doc/selection.ts), sampled at whole pixels
uniform int u_layerMask;      // 0 = none, 1 = a tile in u_layerMaskTile, 2 = the background value
uniform sampler2D u_layerMaskTile; // the layer mask's RGBA tile, coverage in alpha (doc/document.ts LayerMask)
uniform float u_layerMaskBackground;
uniform bool u_clip;          // clipped to the base below (FR-LAY-05): multiply by the base's alpha
uniform sampler2D u_clipTile;  // the base's tile (premultiplied RGBA8: alpha is its alpha)
uniform int u_clipMask;        // the base's mask: 0 none, 1 tile in u_clipMaskTile, 2 background
uniform sampler2D u_clipMaskTile;
uniform float u_clipMaskBackground;
uniform float u_clipOpacity;   // the base's opacity × fill
uniform bool u_strokeOnMask;  // the stroke paints the layer mask (toward u_maskTarget), not the pixels
uniform float u_maskTarget;
uniform float u_layerOpacity;
uniform int u_blendMode;    // 0 = Normal and 9 = Dissolve (GL blending), else index into blend.glsl
uniform vec2 u_tileOrigin;  // this tile's document position (Dissolve's noise; tile.vert sets it too)
uniform float u_tileSize;
uniform sampler2D u_backdrop; // premultiplied copy of the target (only when u_blendMode != 0)
out vec4 o_color;

//#include blend

void main() {
  vec4 d = u_hasTile ? texture(u_tile, v_uv) : vec4(0.0);
  float m = u_layerMask == 1 ? texture(u_layerMaskTile, v_uv).a : u_layerMaskBackground;
  if (u_hasStroke && u_strokeOnMask) {
    // Mask painting: coverage moves toward the target (white reveals, black hides), as brush.ts applyMaskStroke.
    float a = texture(u_stroke, v_uv).a * u_brushOpacity;
    ivec2 px = min(ivec2(floor(v_uv * 256.0)), ivec2(255));
    if (u_hasGrain) a *= texelFetch(u_grain, px % 128, 0).r;
    if (u_hasMask) a *= texelFetch(u_mask, px, 0).r;
    m = mix(m, u_maskTarget, a);
  } else if (u_hasStroke) {
    float a = texture(u_stroke, v_uv).a * u_brushOpacity;
    ivec2 px = min(ivec2(floor(v_uv * 256.0)), ivec2(255)); // tile-local pixel
    if (u_hasGrain) a *= texelFetch(u_grain, px % 128, 0).r; // tile origins are multiples of 128
    if (u_hasMask) a *= texelFetch(u_mask, px, 0).r;
    // Dissolve paints each pixel fully or not at all (the layer mode's noise, per document pixel).
    if (u_mode == 0 && u_paintBlend == 9)
      a = dissolveNoise(u_tileOrigin + floor(v_uv * u_tileSize)) < a ? 1.0 : 0.0;
    // The colour laid down: the brush colour, or its blend with the pixel underneath (brush.ts applyStroke).
    vec3 cs = u_color;
    if (u_mode == 0 && u_paintBlend != 0 && u_paintBlend != 9 && d.a > 0.0)
      cs = mix(u_color, blendColor(u_paintBlend, d.rgb / d.a, u_color), u_preserveAlpha ? 1.0 : d.a);
    if (u_preserveAlpha) {
      d = u_mode == 0 ? vec4(mix(d.rgb, cs * d.a, a), d.a) : d;
    } else {
      d = u_mode == 0 ? vec4(cs * a, a) + d * (1.0 - a) : d * (1.0 - a);
    }
  }
  // The layer mask scales the layer before opacity and blending (as doc/flatten.ts compositeSpan).
  if (u_layerMask != 0) d *= m;
  if (u_clip) {
    float cm = u_clipMask == 1 ? texture(u_clipMaskTile, v_uv).a : (u_clipMask == 2 ? u_clipMaskBackground : 1.0);
    d *= texture(u_clipTile, v_uv).a * cm * u_clipOpacity; // as doc/flatten.ts compositeSpan
  }
  d *= u_layerOpacity;
  if (u_blendMode == 9) {
    // Dissolve, per document pixel; drawn with Normal's GL blending.
    o_color = dissolve(d, u_tileOrigin + floor(v_uv * u_tileSize));
  } else if (u_blendMode == 0) {
    o_color = d;
  } else {
    o_color = compositeOver(u_blendMode, texelFetch(u_backdrop, ivec2(gl_FragCoord.xy), 0), d);
  }
}
