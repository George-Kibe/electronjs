# Architecture Decision Records: WhatsappClone

Format: [Michael Nygard's ADR](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Copy [`0000-template.md`](0000-template.md) to start a new one. ADRs are immutable once accepted. To change
a decision, write a new ADR that supersedes the old one.

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-server-stack-nestjs-socketio.md) | Server stack: NestJS + Fastify + Socket.IO + PostgreSQL + Redis | Accepted |
| [0003](0003-phone-otp-via-amazon-sns.md) | Phone verification with server-generated OTP delivered via Amazon SNS | Accepted |
| [0004](0004-envelope-message-format.md) | Envelope message format with per-device fan-out and per-conversation seq | Accepted |
| [0005](0005-e2ee-library-choice.md) | E2EE library: vodozemac (Olm/Megolm) | Proposed |
| [0006](0006-client-local-store-sqlite.md) | Desktop local store: SQLite + SQLCipher in the main process | Accepted |
| [0007](0007-media-storage-presigned-s3.md) | Media storage: S3-compatible object store with presigned URLs | Accepted |
| [0008](0008-calls-webrtc-mesh-coturn.md) | Calls: WebRTC P2P/mesh with coturn; SFU later | Accepted |
