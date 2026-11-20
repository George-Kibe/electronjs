# ADR-0009: Opt-in crash reports with a small in-app reporter (Sentry envelope format, no minidumps)

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** George Kibe (maintainer), with Claude Code
- **Related requirements:** FR-GEN-07, NFR-REL-03, NFR-SEC-02

## Context

FR-GEN-07 asks for telemetry off and **opt-in** crash reports "without image content or file names".
Security §5 adds that reports scrub file paths, image data and EXIF. NFR-REL-03 (crash-free sessions
≥ 99.5 %) needs crash data to be measurable at all, and NFR-SEC-02 allows network use only for update checks
and opt-in features. The repository convention (WhatsappClone docs/09 §4) names Sentry, but no Sentry
project or DSN exists yet.

An image editor's memory is mostly pixels. Anything that ships raw memory can ship image content.

## Options considered

1. **Own small reporter in main (chosen).** Uncaught errors in main and the windows, plus abnormal
   renderer/GPU/utility process exits, become small JSON events in the Sentry envelope format. They are
   posted to a DSN that is set at build time. Pros: no new dependency. Every field that leaves the machine
   is written and tested by us. Works with Sentry SaaS or self-hosted, Sentry-compatible servers
   (GlitchTip). Cons: no native minidumps, so a hard native crash shows only the process type, reason and
   exit code, not a native stack. No breadcrumbs or performance data (we don't want them).
2. **`@sentry/electron` SDK.** Pros: native minidumps with symbolication, breadcrumbs, source-map tooling.
   Cons: a large transitive dependency tree (OpenTelemetry and more) for a small feature. Minidumps carry
   stack and nearby heap memory, which can include pixels, so "no image content" can't be guaranteed.
   Scrubbing would depend on SDK hooks staying complete across SDK upgrades.
3. **Local reports only.** Save scrubbed reports in userData; the user copies one into a GitHub issue.
   Pros: no network at all. Cons: almost nobody does it, so NFR-REL-03 stays unmeasurable.

## Decision

We build option 1 (`app/src/main/services/crash-reports.ts`):

- **Off by default.** Preferences › Privacy › "Send crash reports" (`privacy.crashReports`). The setting is
  read for every report, so turning it off stops the next one. A build without a DSN never sends anything,
  and the checkbox says so.
- **Sources:** `uncaughtExceptionMonitor` in main (it only observes, so Electron's handling is unchanged).
  Window `error` / `unhandledrejection` events, forwarded over the zod-validated `crash.report` IPC channel.
  `render-process-gone` / `child-process-gone` with reason `crashed`, `oom`, `launch-failed`,
  `integrity-failure`, `abnormal-exit` or `memory-eviction`.
- **What a report holds:** the error type (identifier-like names only), the scrubbed message, stack frames
  rewritten to bundle-relative `app:///…` names, the app version, the update channel as the environment,
  the OS name and version, the CPU architecture, and the Electron/Chrome versions.
- **What it never holds:** image data, file names or paths, document or layer names, EXIF, breadcrumbs, a
  user or install id, the host name, or a minidump.
- **Scrubbing** (pure functions, unit-tested): the home folder, user name and host name are replaced first.
  Then file URLs and POSIX, Windows and UNC paths become `<path>`. Image and project file names become
  `<file>`, data URLs and long encoded runs become `<data>`, and e-mail addresses become `<email>`. Any
  quoted value that is not identifier-like becomes `<redacted>`. Messages are capped at 1000 characters.
- **Limits:** each distinct error is sent once, at most 10 reports per session, nothing is queued or stored,
  and a failed send is only logged.
- **Transport:** `net.fetch` POST to `https://<host>/api/<project>/envelope/` with the public key as a
  query parameter. HTTPS is required, except for a loopback address (E2E's local ingest server).
- **DSN:** `MAIN_VITE_CRASH_REPORT_DSN` at build time (a CI secret in the release workflow).
  `E2E_CRASH_REPORT_DSN` overrides it for tests.

## Consequences

- Positive: FR-GEN-07 is testable end to end. The E2E journey runs a local ingest server and checks that
  nothing arrives before opt-in and that the envelope after opt-in has no paths or file names. No new
  runtime dependency.
- Negative / trade-offs: hard native crashes (GPU driver, libvips segfault in codec-host) are reported
  without native stacks. Renderer stacks point into minified bundles until source maps are uploaded at
  release. Document names without an extension that appear unquoted in a message are not detectable.
- Follow-ups:
  - Create the Sentry (or GlitchTip) project. Turn on its server-side "Prevent storing of IP addresses" and
    data scrubbing as a second line of defence, then add the DSN as the `CRASH_REPORT_DSN` secret for the
    release workflow.
  - Upload renderer and main source maps per release (the release workflow, with the signing work).
  - Revisit minidumps only with a scrubbing story for heap memory, which would need a new ADR.
