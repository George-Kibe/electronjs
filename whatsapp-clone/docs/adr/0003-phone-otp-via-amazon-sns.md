# ADR-0003: Phone verification with server-generated OTP delivered via Amazon SNS

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** FR-AUTH-01..04, NFR-COST-02

## Context

Accounts are identified by phone number (the user's choice). The chosen SMS provider is Amazon SNS. Unlike
Twilio Verify, SNS has no managed "verification" product. It only publishes SMS. SMS OTP systems are a
known target for SMS pumping / toll fraud.

## Decision

- The server generates a 6-digit code (`crypto.randomInt`), stores only an argon2id hash in Redis (TTL
  5 min, 5 attempts), and publishes the SMS through the SNS `Publish` API with `SMSType=Transactional`,
  called from a BullMQ worker.
- SMS sending sits behind an `SmsProvider` interface with implementations `SnsSmsProvider`,
  `ConsoleSmsProvider` (dev) and `FakeSmsProvider` (tests, exposes codes to the E2E harness). Another
  provider (Twilio, Africa's Talking) can be added without touching auth logic.
- Fraud controls: country allowlist, per-number/IP/prefix rate limits, global daily budget, AWS monthly
  spend limit, an adaptive challenge, and conversion-rate alerts ([Security §7.1](../06-security.md#71-sms-pumping--toll-fraud-amazon-sns)).

## Consequences

- We own OTP security logic. It must be well tested (T-AUTH-01).
- Per-country sender ID and origination number registration is operational work before launch (Kenya
  requires sender-ID registration). The SNS account must leave the SMS sandbox.
- Delivery receipts come from SNS delivery status logging (CloudWatch). We ingest them for the OTP delivery SLI.
