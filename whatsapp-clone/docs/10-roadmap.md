# 10 — Roadmap: WhatsappClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

Durations assume one full-time developer. They are estimates to be recalibrated after M1.

| Milestone | Theme | Est. | Exit criteria |
| --- | --- | --- | --- |
| **M0** | Foundations | 2 wks | See below |
| **M1** | 1:1 messaging MVP (internal alpha) | 6–8 wks | |
| **M2** | Groups + media (closed beta) | 6 wks | |
| **M3** | End-to-end encryption | 6–8 wks | |
| **M4** | Voice & video calls | 5–6 wks | |
| **M5** | Hardening & GA | 4 wks | |

## M0 — Foundations

- [x] Requirements, architecture, design, security, testing, CI/CD and ops docs (this set)
- [ ] Decide final product name and app ID (Q1). Register the domain.
- [ ] Scaffold `protocol/` (tsup, zod, vitest), `server/` (NestJS + Fastify, Drizzle, pino, config validation), and `desktop/` (electron-vite React TS template + security baseline + IPC router)
- [ ] Docker Compose dev stack (Postgres, Redis, MinIO)
- [ ] CI: lint/type/test on 3 packages. Desktop build on Linux.
- [ ] Figma: design tokens, component library, onboarding and chat screens
- [ ] AWS account: SNS sandbox, test destination numbers verified, spend limit set

**Exit:** `pnpm dev` launches an empty, hardened app shell that talks to `/healthz`. CI is green.

## M1 — 1:1 messaging MVP

- Auth: OTP (console + SNS providers), tokens, devices, linked-devices screen (FR-AUTH-01..08)
- Profile & contact lookup (FR-PROF-01..04)
- Conversations (direct), envelope send with `enc: none`, seq, receipts, typing, presence, reply, formatting (FR-MSG-01..07, 12, 18)
- Desktop: local SQLite + outbox + sync engine, chat list, conversation view (virtualized), composer, notifications, tray, badge, theme, shortcuts, auto-update (FR-DESK-01..07)
- Deploy staging on a VPS. Signed builds for all 3 OSes.

**Exit:** T-DEL-01..05 and T-AUTH-01..03 pass. 10 internal users use it daily for 1 week with zero lost
messages. NFR-PERF-01/02 met on staging.

## M2 — Groups & media

- Groups, roles, invite links, mentions, group receipts (FR-GRP-*)
- Edit, delete-for-everyone, reactions, forward, search (FTS5), pin/archive/mute (FR-MSG-08..11, 14, 15)
- Media: images, video, docs, voice notes, gallery, auto-download, resumable uploads (FR-MED-01..09)
- Privacy settings, blocking, reporting, account deletion, data export (FR-PROF-05/06, FR-AUTH-10, FR-OPS-02/03)
- **E2EE spike:** prototype vodozemac in the main process and confirm ADR-0005.

**Exit:** closed beta with 50 users. Crash-free rate ≥ 99 %. IDOR test matrix is green.

## M3 — End-to-end encryption

- Keys module and APIs. Crypto service in desktop main.
- Olm pairwise sessions, Megolm group sessions, multi-device fan-out, including the sender's own devices
- Encrypted media (FR-MED-10). Safety numbers + QR. Key-change notices.
- Device-to-device history transfer (FR-E2E-07)
- Migration of existing chats. Server-side plaintext purge 30 days after conversion.
- External crypto review (at least of the design and integration)

**Exit:** T-E2E-01..03 pass. A DB dump of staging contains no plaintext for E2EE conversations. The review
has no open High findings.

## M4 — Calls

- coturn deployment. TURN credential API.
- 1:1 voice and video, screen share, call window, call history, ringing on multiple devices (FR-CALL-01..06)
- Group calls up to 4 (mesh), "Relay all calls" setting (FR-CALL-03, 07)
- E2EE-sealed signaling

**Exit:** calls connect in < 3 s p90 on the test matrix (same LAN, different NATs, symmetric NAT via TURN).
MOS ≥ 3.5 on a 2 Mbps link.

## M5 — Hardening & GA

- Disappearing messages, starred messages, 2FA PIN, app lock, change number (FR-MSG-16/17, FR-AUTH-09/11, FR-DESK-08)
- i18n (Swahili), accessibility audit, performance tuning to meet every NFR-PERF target
- External pentest. Privacy policy & terms. Incident response plan tested.
- Staged rollout to 100 %.

**Exit:** every "Must" requirement is done. All NFRs are verified. Pentest has no open Critical/High findings. v1.0.0 published.

## Future

Post-GA backlog:

- Mobile apps (React Native, reusing `protocol/` and the crypto design)
- SFU group calls (LiveKit or mediasoup) for up to 32 participants (FR-CALL-08)
- Encrypted group metadata, sealed sender (hide sender from the server)
- Encrypted cloud backup
- Communities/channels, Stories/Status
- Horizontal scale-out (stage S1/S2)
- Web client
