# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Project-level instructions live in `whatsapp-clone/CLAUDE.md` and `winrar-clone/CLAUDE.md`. Claude Code
  loads them when you work in those folders.
- Prefer small, verifiable steps. After an edit, run the narrowest relevant check (a single test file or
  `pnpm typecheck` in that package) before running the full suite.
- When a task is ambiguous about product behavior, check `docs/01-requirements.md` first, then ask the user.
  Do not invent requirements.
- To try an Electron change, use `pnpm dev` inside the package. To run E2E, use `pnpm test:e2e`, which
  builds first. On headless Linux, wrap it with `xvfb-run -a`.
- Do not modify `image-resizer/` unless asked.
