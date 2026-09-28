// Separable blend modes on gamma-encoded sRGB (ADR-0004). Formula source: W3C Compositing and Blending
// Level 1, §10.2 (separable modes) and §5 (general compositing formula with backdrop alpha).
// Must stay identical to engine/doc/blend.ts; mode indices follow IMPLEMENTED_BLEND_MODES there.

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
  return cs;                                  // normal
}

// Premultiplied source `s` over premultiplied backdrop `b` with blend mode `mode`.
vec4 compositeOver(int mode, vec4 b, vec4 s) {
  if (s.a <= 0.0) return b;
  vec3 cs = s.rgb / s.a;
  vec3 mixed = cs;
  if (mode != 0 && b.a > 0.0) {
    vec3 cb = b.rgb / b.a;
    vec3 blended = vec3(blendChannel(mode, cb.r, cs.r), blendChannel(mode, cb.g, cs.g), blendChannel(mode, cb.b, cs.b));
    mixed = (1.0 - b.a) * cs + b.a * blended;
  }
  return vec4(mixed * s.a + b.rgb * (1.0 - s.a), s.a + b.a * (1.0 - s.a));
}
