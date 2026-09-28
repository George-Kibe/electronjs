# AGENTS.md — repository-wide instructions for AI coding agents

This file is read by AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.). Each project folder has
its own `AGENTS.md` with more specific rules; **the nearest `AGENTS.md` to the file you are editing wins.**

## Repository shape

- This is **not** a monorepo workspace. `image-editor/app`, `whatsapp-clone/*` and `winrar-clone/app` are
  independent packages, each with its own `package.json` and lockfile. Always `cd` into the package before
  installing or running scripts.
- `whatsapp-clone/` contains three packages: `desktop/`, `server/`, `protocol/`. `desktop` and `server`
  depend on `protocol` through a `file:../protocol` dependency.
- `image-editor/` replaced the old `image-resizer` learning project (its code is in git history at `3eadc27`).

## Before you write code

1. Read the project's `docs/01-requirements.md` and `docs/02-architecture.md` sections that relate to the task.
2. Check `docs/adr/` for accepted decisions. Do not contradict an accepted ADR. If a task needs a different
   decision, write a new ADR (status `Proposed`) and flag it to the human.
3. Find the requirement ID (for example `FR-MSG-03`) the change implements and reference it in the commit or PR.

## Non-negotiable rules

- **Electron security baseline** (see each project's `docs/06-security.md`): `contextIsolation: true`,
  `sandbox: true`, `nodeIntegration: false`, strict CSP, no `remote` module, all IPC goes through a typed
  preload bridge, and every IPC handler validates its input with zod and checks the sender frame.
- The renderer never gets Node.js APIs, filesystem access, raw tokens, or child-process access.
- Never commit secrets, `.env` files, signing certificates, or test phone numbers that belong to real people.
- Never disable, skip or delete a failing test to make CI pass. Fix the cause or ask.
- Never add a dependency without checking its license (MIT/Apache-2.0/BSD/ISC/LGPL-dynamic are OK;
  GPL/AGPL need an ADR) and its maintenance status.
- Never use the trademarks "WhatsApp", "WinRAR" or "Photoshop" in user-facing strings, icons, bundle IDs or metadata.
  Use the product-name constants.

## Conventions

- TypeScript `strict: true`, no `any` unless justified with a comment. ESM only.
- Files: `kebab-case.ts`. React components: `PascalCase.tsx`. Tests go next to code as `*.test.ts(x)`, or under `e2e/`.
- Commits: Conventional Commits with a project scope, e.g. `feat(whatsapp-desktop): add typing indicator`,
  `fix(winrar-app): reject symlink escapes`. Scopes: `image-editor`, `whatsapp-desktop`,
  `whatsapp-server`, `whatsapp-protocol`, `winrar-app`, `docs`, `ci`, `repo`.
- Keep PRs small and scoped to one project where possible.

## Definition of done (every change)

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass in each touched package.
- [ ] New behavior has tests (unit, plus E2E for user-visible flows).
- [ ] Docs are updated if behavior, API, IPC or data model changed (docs live next to code, in the same PR).
- [ ] `CHANGELOG.md` has an entry under `Unreleased` for user-visible changes.
- [ ] No new Electron security warnings, and no new lint suppressions without a reason.
