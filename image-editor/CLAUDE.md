# CLAUDE.md — ImageEditor

@AGENTS.md

## Working notes for Claude Code

- Golden-image failures: open the generated diff PNG in `test/golden/__diff__/` (you can read images) before
  deciding. Never run `pnpm test:golden --update` just to make a test pass. Explain the visual change to
  the user and get agreement first.
- WebGL tests run in Chromium via Playwright or Electron. On headless Linux use `xvfb-run -a`. SwiftShader
  (software GL) is expected in CI. Stick to WebGL2 core plus `EXT_color_buffer_float` (RGBA16F render targets), which SwiftShader supports.
- Keep to the current milestone in `docs/10-roadmap.md`.
