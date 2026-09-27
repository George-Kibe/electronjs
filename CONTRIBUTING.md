# Contributing

## Prerequisites

- Node.js 24 LTS (`.nvmrc` in each package)
- pnpm 10+ (`corepack enable`)
- Git, plus the platform toolchain for native modules (Windows: VS Build Tools with C++; macOS: Xcode CLT; Linux: `build-essential`, `python3`)
- For `whatsapp-clone/server`: Docker + Docker Compose

## Workflow

1. Create an issue, or pick one. Every issue should reference a requirement ID from `docs/01-requirements.md`.
2. Branch from `main`: `feat/<project>-<short-desc>`, `fix/<project>-<short-desc>`, `docs/<desc>`.
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/) with a project scope
   (see [AGENTS.md](AGENTS.md#conventions)).
4. Open a PR using the template. CI must be green, and one approving review is required.
5. Squash-merge. The squash commit message must follow Conventional Commits, because release tooling reads it.

## Architecture changes

Any change that affects architecture, security posture, a public protocol or IPC contract, the data schema,
or adds a major dependency needs an **ADR** in the project's `docs/adr/`. Copy `0000-template.md`, number
it sequentially, and set status `Proposed`. It becomes `Accepted` when the PR merges.

## Code review checklist

- Does it match the requirement and the acceptance criteria?
- Is IPC input validated? Is the sender checked? Are there no new renderer privileges?
- Are errors handled and surfaced to the user in a way they can act on? Are failures logged without PII?
- Are there tests at the right level? Is anything flaky?
- Are docs and changelog updated?
