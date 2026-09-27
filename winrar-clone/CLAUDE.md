# CLAUDE.md — WinrarClone

@AGENTS.md

## Working notes for Claude Code

- The engine is an external binary. When a test fails, first check that `app/vendor/7zip/<platform>-<arch>/`
  exists (`pnpm install` fetches it), and check `scripts/7zip-versions.json`.
- For parser work, capture real output with `vendor/7zip/.../7zz l -slt -ba -sccUTF-8 -- <archive>` and add
  it under `src/main/engine/__fixtures__/`. Do not hand-write expected output.
- Never weaken a rule in `src/main/safety/` to make a test pass. Stop and ask instead.
- Keep to the current milestone in `docs/10-roadmap.md`.
