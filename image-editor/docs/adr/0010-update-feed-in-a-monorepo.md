# ADR-0010: Find this product's release through the GitHub API (update feed in a monorepo)

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** George Kibe (maintainer), with Claude Code
- **Related requirements:** FR-GEN-05, NFR-SEC-02

## Context

The repository releases several products (ImageEditor, WhatsappClone desktop, WinrarClone). release-please
tags each component separately (`image-editor-v0.2.0`; docs/08). electron-updater's GitHub provider
assumes one product per repository: on the stable channel it takes `/releases/latest`, the newest release of
any product. On pre-release channels it skips tags that are not plain semver, which `image-editor-v0.2.0`
is not. Packaging slice 6.6 showed this, and also that `publish` had no owner or repo, so `app-update.yml`
had no provider at all ("Unsupported provider: undefined").

## Options considered

1. **Monorepo-aware resolver in the app (chosen).** Keep the releases and tags where they are. Before each
   check, list the repository's releases through the GitHub API, pick this product's newest release for
   the channel, and point electron-updater's generic provider at that release's download folder. Pros: no
   extra repository, token or server. The release manifest still carries the SHA-512 and
   `stagingPercentage`, so verification and staged rollout are unchanged. Cons: about 80 lines of our own
   code. The unauthenticated GitHub API allows 60 requests per hour per IP, far above one check per 4 h.
2. **Separate releases repository** with plain `vX.Y.Z` tags. The stock provider works, but the release
   workflow needs a cross-repo token, and releases leave the main repository.
3. **Own update server** (generic provider). Full control, but it needs hosting.

## Decision

- `main/services/release-feed.ts` (pure, unit-tested) lists `GET /repos/George-Kibe/electronjs/releases?per_page=100`.
  It keeps non-draft releases tagged `image-editor-v<semver>` that carry an electron-builder manifest
  (`latest*.yml`, or `beta*.yml` for a beta). It then picks by semver precedence:
  - **Stable:** full releases only. A full version that GitHub marks as a pre-release is skipped.
  - **Beta:** beta pre-releases or full releases, whichever version is newest. Alpha and other
    pre-release ids are never offered.
- `electron-updater.ts` calls `setFeedURL({ provider: 'generic', url: …/releases/download/<tag>/, channel })`
  and then checks. No matching release counts as "up to date". `allowDowngrade` stays off.
- `electron-builder.yml` `publish` names the owner and repo, `tagNamePrefix: image-editor-v` and
  `releaseType: draft`. The uploads land in the release-please release, and the generated `app-update.yml`
  keeps what Windows needs to verify the installer's publisher.
- The API answer is untrusted input. It is shape-checked before use, and a failure only turns the check
  into an error status.

## Consequences

- Positive: auto-update works from this repository's releases without new secrets or infrastructure.
- Negative / trade-offs: if more than 100 newer releases of other products come after the last
  image-editor one, the app reports "up to date" until the next image-editor release. A release becomes
  visible to updaters once it is published, so the release workflow must publish only after every
  platform's assets and manifests are uploaded.
- Follow-ups: the release workflow (`image-editor-release.yml`) uploads per-platform manifests together and
  publishes the draft last.
