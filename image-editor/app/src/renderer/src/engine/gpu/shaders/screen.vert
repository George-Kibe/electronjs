#version 300 es
// Full-viewport quad for screen-space passes (group composite, final present).
in vec2 a_unit;

void main() {
  gl_Position = vec4(a_unit * 2.0 - 1.0, 0.0, 1.0);
}
