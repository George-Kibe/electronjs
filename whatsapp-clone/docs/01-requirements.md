# 01 — Requirements (PRD): WhatsappClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Owner | George Kibe |
| Last updated | 2026-09-27 |
| Related | [Architecture](02-architecture.md) · [Roadmap](10-roadmap.md) |

## 1. Purpose & vision

Build a production-grade, cross-platform **desktop** messaging app with its own backend. It should offer the
core WhatsApp experience: phone-number identity, fast reliable messaging, groups, media, private
(end-to-end encrypted) conversations, and voice/video calls. It is a real product that a small community,
team or organisation could run on their own server.

### 1.1 Goals

- G1: Sending and receiving messages feels instant (< 300 ms p95 on a healthy connection).
- G2: No message is lost or duplicated, even across disconnects, crashes and restarts.
- G3: Message content is private. From M3 on, the server cannot read message or media content.
- G4: The system is cheap to run: one VPS serves the first ~5,000 users.
- G5: It installs, updates and runs well on Windows, macOS and Linux.

### 1.2 Non-goals (v1)

- Mobile apps (iOS/Android). The API is designed so they can be added later. See [Roadmap](10-roadmap.md#future).
- Interoperating with WhatsApp or any other network.
- Payments, Stories/Status, Channels, Communities, bots/business API.
- Web client in a browser.
- Federation between servers.

## 2. Personas

| Persona | Description | Key needs |
| --- | --- | --- |
| **Amina — everyday user** | Chats with family and friends from a laptop at home and work | Easy sign-up, reliable notifications, send photos/docs quickly |
| **Brian — team lead** | Runs a 40-person group for his team | Group admin controls, mentions, file sharing, search |
| **Carol — privacy-conscious** | Journalist, cares who can read her messages | E2EE, safety-number verification, disappearing messages |
| **Dan — operator** | Self-hosts the server for his organisation | Simple Docker deploy, backups, monitoring, SMS cost control |

## 3. Scope overview by milestone

| Area | M1 | M2 | M3 | M4 | M5 |
| --- | --- | --- | --- | --- | --- |
| Auth (phone OTP), profile, contacts | ✅ | | | | |
| 1:1 text chat, receipts, typing, presence | ✅ | | | | |
| Groups & admin | | ✅ | | | |
| Media: images, video, docs, voice notes | | ✅ | | | |
| End-to-end encryption | | | ✅ | | |
| Voice & video calls (1:1, small group) | | | | ✅ | |
| Disappearing msgs, search polish, hardening, GA | | | | | ✅ |

## 4. Functional requirements

Priority uses MoSCoW (**M**ust / **S**hould / **C**ould). Every requirement has an ID that code, tests and
PRs reference.

### 4.1 Authentication & devices (AUTH)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-AUTH-01 | User registers or logs in with an E.164 phone number and receives a 6-digit OTP by SMS. | M | M1 |
| FR-AUTH-02 | OTP expires after 5 minutes. At most 5 verification attempts per code. | M | M1 |
| FR-AUTH-03 | OTP requests are rate-limited per number (1 per 60 s, 5 per hour, 10 per day) and per IP. | M | M1 |
| FR-AUTH-04 | Only numbers from countries on an allowlist can receive SMS (operator-configurable). | M | M1 |
| FR-AUTH-05 | After verification the desktop installation is registered as a **device**, with name and platform. | M | M1 |
| FR-AUTH-06 | Session uses a short-lived access token (15 min) and a rotating refresh token (60 days idle). | M | M1 |
| FR-AUTH-07 | User can list their linked devices and log out any device remotely. | M | M1 |
| FR-AUTH-08 | An account can have at most 5 active devices. | S | M1 |
| FR-AUTH-09 | Optional 6-digit **two-step verification PIN** is required on new-device login. | S | M5 |
| FR-AUTH-10 | User can delete their account. All server data is purged within 30 days. | M | M2 |
| FR-AUTH-11 | Changing a phone number migrates the account after verifying OTPs on both numbers. | C | M5 |

### 4.2 Profile & contacts (PROF)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-PROF-01 | User sets a display name (1–25 chars), an "about" text (0–139 chars) and an avatar (JPEG/PNG/WebP ≤ 5 MB, cropped to square). | M | M1 |
| FR-PROF-02 | User finds other users by entering a phone number. The result shows only whether the number is registered, plus their public profile. | M | M1 |
| FR-PROF-03 | Contact discovery is rate-limited (≤ 100 lookups/day/account) to prevent number enumeration. | M | M1 |
| FR-PROF-04 | User saves contacts locally with a custom name. | S | M1 |
| FR-PROF-05 | Privacy settings: who can see last seen, profile photo and about (Everyone / My contacts / Nobody), and read receipts on/off. | S | M2 |
| FR-PROF-06 | User can block/unblock a user. Blocked users cannot message, call or see presence. | M | M2 |
| FR-PROF-07 | Import contacts from a vCard/CSV file. | C | M5 |

### 4.3 Messaging (MSG)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-MSG-01 | Send and receive text messages (≤ 65,536 UTF-8 bytes) in a 1:1 conversation. | M | M1 |
| FR-MSG-02 | Messages show a status: ⏱ pending → ✓ sent (server accepted) → ✓✓ delivered (all recipient devices) → blue ✓✓ read. | M | M1 |
| FR-MSG-03 | Messages composed offline are queued locally and sent automatically when the connection returns, in order. | M | M1 |
| FR-MSG-04 | Messages are delivered exactly once from the user's point of view: no loss, no visible duplicates. | M | M1 |
| FR-MSG-05 | Typing indicator ("typing…") shows within 1 s and clears after 5 s of inactivity. | M | M1 |
| FR-MSG-06 | Presence: online / last seen, subject to privacy settings. | M | M1 |
| FR-MSG-07 | Reply (quote) to a specific message. | M | M1 |
| FR-MSG-08 | Edit your own message within 15 minutes. It shows as "edited". | S | M2 |
| FR-MSG-09 | Delete for me (any message) and Delete for everyone (own messages within 48 h). | M | M2 |
| FR-MSG-10 | Emoji reactions (one reaction per user per message). | S | M2 |
| FR-MSG-11 | Forward messages to up to 5 chats at once. Forwarded messages show a "Forwarded" label. | S | M2 |
| FR-MSG-12 | Basic formatting: `*bold*`, `_italic_`, `~strike~`, `` `mono` ``, and links detected automatically. | S | M1 |
| FR-MSG-13 | Link previews are generated **on the sender's client** (never by the server). They can be turned off. | C | M3 |
| FR-MSG-14 | Local full-text search across messages, plus search within a chat. | M | M2 |
| FR-MSG-15 | Pin up to 3 chats. Archive and mute chats (8 h / 1 week / always). | S | M2 |
| FR-MSG-16 | Disappearing messages per chat: off / 24 h / 7 d / 90 d. | S | M5 |
| FR-MSG-17 | Star messages and view the starred list. | C | M5 |
| FR-MSG-18 | Message history syncs to a newly linked device (M1–M2 from the server; from M3 see FR-E2E-07). | M | M1 |

### 4.4 Groups (GRP)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-GRP-01 | Create a group with a name (1–100 chars), optional icon and description, and 1–255 other members (256 total). | M | M2 |
| FR-GRP-02 | Roles: owner (creator), admin, member. Owner and admins add/remove members and promote/demote admins. | M | M2 |
| FR-GRP-03 | Group settings: only admins can edit info; only admins can send messages. | S | M2 |
| FR-GRP-04 | Invite link (revocable) and join by link. | S | M2 |
| FR-GRP-05 | Members can leave. System messages record joins, leaves and role changes. | M | M2 |
| FR-GRP-06 | Receipts in groups: delivered/read shown when all members have delivered/read, plus a per-member "Message info". | S | M2 |
| FR-GRP-07 | @mentions with autocomplete. A mention notifies the user even if the group is muted. | S | M2 |

### 4.5 Media & files (MED)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-MED-01 | Send images (JPEG/PNG/WebP/GIF/HEIC→JPEG) with optional caption. The client compresses them to ≤ 1600 px long edge unless "HD" is chosen. | M | M2 |
| FR-MED-02 | Send videos (MP4/MOV/WebM) up to 100 MB, with a thumbnail and duration. | M | M2 |
| FR-MED-03 | Send any document up to 100 MB. Executable types show a warning before opening. | M | M2 |
| FR-MED-04 | Record and send voice notes (Opus in WebM/Ogg) up to 15 min, with a waveform preview and playback speed 1×/1.5×/2×. | M | M2 |
| FR-MED-05 | Drag-and-drop and clipboard paste of files/images into the composer. | M | M2 |
| FR-MED-06 | Uploads and downloads show progress, can be cancelled, and resume after a network drop. | S | M2 |
| FR-MED-07 | Auto-download settings per media type (images: on; video/docs: off by default). | S | M2 |
| FR-MED-08 | Media gallery per chat (Media / Docs / Links tabs). | S | M2 |
| FR-MED-09 | The server keeps media blobs for 30 days after the last recipient device downloads them. Clients keep local copies. | M | M2 |
| FR-MED-10 | Media is encrypted client-side (AES-256-GCM with a per-file key) before upload. | M | M3 |

### 4.6 End-to-end encryption (E2E)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-E2E-01 | All 1:1 and group message content, reactions, edits and media keys are E2E-encrypted. The server only sees routing metadata. | M | M3 |
| FR-E2E-02 | Each device has its own identity key. Messages are encrypted separately to every device of every participant, including the sender's other devices. | M | M3 |
| FR-E2E-03 | Forward secrecy and post-compromise security for 1:1 (Double Ratchet or equivalent). | M | M3 |
| FR-E2E-04 | Efficient group encryption with sender keys. Keys rotate when membership changes. | M | M3 |
| FR-E2E-05 | Safety number / QR code verification between two users. The chat warns when a contact's identity key changes. | M | M3 |
| FR-E2E-06 | The client marks each chat as encrypted. There is no way to send unencrypted messages in an E2EE chat. | M | M3 |
| FR-E2E-07 | Linking a new device: history transfers **device-to-device** (encrypted) from an existing device. If no other device is online, the new device starts with an empty history. | S | M3 |
| FR-E2E-08 | Local encrypted backup/export of chats, protected with a user passphrase. | C | M5 |

### 4.7 Calls (CALL)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-CALL-01 | 1:1 voice call. The call rings on all of the callee's online devices, and the first to answer wins. | M | M4 |
| FR-CALL-02 | 1:1 video call, with camera switch, mute, camera off and screen share. | M | M4 |
| FR-CALL-03 | Group voice/video calls of up to 4 participants (mesh). | S | M4 |
| FR-CALL-04 | Call connects through NAT using STUN, with fallback to TURN relay (coturn). | M | M4 |
| FR-CALL-05 | Call signaling (offer/answer/ICE) is E2E-encrypted like messages. Media uses DTLS-SRTP. | M | M4 |
| FR-CALL-06 | Call history per chat (missed, incoming, outgoing, duration). | M | M4 |
| FR-CALL-07 | Setting "Relay all calls" hides the user's IP from peers by forcing TURN. | S | M4 |
| FR-CALL-08 | Group calls of up to 32 participants via an SFU. | C | Future |

### 4.8 Notifications & desktop integration (DESK)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-DESK-01 | Native OS notifications for new messages and calls, with sender, preview (configurable: show/hide content) and inline reply where the OS supports it. | M | M1 |
| FR-DESK-02 | Unread badge count on the dock/taskbar icon. | M | M1 |
| FR-DESK-03 | Tray/menu-bar icon. Closing the window keeps the app running in the tray (configurable). | M | M1 |
| FR-DESK-04 | Start on login (opt-in). | S | M1 |
| FR-DESK-05 | Light/dark/system theme. Font size small/medium/large. | M | M1 |
| FR-DESK-06 | Keyboard shortcuts (see [UI/UX §7](03-ui-ux-design.md#7-keyboard-shortcuts)). | S | M1 |
| FR-DESK-07 | Auto-update with a "restart to update" prompt. Updates are signed. | M | M1 |
| FR-DESK-08 | Optional app lock with an OS-level check (Windows Hello / Touch ID) or a passcode after idle. | C | M5 |
| FR-DESK-09 | Spell check with the OS dictionaries. | S | M2 |
| FR-DESK-10 | Localization-ready (i18n keys). English at launch, Swahili as the first extra locale. | S | M5 |

### 4.9 Administration & operations (OPS)

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-OPS-01 | Operator config via environment variables: SMS country allowlist, rate limits, retention, max devices, and so on. | M | M1 |
| FR-OPS-02 | Users can report a user or message. The report includes the reported messages the reporter chooses to share (in E2EE, the reporter's client sends the plaintext). | S | M2 |
| FR-OPS-03 | Operator CLI: ban/unban user, revoke devices, view SMS spend, view reports. | S | M2 |
| FR-OPS-04 | Health, readiness and Prometheus metrics endpoints. | M | M1 |

## 5. Non-functional requirements

### 5.1 Performance (PERF)

| ID | Requirement |
| --- | --- |
| NFR-PERF-01 | Message send → recipient display latency < 300 ms p95 and < 1 s p99 (same region, both online). |
| NFR-PERF-02 | Cold start to usable chat list < 2.5 s on a mid-range laptop (4 cores, 8 GB, SSD). |
| NFR-PERF-03 | A chat with 100k messages scrolls at 60 fps (virtualized list). Opening a chat takes < 150 ms. |
| NFR-PERF-04 | Idle memory < 350 MB RSS (all Electron processes). Idle CPU < 1 %. |
| NFR-PERF-05 | Server handles 5,000 concurrent sockets and 200 msgs/s on 1 VPS with 4 vCPU / 8 GB RAM. |
| NFR-PERF-06 | Local search returns results in < 200 ms for 100k messages (SQLite FTS5). |

### 5.2 Reliability (REL)

| ID | Requirement |
| --- | --- |
| NFR-REL-01 | Server monthly availability ≥ 99.5 % (single-VPS target). ≥ 99.9 % after scale-out. |
| NFR-REL-02 | Zero acknowledged-message loss: a message the server has acked (✓) survives a server crash (durable write before ack). |
| NFR-REL-03 | The client reconnects with exponential backoff and jitter (1 s → 30 s max) and resyncs missed messages via cursor. |
| NFR-REL-04 | Backups: Postgres PITR with RPO ≤ 15 min and RTO ≤ 4 h. Backups are tested monthly. |
| NFR-REL-05 | Crash-free sessions ≥ 99.5 % (desktop). |

### 5.3 Security & privacy (SEC)

| ID | Requirement |
| --- | --- |
| NFR-SEC-01 | All traffic uses TLS 1.2+ (TLS 1.3 preferred), with HSTS on API domains. |
| NFR-SEC-02 | Electron hardening baseline met ([Security §4](06-security.md#4-electron-hardening)). Electronegativity scan is clean in CI. |
| NFR-SEC-03 | Local database is encrypted at rest (SQLCipher). The key is stored with OS secure storage (`safeStorage`). |
| NFR-SEC-04 | No PII or message content in server logs. Phone numbers in logs are masked (`+2547******89`). |
| NFR-SEC-05 | Before M3: server-side message content is encrypted at rest (disk/volume encryption). From M3: the server stores only ciphertext. |
| NFR-SEC-06 | OWASP ASVS v4 Level 2 controls apply to the API. |
| NFR-SEC-07 | Dependencies are scanned (Dependabot, `pnpm audit`, Trivy on images). No known Critical/High issues at release. |
| NFR-SEC-08 | Privacy: GDPR/Kenya Data Protection Act 2019 principles apply: data minimisation, export, deletion. |

### 5.4 Usability & accessibility (UX)

| ID | Requirement |
| --- | --- |
| NFR-UX-01 | WCAG 2.2 AA: contrast, full keyboard navigation, screen-reader labels, visible focus. |
| NFR-UX-02 | Supports window widths from 760 px (single-pane mode) to 4K. HiDPI assets. |
| NFR-UX-03 | Every error message says what happened and what the user can do next. |

### 5.5 Compatibility (COMP)

| ID | Requirement |
| --- | --- |
| NFR-COMP-01 | Windows 10 22H2+ and 11 (x64, arm64). macOS 12+ (Intel and Apple Silicon). Ubuntu 22.04+/Fedora 40+ (x64, arm64). |
| NFR-COMP-02 | The protocol is versioned. The server supports the current and previous protocol major versions for ≥ 90 days. |
| NFR-COMP-03 | The server refuses clients below `MIN_CLIENT_VERSION` with a clear "Please update" error. |

### 5.6 Maintainability & operability (MAINT)

| ID | Requirement |
| --- | --- |
| NFR-MAINT-01 | Test coverage: ≥ 80 % lines on server services and protocol, ≥ 70 % on desktop main-process services. |
| NFR-MAINT-02 | Structured JSON logs (pino) with request/trace IDs. OpenTelemetry traces. |
| NFR-MAINT-03 | One-command local setup (Docker Compose). One-command deploy. |
| NFR-MAINT-04 | Zero-downtime deploys for the API (rolling restart behind Caddy, socket reconnect tolerated). |

### 5.7 Cost (COST)

| ID | Requirement |
| --- | --- |
| NFR-COST-01 | Infrastructure ≤ US$60/month for up to 5k MAU, excluding SMS. |
| NFR-COST-02 | SMS spend is capped with an AWS SNS monthly spend limit plus an app-level daily budget alarm. |

## 6. Key user stories & acceptance criteria

**US-01 Sign up (FR-AUTH-01..05)**
- *Given* I enter a valid phone number from an allowed country, *when* I tap "Next", *then* I receive an SMS
  code within 30 s and see a 6-box code input with a 60 s resend timer.
- *Given* I enter the right code, *then* I land on profile setup (new user) or the chat list (existing user)
  and my device appears in "Linked devices".
- *Given* I enter a wrong code 5 times, *then* the code is invalidated and I must request a new one.

**US-02 Send a message offline (FR-MSG-02/03/04)**
- *Given* I am offline, *when* I send "hello", *then* it appears immediately with a ⏱ icon.
- *When* the connection returns, *then* it is sent automatically, the icon changes to ✓, and the recipient
  sees it exactly once, even if the send was retried.

**US-03 Read receipts (FR-MSG-02, FR-PROF-05)**
- *Given* the recipient opens the chat with my message visible, *then* my ticks turn blue within 1 s.
- *Given* either of us has read receipts turned off, *then* ticks stay grey for both directions.

**US-04 Group admin (FR-GRP-02)**
- *Given* I am an admin, *when* I remove a member, *then* they can no longer read new messages, and all
  members see "Brian removed Carol".

**US-05 Verify safety number (FR-E2E-05)**
- *Given* I open a contact's encryption info, *then* I see a 60-digit safety number and a QR code. Scanning
  or comparing marks the contact "Verified". If their key changes later, I see a warning in the chat.

**US-06 Voice call (FR-CALL-01/04)**
- *Given* the callee is online on 2 devices, *when* I call, *then* both ring. Answering on one stops the
  other. Audio connects in < 3 s p90, including when one side is behind symmetric NAT (via TURN).

## 7. Constraints & assumptions

- A single developer or small team builds this. The architecture favours boring, well-documented tech.
- AWS SNS SMS requires origination identities and sender-ID registration in some countries. Kenya and many
  other markets need sender-ID pre-registration. The SNS account starts in the **SMS sandbox** and must
  request production access.
- A desktop app cannot receive push notifications while it is not running. Delivery happens when the app
  next connects (running in the tray by default mitigates this).
- Before M3, the operator can technically read messages stored on the server. The UI must say so honestly
  (no "encrypted" claims before M3).

## 8. Open questions

| # | Question | Owner | Due |
| --- | --- | --- | --- |
| Q1 | Final product name, app ID (`com.<org>.<app>`), domain | George | Before M1 release |
| Q2 | Which countries go on the SMS allowlist at launch? | George | M1 |
| Q3 | E2EE library choice: vodozemac vs libsignal (licensing), see ADR-0005 | Eng | Before M3 start |
| Q4 | Do we need a web client or mobile app in the next 12 months? This affects the multi-device design. | George | M2 |
| Q5 | Data residency requirements (EU/Kenya) for the VPS location? | George | M1 |

## 9. Glossary

- **Device:** one installation of the desktop app linked to an account.
- **Envelope:** the unit the server routes: header (routing metadata) plus payload (plaintext before M3, ciphertext after).
- **seq:** a per-conversation, server-assigned, strictly increasing sequence number.
- **OTP:** one-time password sent by SMS.
- **TURN/STUN:** NAT-traversal servers for WebRTC.
- **SFU:** Selective Forwarding Unit, a media server for larger group calls.
