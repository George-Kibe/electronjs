# ADR-0004: Envelope message format with per-device fan-out and per-conversation seq

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-MSG-02..04, FR-E2E-01/02, NFR-REL-02

## Context

E2EE arrives in M3, after two milestones of plaintext messaging. If the server understands message
content (for example storing `text` columns), adding E2EE later means rewriting storage, fan-out and sync.
We also need exactly-once *perceived* delivery and stable ordering across multiple devices.

## Decision

1. The server routes **envelopes**: a routing header (`conversationId`, `kind`, `clientMsgId`, sender) plus an
   opaque `payload` discriminated by `enc` (`none` | `olm` | `megolm`). Before M3, `enc: none` carries the
   JSON body. The server treats it as a blob apart from size limits and (pre-M3 only) media reference extraction.
2. **Per-device fan-out** from day one: each envelope creates a `device_inbox` row for every recipient
   device (and the sender's other devices). Delivery acks are per device.
3. **Ordering:** the server assigns a gap-free, strictly increasing `seq` per conversation inside the insert
   transaction. Clients order by `seq`.
4. **Idempotency:** client-generated UUIDv7 `clientMsgId`, unique per sender device.
5. **Sync:** each device has a monotonic inbox `cursor`. `sync.pull` pages through undelivered items.

## Consequences

- E2EE (M3) changes client code and payload contents, not server storage or routing.
- Fan-out rows multiply writes by the number of devices. Acceptable with ≤ 5 devices and ≤ 256 members.
  Megolm envelopes share one payload, and only `olm` envelopes carry per-device payloads.
- Server-side search is impossible by design. Search is local (FTS5).
