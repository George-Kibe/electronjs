# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

This is a multi-component system (desktop, server, protocol) built over several milestones, possibly by
several people and AI agents. Decisions need to be discoverable and justified.

## Decision

We record significant decisions as Markdown ADRs in `docs/adr/`, numbered sequentially, using the template.
A PR that implements a significant decision includes its ADR.

## Consequences

- Newcomers and agents can read why things are the way they are.
- Small overhead per decision.
