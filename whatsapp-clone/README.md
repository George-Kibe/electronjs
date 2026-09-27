# WhatsappClone

> Working name. It will be renamed before public release. Product name, app ID and bundle ID all live in one
> constants file per package, so a rename is a single change.

A cross-platform desktop messaging app (Windows, macOS, Linux) with its own backend. It offers:

- Phone-number sign-up with SMS one-time codes (Amazon SNS)
- 1:1 and group chat with sent / delivered / read receipts, typing indicators and presence
- Images, video, documents and voice notes
- End-to-end encryption (milestone M3)
- Voice and video calls over WebRTC (milestone M4)

This is **not** a WhatsApp client. It does not connect to WhatsApp's network.

## Packages

| Package | Path | Stack |
| --- | --- | --- |
| Desktop client | `desktop/` | Electron, electron-vite, React, TypeScript, Tailwind, Zustand, TanStack Query, SQLite (SQLCipher) |
| Server | `server/` | Node.js 24, NestJS (Fastify), Socket.IO, PostgreSQL, Redis, S3-compatible storage (MinIO), coturn |
| Protocol | `protocol/` | Shared TypeScript types + zod schemas for REST and realtime events |

## Quick start (development)

> The packages are not scaffolded yet. These commands describe the target developer experience and are
> kept up to date as the packages are built.

```bash
# 1. Infrastructure (Postgres, Redis, MinIO, coturn)
cd whatsapp-clone/server
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d

# 2. Server
pnpm install
pnpm db:migrate
pnpm dev                 # http://localhost:3000, OTP codes are printed to the console (SMS_PROVIDER=console)

# 3. Desktop (new terminal)
cd ../desktop
pnpm install
pnpm dev                 # launches Electron with HMR
# To test 2 users locally, run a second instance with its own profile:
pnpm dev -- --profile=user2
```

## Documentation

| Doc | Purpose |
| --- | --- |
| [01 Requirements](docs/01-requirements.md) | Goals, personas, functional and non-functional requirements, acceptance criteria |
| [02 Architecture](docs/02-architecture.md) | System context, containers, components, key flows |
| [03 UI/UX Design](docs/03-ui-ux-design.md) | Design system, screens, interactions, accessibility |
| [04 API & Protocol](docs/04-api-protocol.md) | REST endpoints, realtime events, error model |
| [05 Data Model](docs/05-data-model.md) | Server Postgres schema, client SQLite schema, Redis keys |
| [06 Security](docs/06-security.md) | Threat model, Electron hardening, E2EE design, abuse prevention |
| [07 Testing](docs/07-testing-strategy.md) | Test pyramid, tooling, coverage, test matrix |
| [08 CI/CD & Release](docs/08-ci-cd-release.md) | Pipelines, signing, notarization, auto-update, versioning |
| [09 Deployment & Ops](docs/09-deployment-operations.md) | VPS + Docker deployment, observability, backups, runbooks |
| [10 Roadmap](docs/10-roadmap.md) | Milestones M0–M5 and exit criteria |
| [ADRs](docs/adr/) | Architecture Decision Records |

## License

MIT. See the [root LICENSE](../LICENSE).
