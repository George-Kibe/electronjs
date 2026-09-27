# ADR-0002: Server stack: NestJS + Fastify + Socket.IO + PostgreSQL + Redis

- **Status:** Accepted
- **Date:** 2026-09-27
- **Related requirements:** NFR-PERF-05, NFR-MAINT-*, G4

## Context

We need a custom Node.js backend (the user's choice) that serves REST plus realtime to thousands of
concurrent sockets, is structured enough for a production codebase, and scales from one VPS to several nodes.

## Options considered

1. **NestJS (Fastify adapter) + Socket.IO + Redis adapter:** opinionated modules and dependency injection,
   first-class WebSocket gateways, guards and interceptors shared by HTTP and WS, large ecosystem.
   Socket.IO gives acks, rooms, reconnection and a Redis adapter for multi-node fan-out.
2. **Fastify + raw `ws`:** leaner and faster, but we would hand-build rooms, acks, multi-node pub/sub and structure.
3. **Elixir/Phoenix:** excellent for realtime, but adds a second language and the team knows TypeScript.
4. **Supabase/Firebase:** rejected. The user wants a custom server, and E2EE plus a custom fan-out model fit poorly.

Database: **PostgreSQL** (transactions for `seq` assignment, partitioning, mature ops) over MongoDB.
ORM: **Drizzle** (SQL-first, lightweight, good migrations) over Prisma (heavier engine, less control of SQL).

## Decision

NestJS 11 with the Fastify adapter, Socket.IO 4 in websocket-only mode with `@socket.io/redis-adapter`,
PostgreSQL 17 via Drizzle, Redis 7 (or Valkey) for pub/sub, presence, rate limits and BullMQ queues.

## Consequences

- One language end to end. Shared zod schemas from `protocol/`.
- Socket.IO has its own framing, so non-JS clients (future mobile) need a Socket.IO client library. These exist for Swift and Kotlin.
- Hot groups can contend on the `conversations.last_seq` row lock. This is acceptable at our scale.
  Revisit (per-conversation sequencer in Redis) if contention shows up in metrics.
