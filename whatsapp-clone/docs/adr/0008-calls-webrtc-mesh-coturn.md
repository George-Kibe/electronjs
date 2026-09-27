# ADR-0008: Calls: WebRTC P2P/mesh with coturn; SFU later

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-CALL-*

## Context

We need 1:1 and small-group voice and video calls that work across NATs, with end-to-end media
encryption where possible and low infrastructure cost.

## Options considered

1. **P2P WebRTC (mesh for ≤ 4) + coturn:** built into Chromium/Electron. DTLS-SRTP is end to end for P2P.
   Only relayed calls cost bandwidth.
2. **SFU (LiveKit / mediasoup) for all calls:** scales to large groups, but needs a server for every call.
   E2EE needs insertable streams / SFrame.
3. **Hosted CPaaS (Twilio Video, Agora):** fast to ship, but costly per minute and a third party sees metadata.

## Decision

WebRTC in the renderer. Signaling is relayed by the server over Socket.IO and E2EE-sealed from M3.
Self-hosted **coturn** with time-limited HMAC credentials (TURN REST API). Mesh topology up to 4
participants. An SFU (LiveKit, Apache-2.0) is deferred to the Future backlog for larger calls.

## Consequences

- Mesh upload cost grows with N-1, which is why it is capped at 4.
- P2P exposes IP addresses to peers. We offer a "Relay all calls" setting (`iceTransportPolicy: 'relay'`).
- coturn needs open UDP ports and must block relaying to private IP ranges (see Security §8).
