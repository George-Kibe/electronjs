# AGENTS.md — WhatsappClone

The root [`AGENTS.md`](../AGENTS.md) also applies to this project. The rules here are more specific and win
where they conflict.

## Map

```
whatsapp-clone/
├── protocol/   # Source of truth for wire formats. Change this FIRST, then server, then desktop.
├── server/     # NestJS modules: auth, users, devices, conversations, messages, media, calls, keys, presence
├── desktop/
│   ├── src/main/       # Electron main process: windows, tray, notifications, secure storage, SQLite, socket
│   ├── src/preload/    # contextBridge API. The ONLY surface the renderer can call.
│   └── src/renderer/   # React UI. No Node APIs. Talks to main via window.api only.
└── docs/
```

## Commands (run inside the package)

| Package | Install | Dev | Test | E2E | Lint/Types |
| --- | --- | --- | --- | --- | --- |
| protocol | `pnpm i` | `pnpm build --watch` | `pnpm test` | — | `pnpm lint && pnpm typecheck` |
| server | `pnpm i` | `docker compose -f docker-compose.dev.yml up -d && pnpm dev` | `pnpm test` (unit), `pnpm test:int` (Testcontainers) | `pnpm test:e2e` | same |
| desktop | `pnpm i` | `pnpm dev` | `pnpm test` | `pnpm test:e2e` (Playwright `_electron`) | same |

## Architecture rules

1. **Protocol first.** Every REST body and socket event has a zod schema in `protocol/`. Server and desktop
   import from it. Never hand-write a payload type in server or desktop.
2. **The network lives in main.** The socket connection, HTTP client, tokens and SQLite live in the main
   process. The renderer gets data through `window.api` (invoke/subscribe). This keeps tokens away from web content.
3. **Messages are envelopes.** A message payload is always `{ type, ciphertext | body, ... }` as defined in
   `protocol/`. Do not add plaintext-only fields on the server that would block E2EE (see ADR-0004).
4. **Idempotency.** Clients generate message IDs (UUIDv7). The server de-duplicates on `(sender_device_id, client_msg_id)`.
5. **Ordering.** The server assigns a monotonic `seq` per conversation. Clients sort by `seq`, never by
   timestamps. Pending local messages sort last.
6. **No business logic in gateways/controllers.** Put it in services. Gateways and controllers validate,
   authorize and delegate.
7. **Server authorization.** Every query that touches conversation data must filter by membership. Use the
   `ConversationAccessGuard`. Never trust IDs from the client.

## Sensitive areas (ask a human before changing)

- `server/src/auth/**` (OTP, tokens, rate limits)
- `server/src/keys/**` and `desktop/src/main/crypto/**` (E2EE)
- `desktop/src/main/security/**` (CSP, navigation guards, permission handlers)
- Database migrations that drop or rewrite data

## Testing expectations

- Server services: unit tests with mocked repos. Repositories and gateways: integration tests against real
  Postgres and Redis through Testcontainers.
- Protocol: schema round-trip tests plus backward-compatibility fixtures (`protocol/fixtures/v*`).
- Desktop: component tests (Vitest + Testing Library). Main-process services get unit tests. Critical
  journeys get Playwright E2E against a local server.
- Never talk to real AWS SNS in tests. Use `SMS_PROVIDER=console` or the in-memory fake.
