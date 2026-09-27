# ADR-0005: E2EE library: vodozemac (Olm/Megolm)

- **Status:** Proposed. To be confirmed by the M2 spike, before M3 starts.
- **Date:** 2026-09-27
- **Related requirements:** FR-E2E-*, NFR-SEC-*

## Context

We need audited implementations of X3DH-style session setup, the Double Ratchet (1:1 forward secrecy and
post-compromise security) and an efficient group scheme (sender keys). Writing our own is off the table.
The project is **MIT-licensed**, so library licenses matter.

## Options considered

1. **libsignal (`@signalapp/libsignal-client`)**
   - Pros: the reference Signal Protocol implementation, used at massive scale, includes sender keys and
     PQXDH/post-quantum work.
   - Cons: **AGPL-3.0**. Distributing the app with it would require the combined work to follow AGPL terms,
     which conflicts with the MIT choice. Also, the API is tuned for Signal's own apps.
2. **vodozemac** (Matrix.org's Rust implementation of Olm and Megolm)
   - Pros: **Apache-2.0**. Security audit by Least Authority (2022). Olm is a Double Ratchet with X3DH-like
     setup, and Megolm provides group sender keys. Used in production by Element and other Matrix clients.
     Rust core can be used from Node via WASM or N-API bindings.
   - Cons: Megolm has weaker post-compromise security than per-message pairwise ratchets (mitigated by
     rotating sessions on membership change and every 100 messages / 7 days). We need to verify that the JS
     bindings expose everything required (pickling, fallback keys).
3. **MLS (RFC 9420) via OpenMLS**
   - Pros: modern IETF standard, efficient large groups, MIT/Apache.
   - Cons: bindings for Node/Electron are immature. Multi-device and delivery-service semantics add a lot of complexity.
4. **Custom build on libsodium**
   - Rejected: implementing ratchets ourselves carries unacceptable risk.

## Decision (proposed)

Use **vodozemac**, running in the Electron main process through its WASM/Node bindings. Olm handles
pairwise device sessions and Megolm handles groups. The crypto layer sits behind a `CryptoProvider`
interface so we can later move to MLS or (if relicensed) libsignal.

## Consequences

- Keeps the project MIT-compatible (Apache-2.0 is compatible).
- The M2 spike must confirm: binding maturity on Windows/macOS/Linux x64+arm64, performance of 256-member
  group key distribution, and pickle/unpickle to SQLCipher.
- If the spike fails, the fallback is to relicense the desktop app to AGPL and use libsignal. That is a
  decision for the product owner.
