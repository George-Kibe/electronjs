# ADR-0007: Media storage: S3-compatible object store with presigned URLs

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-MED-*, NFR-COST-01

## Context

Media up to 100 MB must be uploaded and downloaded efficiently without passing through the Node API
processes. From M3 it is encrypted client-side.

## Decision

- Self-hosted **MinIO** on the VPS at S0, through the S3 API only, so we can move to AWS S3, Cloudflare R2
  or Backblaze B2 with only config changes.
- The API issues short-lived presigned PUT (15 min) and GET (5 min) URLs after authorization. Large files
  use S3 multipart for resumable uploads.
- A separate `media.<domain>` host fronts MinIO through Caddy, so presigned signatures stay valid.
- Lifecycle: `expires_at` 30 days after the last recipient download. A worker deletes expired objects.

## Consequences

- API nodes stay light. Bandwidth goes straight to the object store.
- Presigned URLs are bearer tokens for their short lifetime. They must never be logged, and must be short-lived.
- Before M3, the server validates magic bytes on upload complete. After M3, media is opaque ciphertext.
