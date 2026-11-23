// Blend modes on gamma-encoded sRGB (ADR-0004). Formula source: W3C Compositing and Blending Level 1,
// §10.2 (separable modes), §10.3 (non-separable: Hue, Saturation, Color, Luminosity) and §5 (the general
// compositing formula with backdrop alpha). Linear Dodge and Dissolve follow Photoshop.
// Must stay identical to engine/doc/blend.ts; mode indices follow SHADER_ORDER there.

float screenB(float cb, float cs) { return cb + cs - cb * cs; }

float hardLightB(float cb, float cs) { return cs <= 0.5 ? cb * 2.0 * cs : screenB(cb, 2.0 * cs - 1.0); }

float softLightB(float cb, float cs) {
  if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cb + (2.0 * cs - 1.0) * (d - cb);
}

float blendChannel(int mode, float cb, float cs) {
  if (mode == 1) return min(cb, cs);          // darken
  if (mode == 2) return cb * cs;              // multiply
  if (mode == 3) return max(cb, cs);          // lighten
  if (mode == 4) return screenB(cb, cs);      // screen
  if (mode == 5) return hardLightB(cs, cb);   // overlay (hard light, layers swapped)
  if (mode == 6) return softLightB(cb, cs);   // soft light
  if (mode == 7) return hardLightB(cb, cs);   // hard light
  if (mode == 8) return abs(cb - cs);         // difference
  if (mode == 10) return cb >= 1.0 ? 1.0 : (cs <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb) / cs)); // color burn
  if (mode == 11) return cb <= 0.0 ? 0.0 : (cs >= 1.0 ? 1.0 : min(1.0, cb / (1.0 - cs)));       // color dodge
  if (mode == 12) return min(1.0, cb + cs);   // linear dodge (add)
  if (mode == 13) return cb + cs - 2.0 * cb * cs; // exclusion
  return cs;                                  // normal (and dissolve, drawn as normal)
}

float lumOf(vec3 c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }

vec3 setLum(vec3 c, float l) {
  c += l - lumOf(c);
  float L = lumOf(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0 && L - n > 0.0) c = L + (c - L) * L / (L - n);
  if (x > 1.0 && x - L > 0.0) c = L + (c - L) * (1.0 - L) / (x - L);
  return c;
}

vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  return mx > mn ? (c - mn) * (s / (mx - mn)) : vec3(0.0);
}

float satOf(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

// B(Cb, Cs) for a whole colour: separable per channel, or one of the §10.3 modes.
vec3 blendColor(int mode, vec3 cb, vec3 cs) {
  if (mode == 14) return setLum(setSat(cs, satOf(cb)), lumOf(cb)); // hue
  if (mode == 15) return setLum(setSat(cb, satOf(cs)), lumOf(cb)); // saturation
  if (mode == 16) return setLum(cs, lumOf(cb));                    // color
  if (mode == 17) return setLum(cb, lumOf(cs));                    // luminosity
  return vec3(blendChannel(mode, cb.r, cs.r), blendChannel(mode, cb.g, cs.g), blendChannel(mode, cb.b, cs.b));
}

// Dissolve's noise for a document pixel (as blend.ts dissolveNoise: the top 24 bits are exact in float).
float dissolveNoise(vec2 docPx) {
  ivec2 p = ivec2(floor(docPx));
  uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h >> 8u) / 16777216.0;
}

// Dissolve (mode 9): the premultiplied source shows at full strength with probability αs, else not at all.
vec4 dissolve(vec4 s, vec2 docPx) {
  return s.a > 0.0 && dissolveNoise(docPx) < s.a ? s / s.a : vec4(0.0);
}

// Premultiplied source `s` over premultiplied backdrop `b` with blend mode `mode`.
vec4 compositeOver(int mode, vec4 b, vec4 s) {
  if (s.a <= 0.0) return b;
  vec3 cs = s.rgb / s.a;
  vec3 mixed = cs;
  if (mode != 0 && b.a > 0.0) {
    vec3 cb = b.rgb / b.a;
    mixed = (1.0 - b.a) * cs + b.a * blendColor(mode, cb, cs);
  }
  return vec4(mixed * s.a + b.rgb * (1.0 - s.a), s.a + b.a * (1.0 - s.a));
}
