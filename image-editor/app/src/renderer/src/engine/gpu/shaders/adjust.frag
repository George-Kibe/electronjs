#version 300 es
// Adjustment layer (FR-ADJ-01, docs/02 §5.2): adjusts the backdrop below it and mixes the result in by the
// layer's opacity × mask (× its clipping base), keeping the backdrop's alpha. CPU reference:
// engine/ops/adjust.ts adjustPixel (formula sources are noted there: GIMP's operations where Photoshop's are
// not published) and engine/doc/flatten.ts compositeSpan. Blend modes: blend.glsl (W3C Compositing Level 1).
precision highp float;
in vec2 v_uv;
uniform sampler2D u_backdrop; // premultiplied copy of the target
uniform bool u_hasLut;
uniform sampler2D u_lut;      // 256×1 RGBA8: the red, green and blue tables
uniform int u_stage;          // adjust.ts STAGE
uniform vec4 u_p[4];          // adjust.ts PreparedAdjustment.params
uniform int u_blendMode;
uniform vec2 u_tileOrigin; // this tile's document position (Dissolve's noise)
uniform float u_tileSize;
uniform float u_opacity;      // opacity × fill
uniform int u_layerMask;      // 0 = none, 1 = a tile in u_layerMaskTile, 2 = the background value
uniform sampler2D u_layerMaskTile;
uniform float u_layerMaskBackground;
uniform bool u_clip;          // clipped to the raster base below (FR-LAY-05), as layer.frag
uniform sampler2D u_clipTile;
uniform int u_clipMask;
uniform sampler2D u_clipMaskTile;
uniform float u_clipMaskBackground;
uniform float u_clipOpacity;
// A brush stroke painting the mask (FR-LAY-04), previewed as layer.frag does.
uniform bool u_hasStroke;
uniform sampler2D u_stroke;   // RGBA16F, alpha = accumulated coverage
uniform float u_brushOpacity;
uniform bool u_hasGrain;
uniform sampler2D u_grain;
uniform bool u_hasMask;       // the selection clips the stroke
uniform sampler2D u_mask;
uniform float u_maskTarget;
out vec4 o_color;

//#include blend

vec3 rgbToHsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) / 2.0;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

float hueToRgb(float p, float q, float t) {
  float u = t - floor(t);
  if (u < 1.0 / 6.0) return p + (q - p) * 6.0 * u;
  if (u < 0.5) return q;
  if (u < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - u) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(hueToRgb(p, q, hsl.x + 1.0 / 3.0), hueToRgb(p, q, hsl.x), hueToRgb(p, q, hsl.x - 1.0 / 3.0));
}

float luma(vec3 c) { return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; }

float balance(float v, float l, float sh, float mid, float hi) {
  float s = sh * clamp((l - 0.333) / -0.25 + 0.5, 0.0, 1.0) * 0.7;
  float m = mid * clamp((l - 0.333) / 0.25 + 0.5, 0.0, 1.0) * clamp((l + 0.333 - 1.0) / -0.25 + 0.5, 0.0, 1.0) * 0.7;
  float h = hi * clamp((l + 0.333 - 1.0) / 0.25 + 0.5, 0.0, 1.0) * 0.7;
  return clamp(v + s + m + h, 0.0, 1.0);
}

vec3 colorStage(vec3 c) {
  if (u_stage == 1) { // threshold
    return vec3(luma(c) >= u_p[0].x ? 1.0 : 0.0);
  }
  if (u_stage == 2) { // hue/saturation
    vec3 hsl = rgbToHsl(c);
    float light = u_p[0].z;
    float l = light < 0.0 ? hsl.z * (1.0 + light) : hsl.z + (1.0 - hsl.z) * light;
    if (u_p[0].w > 0.5) return hslToRgb(vec3(u_p[0].x, clamp(u_p[0].y, 0.0, 1.0), l));
    return hslToRgb(vec3(hsl.x + u_p[0].x, clamp(hsl.y * (1.0 + u_p[0].y), 0.0, 1.0), l));
  }
  if (u_stage == 3) { // vibrance
    float y = luma(c);
    float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
    float k = (1.0 + u_p[0].y) * (1.0 + u_p[0].x * (1.0 - sat));
    return clamp(vec3(y) + (c - vec3(y)) * k, 0.0, 1.0);
  }
  if (u_stage == 4) { // color balance
    float l = rgbToHsl(c).z;
    vec3 o = vec3(
      balance(c.r, l, u_p[0].x, u_p[1].x, u_p[2].x),
      balance(c.g, l, u_p[0].y, u_p[1].y, u_p[2].y),
      balance(c.b, l, u_p[0].z, u_p[1].z, u_p[2].z));
    if (u_p[0].w < 0.5) return o;
    return hslToRgb(vec3(rgbToHsl(o).xy, l));
  }
  if (u_stage == 5) { // black & white; ties go to red, then green (as adjust.ts)
    int i0 = c.r >= c.g && c.r >= c.b ? 0 : (c.g >= c.b ? 1 : 2);
    int j = i0 == 0 ? 1 : 0;
    int k = i0 == 2 ? 1 : 2;
    int i1 = c[j] >= c[k] ? j : k;
    float mx = c[i0];
    float md = c[i1];
    float mn = c[3 - i0 - i1];
    float primary = i0 == 0 ? u_p[0].x : (i0 == 1 ? u_p[0].z : u_p[1].x);
    int pair = i0 + i1;
    float secondary = pair == 1 ? u_p[0].y : (pair == 3 ? u_p[0].w : u_p[1].y);
    float v = clamp(mn + (md - mn) * secondary + (mx - md) * primary, 0.0, 1.0);
    if (u_p[2].w < 0.5) return vec3(v);
    return hslToRgb(vec3(rgbToHsl(u_p[2].xyz).xy, v));
  }
  if (u_stage == 6) { // photo filter
    vec3 o = c + (c * u_p[0].xyz - c) * u_p[0].w;
    if (u_p[1].x > 0.5) {
      float after = luma(o);
      if (after > 0.0) o = o * luma(c) / after;
    }
    return clamp(o, 0.0, 1.0);
  }
  return c;
}

float lutAt(float v, int channel) {
  vec4 e = texelFetch(u_lut, ivec2(int(floor(clamp(v, 0.0, 1.0) * 255.0 + 0.5)), 0), 0);
  return channel == 0 ? e.r : (channel == 1 ? e.g : e.b);
}

void main() {
  vec4 b = texelFetch(u_backdrop, ivec2(gl_FragCoord.xy), 0);
  if (b.a <= 0.0) {
    o_color = b;
    return;
  }
  float m = u_layerMask == 1 ? texture(u_layerMaskTile, v_uv).a : (u_layerMask == 2 ? u_layerMaskBackground : 1.0);
  if (u_hasStroke) {
    // Mask painting: coverage moves toward the target, as brush.ts applyMaskStroke.
    float a = texture(u_stroke, v_uv).a * u_brushOpacity;
    ivec2 px = min(ivec2(floor(v_uv * 256.0)), ivec2(255));
    if (u_hasGrain) a *= texelFetch(u_grain, px % 128, 0).r;
    if (u_hasMask) a *= texelFetch(u_mask, px, 0).r;
    m = mix(m, u_maskTarget, a);
  }
  float k = u_opacity * m;
  if (u_clip) {
    float cm = u_clipMask == 1 ? texture(u_clipMaskTile, v_uv).a : (u_clipMask == 2 ? u_clipMaskBackground : 1.0);
    k *= texture(u_clipTile, v_uv).a * cm * u_clipOpacity;
  }
  vec3 cb = clamp(b.rgb / b.a, 0.0, 1.0);
  vec3 c = u_hasLut ? vec3(lutAt(cb.r, 0), lutAt(cb.g, 1), lutAt(cb.b, 2)) : cb;
  c = colorStage(c);
  if (u_blendMode == 9) k = dissolveNoise(u_tileOrigin + floor(v_uv * u_tileSize)) < k ? 1.0 : 0.0; // dissolve
  vec3 blended = blendColor(u_blendMode, cb, c);
  o_color = vec4(mix(cb, blended, k) * b.a, b.a);
}
