# 04 — API & Realtime Protocol: WhatsappClone

| | |
| --- | --- |
| Status | Draft v0.1, protocol version **1.0** |
| Last updated | 2026-09-27 |
| Source of truth | `whatsapp-clone/protocol/src/**` (zod schemas). If this doc disagrees with the schemas, the schemas win. Fix the doc. |

## 1. Conventions

- Base URL: `https://api.<domain>/v1`. Realtime: `wss://api.<domain>/rt` (Socket.IO, `transports: ['websocket']`).
- JSON, UTF-8, `camelCase` fields. IDs are UUIDv7 strings. Timestamps are ISO-8601 UTC strings on REST and
  epoch milliseconds on the socket.
- Auth: `Authorization: Bearer <accessToken>` (JWT, EdDSA/Ed25519, 15 min). The socket sends
  `auth: { token, deviceId, appVersion, protocolVersion }` in the handshake.
- Idempotency: mutating REST calls accept `Idempotency-Key` (UUID). The server stores responses for 24 h.
- Pagination: cursor-based. `?cursor=<opaque>&limit=<n≤100>` returns `{ items, nextCursor|null }`.
- Rate-limit headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (IETF draft), plus `Retry-After` on 429.
- Versioning: the URL major (`/v1`) changes only on breaking REST changes. The socket protocol negotiates
  `protocolVersion` (`major.minor`). Minor versions are additive only.

## 2. REST endpoints

### 2.1 Auth

| Method & path | Body → Response | Notes |
| --- | --- | --- |
| `POST /auth/otp` | `{ phone: E164 }` → `202 { retryAfterSec, expiresInSec }` | Always 202 for allowed countries, even if throttled internally (with delay), to limit enumeration. `400 COUNTRY_NOT_SUPPORTED`, `429 RATE_LIMITED`. |
| `POST /auth/verify` | `{ phone, code, device: { name, platform, appVersion } , pin? }` → `200 { accessToken, refreshToken, user, deviceId, isNewUser }` | `401 OTP_INVALID {attemptsLeft}`, `410 OTP_EXPIRED`, `403 PIN_REQUIRED`, `409 DEVICE_LIMIT_REACHED` |
| `POST /auth/refresh` | `{ refreshToken }` → `200 { accessToken, refreshToken }` | Rotation. Reusing an old refresh token revokes the whole token family (theft detection). |
| `POST /auth/logout` | `{}` → `204` | Revokes the current device's tokens |

### 2.2 Users & profile

| Method & path | Description |
| --- | --- |
| `GET /me` | Own profile + privacy settings |
| `PATCH /me` | `{ displayName?, about?, avatarMediaId? }` |
| `PATCH /me/privacy` | `{ lastSeen, profilePhoto, about: 'everyone'|'contacts'|'nobody', readReceipts: boolean }` |
| `DELETE /me` | Schedules account deletion (FR-AUTH-10). Requires a recent OTP (`X-Reauth-Token`). |
| `POST /users/lookup` | `{ phones: E164[] (≤ 20) }` → `{ users: PublicProfile[] }`. Rate-limited (FR-PROF-03). |
| `GET /users/{id}` | Public profile (privacy-filtered) |
| `POST /users/{id}/block` / `DELETE /users/{id}/block` | Block / unblock |
| `POST /reports` | `{ userId?, conversationId?, messages?: ReportedMessage[], reason }` |

### 2.3 Devices

| Method & path | Description |
| --- | --- |
| `GET /devices` | List own devices |
| `DELETE /devices/{id}` | Revoke a device. Its sockets are disconnected with `device.revoked`. |

### 2.4 Conversations

| Method & path | Description |
| --- | --- |
| `GET /conversations?cursor=` | Conversations for the user, with membership metadata (not messages) |
| `POST /conversations/direct` | `{ userId }` → idempotent get-or-create of the direct conversation |
| `POST /conversations/group` | `{ name, description?, iconMediaId?, memberIds[] }` |
| `GET /conversations/{id}` | Details + members (+ devices for E2EE fan-out) |
| `PATCH /conversations/{id}` | Group info/settings (admins) |
| `POST /conversations/{id}/members` | `{ userIds[] }` (admins) |
| `DELETE /conversations/{id}/members/{userId}` | Remove (admin) or leave (self) |
| `PATCH /conversations/{id}/members/{userId}` | `{ role: 'admin'|'member' }` |
| `POST /conversations/{id}/invite-link` / `DELETE …` | Create/revoke an invite link |
| `POST /invites/{code}/join` | Join via link |
| `PATCH /conversations/{id}/me` | Per-user settings: `{ muteUntil?, archived?, pinned?, disappearingSec? }` |

### 2.5 Messages (REST fallback & history)

Sending happens on the socket. REST exists for history and recovery:

| Method & path | Description |
| --- | --- |
| `GET /sync?cursor=&limit=` | Same as socket `sync.pull` |
| `GET /conversations/{id}/messages?beforeSeq=&limit=` | History backfill (M1–M2 only. From M3 the server keeps no history for E2EE chats.) |

### 2.6 Media

| Method & path | Description |
| --- | --- |
| `POST /media/uploads` | `{ size, mime, sha256, purpose: 'message'|'avatar'|'group-icon' }` → `{ mediaId, upload: { url, headers } \| { multipart: { uploadId, partSize, partUrls[] } } }` |
| `POST /media/uploads/{mediaId}/complete` | `{ parts?: [{ partNumber, etag }] }` → `{ mediaId }` |
| `GET /media/{mediaId}` | `302` to a presigned GET (5 min), only if the caller has access |

Limits: 100 MB per file, 5 MB for avatars. Allowed MIME types are validated by magic bytes on complete
(before M3 only; after M3 the blobs are opaque ciphertext).

### 2.7 Keys (M3)

| Method & path | Description |
| --- | --- |
| `PUT /keys/device` | Upload `{ identityKey, signedPreKey{id, key, sig}, oneTimeKeys[{id,key}] }` |
| `POST /keys/one-time` | Top up one-time keys (the client keeps ≥ 50 on the server) |
| `POST /keys/claim` | `{ devices: [{userId, deviceId}] }` → prekey bundles (consumes one-time keys) |
| `GET /keys/count` | Remaining one-time keys |

### 2.8 Calls (M4) & config

| Method & path | Description |
| --- | --- |
| `GET /calls/turn-credentials` | `{ urls[], username, credential, ttlSec }` (coturn `use-auth-secret`) |
| `GET /calls?cursor=` | Call history |
| `GET /config` | Feature flags + limits + `minClientVersion` |
| `GET /healthz`, `GET /readyz` | Health (no auth) |

## 3. Realtime protocol (Socket.IO)

### 3.1 Connection

```ts
io('wss://api.<domain>', {
  path: '/rt',
  transports: ['websocket'],
  auth: { token, deviceId, appVersion: '1.2.0', protocolVersion: '1.0' },
});
```

Handshake errors (`connect_error.data.code`): `AUTH_EXPIRED` (refresh and retry), `AUTH_INVALID`,
`DEVICE_REVOKED`, `CLIENT_UPGRADE_REQUIRED`. On connect the server joins the socket to `user:{userId}` and
`device:{deviceId}`.

### 3.2 Client → server events (all use acknowledgements)

Ack shape: `{ ok: true, data } | { ok: false, error: { code, message, retryable } }`.

| Event | Payload | Ack data |
| --- | --- | --- |
| `message.send` | `Envelope` (see §4) | `{ clientMsgId, serverId, seq, serverTs }` |
| `message.edit` | `{ conversationId, targetId, envelope }` | same as send |
| `message.delete` | `{ conversationId, targetIds[], forEveryone }` | `{ seq }` |
| `reaction.set` | `{ conversationId, targetId, envelope }` (emoji inside payload; empty = remove) | same as send |
| `receipt.delivered` | `{ upToCursor }` (device inbox cursor) | `{}` |
| `receipt.read` | `{ conversationId, upToSeq }` | `{}` |
| `sync.pull` | `{ cursor, limit ≤ 500 }` | `{ items: InboxItem[], nextCursor, hasMore }` |
| `typing` | `{ conversationId, state: 'composing'|'recording'|'paused' }` | no ack (fire-and-forget, throttled 1/3 s) |
| `presence.subscribe` | `{ userIds[] ≤ 200 }` | `{ presences: Presence[] }` |
| `call.offer` / `call.answer` / `call.ice` / `call.end` / `call.reject` | `{ callId, conversationId, toDevices?, sealed }` | `{}` |

### 3.3 Server → client events

| Event | Payload |
| --- | --- |
| `message.new` | `InboxItem` (envelope + `seq` + `cursor`) |
| `receipt.update` | `{ conversationId, userId, type: 'delivered'|'read', upToSeq, ts }` |
| `typing` | `{ conversationId, userId, state }` (expires client-side after 6 s) |
| `presence` | `{ userId, online, lastSeen? }` |
| `conversation.updated` | `{ conversationId, change: 'members'|'info'|'settings', ... }` |
| `device.revoked` | `{ deviceId }`. The client must wipe local data if it is the revoked device. |
| `keys.low` (M3) | `{ remaining }`. Top up one-time keys. |
| `call.*` (M4) | Mirrors the client events, plus `call.answered-elsewhere` |
| `server.notice` | `{ level, message, action? }`, for example a maintenance notice |

### 3.4 Ordering & delivery rules

1. For a single socket, the client sends `message.send` one at a time per conversation (next send after
   ack) to preserve order. Different conversations can run in parallel.
2. The server assigns `seq` inside the insert transaction with `UPDATE conversations SET last_seq = last_seq + 1 … RETURNING last_seq`.
3. A client that sees a gap in `seq` for a conversation triggers `sync.pull`.
4. `message.new` is at-least-once. The client de-dupes on `serverId`.

## 4. Envelope format

```ts
// protocol/src/envelope.ts (abridged)
export const Envelope = z.object({
  clientMsgId: z.string().uuid(),          // UUIDv7, generated by sender
  conversationId: z.string().uuid(),
  kind: z.enum(['message', 'edit', 'delete', 'reaction', 'system', 'receipt-private']),
  replyTo: z.string().uuid().optional(),   // M1-M2 only in clear; M3 moves into payload
  payload: z.discriminatedUnion('enc', [
    z.object({ enc: z.literal('none'), body: MessageBody }),              // M1–M2
    z.object({ enc: z.literal('olm'),                                      // M3 1:1 / key distribution
               recipients: z.array(z.object({ deviceId: z.string().uuid(),
                                               type: z.number(), ciphertext: z.string() })) }),
    z.object({ enc: z.literal('megolm'), sessionId: z.string(), ciphertext: z.string() }), // M3 groups
  ]),
  expiresInSec: z.number().int().positive().optional(), // disappearing messages
});

export const MessageBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(65536) }),
  z.object({ type: z.literal('media'), media: MediaRef, caption: z.string().optional() }),
  z.object({ type: z.literal('voice'), media: MediaRef, durationMs: z.number(), waveform: z.string() }),
  z.object({ type: z.literal('reaction'), targetId: z.string(), emoji: z.string().max(16) }),
  z.object({ type: z.literal('edit'), targetId: z.string(), text: z.string() }),
  // ...location (future), contact card (future)
]);
```

In M3, the `MessageBody` is serialized, encrypted, and placed in `ciphertext`. The server code path is the
same for both. It never inspects `payload` except for the `enc` discriminator and size limits.

## 5. Error model

REST errors use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details:

```json
{ "type": "https://docs.<domain>/errors/OTP_INVALID", "title": "Invalid code",
  "status": 401, "code": "OTP_INVALID", "detail": "The code is incorrect.", "attemptsLeft": 3,
  "traceId": "4bf92f3577b34da6" }
```

| Code | HTTP | Retryable | Meaning |
| --- | --- | --- | --- |
| `VALIDATION_FAILED` | 400 | no | Schema validation error (`errors[]` gives the fields) |
| `COUNTRY_NOT_SUPPORTED` | 400 | no | Phone prefix is not on the allowlist |
| `AUTH_EXPIRED` | 401 | yes (after refresh) | Access token expired |
| `AUTH_INVALID` | 401 | no | Bad or revoked token |
| `OTP_INVALID` / `OTP_EXPIRED` | 401 / 410 | no | |
| `PIN_REQUIRED` / `PIN_INVALID` | 403 | no | Two-step verification |
| `FORBIDDEN` | 403 | no | Not a member, not an admin, or blocked |
| `NOT_FOUND` | 404 | no | |
| `CONFLICT` / `DEVICE_LIMIT_REACHED` | 409 | no | |
| `PAYLOAD_TOO_LARGE` | 413 | no | |
| `RATE_LIMITED` | 429 | yes (after `Retry-After`) | |
| `CLIENT_UPGRADE_REQUIRED` | 426 | no | Client is below `minClientVersion` |
| `INTERNAL` | 500 | yes | |
| `UNAVAILABLE` | 503 | yes | Maintenance/overload |

## 6. Compatibility policy

- Adding optional fields or new event types is a minor bump. Clients ignore unknown fields and events.
- Removing or renaming fields or changing semantics is a major bump. The server supports N and N-1 for ≥ 90
  days (NFR-COMP-02).
- `protocol/fixtures/<version>/*.json` holds golden payloads. CI verifies that the current schemas still parse
  the fixtures of every supported version.
- An OpenAPI 3.1 document is generated from the NestJS controllers (`@nestjs/swagger` with zod) at
  `/v1/openapi.json` (non-production) and published as a CI artifact.
