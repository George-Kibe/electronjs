# 06 — Security & Threat Model: WhatsappClone

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |
| Related | [Architecture](02-architecture.md) · [SECURITY.md](../../SECURITY.md) · [ADR-0003](adr/0003-phone-otp-via-amazon-sns.md) · [ADR-0005](adr/0005-e2ee-library-choice.md) |

## 1. Assets

| Asset | Sensitivity |
| --- | --- |
| Message and media content | Critical |
| E2EE private keys (identity, sessions) | Critical |
| Refresh/access tokens | High |
| Social graph metadata (who talks to whom, when) | High |
| Phone numbers | High (PII) |
| Signing keys (code signing, update signing, JWT keys, TURN secret) | Critical |
| Service availability | Medium |

## 2. Trust boundaries & adversaries

```
[Renderer (untrusted content)] ─IPC─ [Main process] ─TLS─ [Caddy] ─ [API] ─ [Postgres/Redis/MinIO]
                                           │                       │
                                   [OS keychain]             [Amazon SNS]
```

| Adversary | Capabilities | Main concerns |
| --- | --- | --- |
| A1 Network attacker | Observe or modify traffic, rogue Wi-Fi | MITM, token theft, IP exposure in calls |
| A2 Malicious user | Valid account, crafted payloads | XSS in renderer via message content, IDOR, spam, SMS pumping, enumeration |
| A3 Compromised or curious server operator | Full DB/server access | Reading messages (mitigated from M3), key substitution (MITM) |
| A4 Local malware or thief with disk access | Reads the user profile directory | Stealing DB/tokens |
| A5 Supply-chain attacker | Malicious npm package, compromised CI | Code execution in app or build |
| A6 Update attacker | Serves a fake update | Code execution on all clients |

## 3. STRIDE analysis (selected)

| # | Threat | Component | Mitigation | Req |
| --- | --- | --- | --- | --- |
| S1 | Spoofing: OTP brute force | auth | 6 digits, 5 attempts per code, argon2id-hashed code, per-number/IP limits, 5-min TTL | FR-AUTH-02/03 |
| S2 | Spoofing: SIM swap / SMS interception | auth | Optional 2FA PIN. New-device login notifies existing devices. Identity key change warnings (M3). | FR-AUTH-09, FR-E2E-05 |
| S3 | Spoofing: stolen refresh token | auth | Rotation with reuse detection (revoke family). Stored in safeStorage. Bound to deviceId. | FR-AUTH-06 |
| T1 | Tampering: modify messages in transit | net | TLS 1.3. From M3, AEAD per message. | NFR-SEC-01 |
| T2 | Tampering: malicious update | updates | Code-signed builds. electron-updater verifies signature and hash. HTTPS only. | FR-DESK-07 |
| R1 | Repudiation: deny admin actions | server | audit_log for auth, devices, bans, group admin actions | |
| I1 | Info disclosure: XSS in renderer via message text | renderer | Render text as text (React escapes). Markdown parser outputs only a fixed element whitelist. No `dangerouslySetInnerHTML`. Strict CSP. | NFR-SEC-02 |
| I2 | Info disclosure: IDOR on conversations/media | server | Membership guard on every query. Media access table. Presigned URLs with short TTL. | |
| I3 | Info disclosure: number enumeration | users/auth | Lookup rate limits. Uniform OTP response. Anomaly alerts. | FR-PROF-03 |
| I4 | Info disclosure: link previews leak IP/URLs | client | Sender-side previews, opt-out. The server never fetches URLs. | FR-MSG-13 |
| I5 | Info disclosure: IP leak in P2P calls | calls | "Relay all calls" option. Contacts-only calls (M5). | FR-CALL-07 |
| I6 | Info disclosure: PII in logs | server/desktop | pino redaction. Phone masking. Content never logged. | NFR-SEC-04 |
| D1 | DoS: socket floods, large payloads | server | Per-socket event rate limit, payload caps (128 KB envelope), Caddy connection limits | |
| D2 | DoS: SMS budget exhaustion | auth | See §7 | NFR-COST-02 |
| E1 | Elevation: renderer escape → Node | desktop | Sandbox, contextIsolation, no nodeIntegration, IPC validation, fuses | §4 |
| E2 | Elevation: malicious file opened from chat | desktop | Warn on executable types. `shell.openPath` only for downloaded files inside the media dir. Mark-of-the-Web on Windows. | FR-MED-03 |

## 4. Electron hardening

Mandatory settings (checked by a unit test that inspects `BrowserWindow` options, plus Electronegativity in CI):

```ts
new BrowserWindow({
  webPreferences: {
    preload: join(__dirname, '../preload/index.mjs'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: true,
  },
});
```

- **Content Security Policy** (production), set through `session.webRequest.onHeadersReceived` and a `<meta>` tag:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: wcmedia:; media-src 'self' blob: wcmedia:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`.
  The renderer makes no network requests. Media is served to it through a custom privileged protocol
  `wcmedia://`, registered in main, which serves only files from the profile's media directory after path
  normalization.
- **Navigation:** `will-navigate` and `will-redirect` are always prevented. `setWindowOpenHandler` denies
  everything and opens `https:` links in the OS browser after the user confirms ("Open link to example.com?").
- **Permissions:** `session.setPermissionRequestHandler` allows only `media` (mic/camera, in call flows),
  `notifications`, `clipboard-sanitized-write` and `display-capture`. Everything else is denied.
  `setPermissionCheckHandler` mirrors this.
- **IPC:** every `ipcMain.handle` goes through `IpcRouter`, which:
  1. checks that `event.senderFrame.url` matches the app origin (`file://…/index.html`, or the dev server in dev),
  2. validates arguments with the zod schema for that channel,
  3. never forwards arbitrary objects to Node APIs (no generic "fs.read" style channels).
- **Electron Fuses** (set by `@electron/fuses` in the build): `RunAsNode=false`,
  `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`,
  `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`, `EnableCookieEncryption=true`,
  `GrantFileProtocolExtraPrivileges=false`.
- **Updates:** keep Electron within the 3 supported majors. A Renovate PR for each Electron security release
  is merged within 7 days.
- **DevTools:** disabled in production builds unless the app starts with `--enable-devtools` and a
  diagnostics flag is set in settings.

## 5. Authentication & session security

- OTP: `crypto.randomInt(0, 1_000_000)`, zero-padded. Stored as argon2id (m=19 MiB, t=2, p=1), with a max of
  5 attempts. Constant-time compare comes from the argon2 verify.
- Access token: JWT signed with Ed25519 (`EdDSA`). Claims: `sub`, `did` (device), `iat`, `exp` (15 min),
  `jti`. Keys rotate every 90 days, with `kid` and JWKS kept internally.
- Refresh token: opaque 256-bit random value stored hashed. Rotated on each use. Reuse → revoke the family
  and notify the user's devices.
- Device revocation disconnects sockets immediately (Redis pub/sub to all nodes), and access tokens are
  checked against a revocation set in Redis (`revoked:did:{id}`, TTL 15 min).
- New-device login sends a `server.notice` and a system message to the user's other devices.

## 6. End-to-end encryption design (M3)

> Final library choice: [ADR-0005](adr/0005-e2ee-library-choice.md). The design below maps onto
> Olm/Megolm (vodozemac) and onto the Signal protocol with only small naming differences.

### 6.1 Keys per device

| Key | Algorithm | Lifetime |
| --- | --- | --- |
| Identity key pair | Curve25519 + Ed25519 (signing) | Device lifetime |
| Signed prekey / fallback key | Curve25519, signed by identity | Rotated every 7 days |
| One-time prekeys | Curve25519 | Single use. Pool of 100, top up below 50. |
| Session keys | Double Ratchet (Olm) | Per device pair |
| Group sender key | Megolm ratchet per sender device per group | Rotated on membership change, or after 100 messages / 7 days |
| Media key | AES-256-GCM, 256-bit random per file | Per file (key travels inside the E2EE message) |

### 6.2 Protocol

1. **Publish:** after M3 upgrade or device registration, the device uploads its identity key, signed
   prekey and one-time keys (`PUT /keys/device`).
2. **1:1 send:** for every device of the recipient **and** every other device of the sender, the sender
   ensures a pairwise session exists (claiming a one-time key if not), encrypts the `MessageBody` separately
   for each, and sends one `olm` envelope with N recipients. The server stores the per-device ciphertext in
   `device_inbox.per_device_payload`.
3. **Group send:** the sender device keeps an outbound Megolm session per group. If the current session
   hasn't been shared with a member device, the session key is sent to it through a pairwise `olm` message
   first. The message is then encrypted once (`megolm` envelope) and fanned out by the server.
4. **Membership change:** when a member leaves or is removed, all remaining senders rotate their outbound
   session before the next send. New members receive only the new session, so they cannot read history
   (FR-GRP behaviour matches WhatsApp).
5. **Verification:** the safety number is `SHA-512` iterated 5200× over `(version ‖ identityKey ‖ userId)`
   for each party, truncated to 30 digits each and concatenated (Signal's scheme). The QR code encodes both
   fingerprints.
6. **Key change:** a new identity key for a known contact device → system message. Verified status is reset.
7. **Multi-device history (FR-E2E-07):** the new device creates an ephemeral X25519 key. An existing device
   of the same account scans or approves it, sends a history bundle encrypted to it via pairwise session
   (streamed in chunks, over the server as opaque blobs, max 2 GB), plus Megolm inbound sessions.
8. **Migration from M2:** existing conversations are flagged `e2ee=true` when all members' devices have
   published keys. Until then the chat shows "Waiting for X to update the app". Server-side plaintext
   history is deleted 30 days after a conversation becomes E2EE (announced in-app).

### 6.3 What the server still learns (honest disclosure)

Sender and recipient user and device IDs, conversation membership, group names and icons (not encrypted
in v1; encrypting group metadata is on the future list), timestamps, message sizes, IP addresses, online
status, and call metadata. The privacy policy must state this.

### 6.4 Crypto rules

- No custom primitives. Use only the audited library plus WebCrypto/Node `crypto` for AES-GCM, HKDF and SHA-2.
- All crypto code lives in `desktop/src/main/crypto/` and has ≥ 90 % test coverage, including test vectors.
- Pickled session state is encrypted by SQLCipher. The pickle key is derived from the DB key.
- An external security review happens before GA (M5) and before E2EE is enabled by default.

## 7. Abuse & fraud prevention

### 7.1 SMS pumping / toll fraud (Amazon SNS)

| Control | Default |
| --- | --- |
| Country allowlist (`SMS_ALLOWED_COUNTRIES=KE,UG,TZ,...`) | Only launch countries |
| Per-number limits | 1/60 s, 5/h, 10/day |
| Per-IP limits | 10/h, 30/day |
| Per-prefix limit (country code + 3 digits) | 50/h, which alerts on bursts to one range |
| Global daily SMS budget (`SMS_DAILY_MAX`) | 500/day. Beyond it, requests queue and the operator is alerted. |
| AWS account SMS monthly spend limit (`MonthlySpendLimit`) | Set in SNS settings. AWS enforces it. |
| Proof-of-work or CAPTCHA challenge | Turned on automatically when anomaly thresholds trip (hCaptcha / Turnstile in onboarding UI) |
| Conversion monitoring | Alert if the verify/request ratio for a prefix drops below 30 % |

SNS specifics: `SMSType=Transactional`, a registered Sender ID or origination number per country where
required, a delivery status logging IAM role, and the account moved out of the SNS SMS sandbox before launch.

### 7.2 Spam & abuse

- New accounts: limited to 50 new direct chats per day for the first 7 days.
- Messages to non-contacts show "Block / Report / Add contact" first.
- Group invite links can be revoked. Admins can require approval (M5).
- Reports go to the operator CLI. An operator can ban a user, which revokes devices and blocks the number.

## 8. Server & infrastructure security

- Containers run as non-root with a read-only root FS where possible. Minimal base images
  (`node:24-alpine` or distroless). Trivy scan in CI; the build fails on Critical.
- Only Caddy (80/443) and coturn (3478/udp+tcp, 5349, relay range 49160–49200/udp) are exposed.
  Postgres, Redis and MinIO bind to the internal Docker network only.
- The VPS is hardened: SSH key-only, no root login, `ufw`, `fail2ban`, unattended security upgrades, disk
  encryption where the provider supports it.
- Secrets live in `.env` files readable only by the deploy user, or in Docker secrets. They are rotated
  yearly or on staff change. None are in git. `gitleaks` runs in CI.
- AWS: a dedicated IAM user or role with only `sns:Publish` (and `sns:GetSMSAttributes`), plus a budget alarm.
- coturn: `use-auth-secret`, `static-auth-secret` rotated, `no-multicast-peers`, `denied-peer-ip` for private
  ranges (prevents SSRF into the VPS network), and a user quota.
- Postgres: separate app role with no superuser, `ssl=on` if it leaves the host, pgAudit for DDL.

## 9. Supply chain

- `pnpm` with lockfile, `pnpm install --frozen-lockfile` in CI, and `onlyBuiltDependencies` allowlist for install scripts.
- Renovate (grouped, weekly; security updates immediately). A human reviews new dependencies against the
  license and maintenance checklist in [AGENTS.md](../../AGENTS.md#non-negotiable-rules).
- GitHub Actions pinned by commit SHA, with least-privilege `permissions:`. OIDC instead of long-lived cloud keys.
- Release builds only from protected tags on `main`. Signing credentials are available only in the
  `release` environment, which requires reviewer approval.
- SBOM (CycloneDX) generated per release and attached to the GitHub Release.

## 10. Security testing

| Activity | Frequency |
| --- | --- |
| SAST: CodeQL (JS/TS) + ESLint security plugins | Every PR |
| Dependency audit + Trivy + gitleaks | Every PR + nightly |
| Electronegativity scan | Every PR touching `desktop/` |
| Auth/authz integration test suite (IDOR matrix: every endpoint × non-member) | Every PR |
| Fuzzing of protocol parsers (fast-check property tests) | Every PR |
| DAST: OWASP ZAP baseline against staging | Weekly |
| External pentest + crypto review | Before GA (M5) |
