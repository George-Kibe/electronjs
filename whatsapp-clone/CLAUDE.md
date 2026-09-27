# CLAUDE.md — WhatsappClone

@AGENTS.md

## Working notes for Claude Code

- Change protocol first. When a task touches the wire format, edit `protocol/`, rebuild it (`pnpm build`),
  then update `server/`, then `desktop/`, then `docs/04-api-protocol.md`, all in the same change.
- When you add a migration, also update `docs/05-data-model.md`.
- Local two-user testing: run `pnpm dev` twice in `desktop/` with `--profile=user1` and `--profile=user2`.
  In dev, OTP codes appear in the server console.
- Before touching anything under "Sensitive areas" in AGENTS.md, stop and describe the plan to the user first.
- The current milestone is in `docs/10-roadmap.md`. Do not build features from later milestones unless asked.
  Do keep the extension points those milestones need (for example the envelope `type` field for E2EE).
