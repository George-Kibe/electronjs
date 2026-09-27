# 07 — Testing & QA Strategy: WhatsappClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

## 1. Goals

- Catch regressions in message delivery, auth and crypto before they ship. These are the areas where bugs
  lose data or leak it.
- Keep the PR feedback loop under 10 minutes. Run slower suites nightly.
- Make each test layer own a clear kind of risk, so we don't test the same thing three times.

## 2. Test pyramid

```
                 ▲  Manual exploratory + release checklist (per release, 3 OSes)
                ▲▲  E2E desktop (Playwright + Electron) against a real local server   ~30 journeys
              ▲▲▲▲  Server E2E (HTTP + socket clients, full stack in Docker)          ~80 scenarios
           ▲▲▲▲▲▲▲  Integration (Testcontainers: Postgres, Redis, MinIO)               ~300
      ▲▲▲▲▲▲▲▲▲▲▲▲  Unit (services, reducers, crypto wrappers, components)            ~1500+
```

| Layer | Tooling | Scope | Runs |
| --- | --- | --- | --- |
| Unit: protocol | Vitest, fast-check | Schemas, (de)serialization, fixtures of supported versions | PR |
| Unit: server | Vitest (or Jest via Nest testing module), mocks | Services, guards, rate-limit logic, OTP logic | PR |
| Unit: desktop main | Vitest (node env) | Outbox, sync engine, backoff, IPC validation, migrations (in-memory SQLite) | PR |
| Unit: renderer | Vitest + Testing Library + jsdom | Components, hooks, formatting, a11y (`vitest-axe`) | PR |
| Integration: server | Vitest + Testcontainers | Repositories, seq assignment under concurrency, gateways with real Socket.IO clients | PR |
| Contract | Protocol fixtures + OpenAPI diff (`oasdiff`) | Breaking-change detection | PR |
| E2E: server | Vitest + `socket.io-client` + Docker Compose | Multi-user scenarios, reconnect, sync, groups, media upload | PR (smoke) / nightly (full) |
| E2E: desktop | Playwright `_electron` + local server + `SMS_PROVIDER=fake` | Critical user journeys across 2 app instances | PR (smoke, Linux) / nightly (3 OS) |
| Visual regression | Playwright screenshots (light/dark) | Key screens | Nightly |
| Performance | k6 (server, WebSocket), Playwright traces + `performance.mark` (desktop) | NFR-PERF-* budgets | Nightly + before release |
| Chaos/resilience | Toxiproxy between client and server | Latency, drops, partitions → no loss/dup | Nightly |
| Security | See [Security §10](06-security.md#10-security-testing) | | PR / weekly |

## 3. Critical scenarios (must never regress)

| ID | Scenario | Layer |
| --- | --- | --- |
| T-DEL-01 | 1,000 messages sent while the socket randomly drops (Toxiproxy) → recipient has exactly 1,000, in order | Server E2E + chaos |
| T-DEL-02 | Same `clientMsgId` sent 3× concurrently from 3 sockets → one envelope, 3 identical acks | Integration |
| T-DEL-03 | 50 concurrent senders in one group → `seq` strictly increasing, no gaps | Integration |
| T-DEL-04 | App killed after local insert but before ack → message sent on restart, no duplicate | Desktop E2E |
| T-DEL-05 | Recipient offline 7 days, 5k messages queued → full sync via paginated `sync.pull` | Server E2E |
| T-AUTH-01 | OTP brute force → blocked after 5 attempts. Rate limits enforced per number/IP/prefix. | Integration |
| T-AUTH-02 | Refresh token reuse → family revoked, all sessions of that device logged out | Integration |
| T-AUTH-03 | Revoked device → socket disconnected within 2 s, REST 401 | Server E2E |
| T-AUTHZ-01 | IDOR matrix: every conversation/media endpoint and socket event called by a non-member → 403/404 | Integration (generated) |
| T-E2E-01 | Server DB dump contains no plaintext for E2EE conversations (grep for a known canary string) | Server E2E (M3) |
| T-E2E-02 | Removed group member cannot decrypt messages sent after removal | Desktop main integration (M3) |
| T-E2E-03 | Identity key change produces a warning and resets verification | Desktop E2E (M3) |
| T-SEC-01 | Message containing `<img src=x onerror=…>`, `javascript:` links and RTL override chars renders inertly | Renderer unit + desktop E2E |
| T-SEC-02 | BrowserWindow options match the hardening baseline | Desktop unit |
| T-CALL-01 | 1:1 call connects via TURN only (`iceTransportPolicy: 'relay'`) | Desktop E2E (M4), fake media devices |

## 4. Desktop E2E approach

- Playwright launches the built app (`out/main/index.js`) with `electron.launch({ args: [..., '--profile=e2e-a'] })`.
  Two instances simulate two users.
- The server runs from `docker compose -f docker-compose.test.yml` with `SMS_PROVIDER=fake`. The fake provider
  exposes `GET /__test/otp/{phone}` (enabled only when `NODE_ENV=test`) so tests read the code.
- Fake media for calls: Chromium flags `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`.
- Linux CI runs under `xvfb-run`. macOS and Windows run natively on GitHub runners (nightly).
- Page objects live in `desktop/e2e/pages/*`. Tests use `data-testid` attributes, never CSS classes.

## 5. Test data & environments

| Env | Purpose | Data |
| --- | --- | --- |
| Local | Development | Seed script: 5 users, 20 chats, media samples (`pnpm db:seed`) |
| CI | Automated tests | Ephemeral containers, created and destroyed per job |
| Staging | Pre-release validation, DAST, soak | Synthetic users only. SNS in sandbox mode with verified test numbers. |
| Production | — | No testing against production, apart from post-deploy smoke (health + synthetic login using a test account on a reserved number range with a fake SMS route) |

Rule: tests never use real people's phone numbers. Use the ITU/Ofcom reserved fiction ranges (for example
`+44 7700 900xxx`), or numbers the fake SMS provider accepts.

## 6. Coverage & quality gates

| Package | Line coverage gate | Notes |
| --- | --- | --- |
| protocol | 90 % | |
| server (services, guards) | 80 % | Controllers/gateways are covered by integration tests |
| desktop main | 70 % (crypto 90 %) | |
| desktop renderer | 60 % | Behaviour-focused. Snapshot tests are discouraged. |

PR gates: lint, typecheck, unit, integration, protocol contract, server E2E smoke, desktop E2E smoke (Linux),
CodeQL, dependency audit. Everything must pass. **Flaky tests are bugs.** Fix them or quarantine them with
an owner and a 7-day deadline, tracked in an issue. They are never silently skipped.

## 7. Performance budgets (checked nightly)

| Metric | Budget | How |
| --- | --- | --- |
| Send → receive p95 | < 300 ms | k6 WebSocket script, 5k virtual sockets, 200 msg/s |
| Server CPU at the above load | < 70 % of 4 vCPU | Prometheus |
| Desktop cold start to chat list | < 2.5 s | Playwright + `app.getAppMetrics()` + marks |
| Open 100k-message chat | < 150 ms | Seeded DB fixture |
| Idle memory | < 350 MB | `app.getAppMetrics()` summed |
| Installer size | < 120 MB (per OS/arch) | CI artifact size check |

## 8. Release QA checklist (manual, per release, each OS)

- [ ] Fresh install → onboarding → send/receive with another account
- [ ] Upgrade from the previous version (auto-update) → data intact, migrations applied
- [ ] Notifications: message, mention in muted group, call. Inline reply works.
- [ ] Tray behaviour and start-on-login toggle
- [ ] Media: send/receive image, video, doc, voice note. Open a doc externally.
- [ ] Offline → online: queued messages send
- [ ] Calls (M4+): voice, video, screen share, over TURN
- [ ] Accessibility spot check: keyboard-only flow, screen reader (NVDA / VoiceOver / Orca) on the chat list and a message
- [ ] Uninstall leaves no running processes. The "remove data" option wipes the profile.
