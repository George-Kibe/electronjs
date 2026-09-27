# 09 — Deployment & Operations: WhatsappClone server

| | |
| --- | --- |
| Status | Draft v0.1 |
| Last updated | 2026-09-27 |

## 1. Target topology (stage S0: single VPS)

| Item | Spec |
| --- | --- |
| Provider | Any KVM VPS with a public IPv4 and IPv6, for example Hetzner CPX31/CCX23 or DigitalOcean 4 vCPU/8 GB. Pick the region closest to users (data residency: see requirements Q5). |
| OS | Ubuntu 24.04 LTS |
| Disk | 160 GB NVMe (+ attached volume for MinIO data if media grows) |
| DNS | `api.<domain>`, `media.<domain>`, `turn.<domain>`, `grafana.<domain>` (Grafana behind SSO/basic auth + IP allowlist) |
| Estimated cost | VPS €15–35 + backups storage €3–5 + domain. SMS billed separately by AWS. |

### 1.1 `docker-compose.prod.yml` services

| Service | Image | Ports (host) | Notes |
| --- | --- | --- | --- |
| caddy | `caddy:2` | 80, 443 (tcp+udp) | Auto TLS, reverse proxy to `api` (HTTP + WS) and `minio` (media host) |
| api (×2) | `ghcr.io/george-kibe/whatsapp-clone-server@sha256:…` | — | `node dist/main.js`. Health `/readyz`. |
| worker | same image | — | `node dist/worker.js` |
| migrate | same image | — | One-off: `node dist/cli.js db:migrate` |
| postgres | `postgres:17` | — | Volume `pgdata`. Tuned `shared_buffers=2GB`. WAL archiving to offsite via `wal-g`. |
| redis | `redis:7` (or `valkey/valkey:8`) | — | AOF `everysec`, `maxmemory-policy noeviction` (queues must not be evicted) |
| minio | `minio/minio` (pinned) | — | Volume `media`. Lifecycle rules for expired media. |
| coturn | `coturn/coturn` | 3478 tcp/udp, 5349 tcp, 49160–49200 udp | `network_mode: host` for relay performance (M4) |
| prometheus, grafana, loki, promtail/alloy, node-exporter, cadvisor | official | — | Observability stack |

### 1.2 Configuration (`.env`, validated at boot)

```dotenv
NODE_ENV=production
PUBLIC_API_URL=https://api.example.com
PUBLIC_MEDIA_URL=https://media.example.com
DATABASE_URL=postgres://app:***@postgres:5432/app
REDIS_URL=redis://redis:6379
S3_ENDPOINT=http://minio:9000
S3_BUCKET=media
S3_ACCESS_KEY=*** 
S3_SECRET_KEY=***
JWT_PRIVATE_KEY_FILE=/run/secrets/jwt_ed25519.pem
PHONE_HASH_PEPPER_FILE=/run/secrets/phone_pepper
SMS_PROVIDER=sns                 # sns | console | fake
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=***            # IAM user limited to sns:Publish
AWS_SECRET_ACCESS_KEY=***
SMS_SENDER_ID=WCLONE             # where supported/registered
SMS_ALLOWED_COUNTRIES=KE,UG,TZ,RW
SMS_DAILY_MAX=500
TURN_SECRET_FILE=/run/secrets/turn_secret
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
MIN_CLIENT_VERSION=1.0.0
MAX_DEVICES_PER_USER=5
MESSAGE_RETENTION_DAYS=0         # 0 = keep (pre-E2EE)
INBOX_TTL_DAYS=30
OTEL_EXPORTER_OTLP_ENDPOINT=
SENTRY_DSN=
```

## 2. Provisioning (one-time)

1. Create the VPS, add an SSH key, create the `deploy` user, and disable password and root login.
2. `ufw allow 22,80,443/tcp; ufw allow 443/udp; ufw allow 3478; ufw allow 5349/tcp; ufw allow 49160:49200/udp`.
3. Install Docker Engine + Compose plugin, enable unattended-upgrades and fail2ban.
4. Clone the deploy bundle (`whatsapp-clone/server/deploy/`: compose file, Caddyfile, coturn config,
   Grafana dashboards, backup scripts) to `/opt/wclone`.
5. Create secrets (`openssl genpkey -algorithm ed25519`, `openssl rand -hex 32`).
6. AWS: create an IAM user with an `sns:Publish` policy. In the SNS console, set the account spend limit,
   default SMS type Transactional, and delivery status logging. Request exit from the SMS sandbox. Register
   the Sender ID or origination numbers for launch countries.
7. `docker compose run --rm migrate && docker compose up -d`.

Target for later: turn the steps above into an Ansible playbook in `server/deploy/ansible/`.

## 3. Deploy procedure (automated by the release workflow)

```bash
cd /opt/wclone
export IMAGE_DIGEST=sha256:...           # from the release workflow
docker compose pull api worker migrate
docker compose run --rm migrate           # expand-only migrations
docker compose up -d --no-deps --scale api=2 --wait api   # new containers pass the health check before old ones stop
docker compose up -d --no-deps worker
./scripts/smoke.sh                        # /readyz, synthetic OTP (fake route), socket connect
```

Clients tolerate the brief socket disconnect (reconnect + resync). **Rollback:** set the previous digest and
repeat, without migrating.

## 4. Observability

### 4.1 Golden signals & SLOs

| SLI | SLO | Alert |
| --- | --- | --- |
| API availability (non-5xx / all) | 99.5 % monthly | Burn rate > 14.4 over 1 h (page) |
| Message delivery latency (server accept → recipient socket emit) p95 | < 200 ms | > 500 ms for 10 min |
| Socket connect success rate | > 99 % | < 97 % for 10 min |
| OTP delivery success (SNS delivery receipts) | > 95 % | < 85 % over 30 min, or conversion drop per prefix |
| Outstanding device_inbox rows older than 24 h | trend | Sudden growth |
| Postgres replication/backup freshness | last WAL archived < 5 min | > 15 min |
| Disk usage | < 80 % | > 85 % |

### 4.2 Key custom metrics (Prometheus)

`wc_messages_accepted_total{kind}`, `wc_message_fanout_devices`, `wc_delivery_latency_seconds` (histogram),
`wc_sockets_connected`, `wc_otp_requests_total{country,result}`, `wc_sms_sent_total{country}`,
`wc_sms_cost_estimate_usd`, `wc_rate_limited_total{route}`, `wc_client_version{version}` (gauge from
handshakes), `wc_media_bytes_uploaded_total`, `wc_turn_allocations` (M4).

### 4.3 Logs & traces

- pino JSON → stdout → Promtail/Alloy → Loki (14 days). Redaction paths: `req.headers.authorization`,
  `*.phone`, `*.code`, `*.payload`, `*.refreshToken`.
- OpenTelemetry auto-instrumentation (HTTP, pg, ioredis). Traces go to Tempo, optional at S0.
- Desktop crash reports: Sentry Electron SDK (opt-in, content scrubbed). Minidumps from `crashReporter`.

## 5. Backups & disaster recovery

| What | How | Frequency | Retention |
| --- | --- | --- | --- |
| Postgres | `wal-g` base backup + continuous WAL to offsite S3-compatible storage (different provider/region), encrypted | Nightly base, continuous WAL | 30 days |
| MinIO media | `mc mirror` to offsite bucket | Hourly | 30 days (matches the media TTL) |
| Redis | AOF + RDB snapshot to disk (queues are recoverable; losing presence is harmless) | — | 2 days |
| Config & secrets | Encrypted (age/sops) copy in a password manager/vault | On change | — |

**Restore drill (monthly):** restore the latest backup to a scratch VPS, run `scripts/verify-restore.sh`
(row counts, latest message timestamp, a sample media object), and record RPO/RTO achieved. Targets:
RPO ≤ 15 min, RTO ≤ 4 h (NFR-REL-04).

## 6. Runbooks

| Alert | First steps |
| --- | --- |
| **API 5xx spike** | Grafana → error panel by route. `docker compose logs api --since 15m`. If it started at a deploy, roll back. Check Postgres connections (`pg_stat_activity`) and Redis memory. |
| **Delivery latency high** | Check Redis latency (`redis-cli --latency`), Postgres locks on `conversations` (hot group?), API CPU. Scale `api` replicas. |
| **SMS spike / conversion drop** | Check `wc_otp_requests_total` by prefix. Remove the offending prefix from the allowlist or enable the challenge (`AUTH_CHALLENGE_MODE=always`). Check SNS spend in AWS. |
| **SNS delivery failures** | SNS delivery logs in CloudWatch. Check sender ID registration and the country's carrier status. As a fallback, temporarily switch the affected country to an alternate origination number. |
| **Disk > 85 %** | `docker system df`. Prune old images. Check MinIO lifecycle jobs and `envelopes` partition retention. Expand the volume. |
| **Postgres down** | `docker compose ps`, logs. If the data is corrupt, follow the restore procedure. Clients queue locally, so no data is lost from their side. |
| **Certificate errors** | `docker compose logs caddy`. Check DNS A/AAAA records and port 80 reachability for ACME. |
| **Suspected breach** | Follow the incident response plan: rotate JWT keys (logs everyone out), rotate TURN/S3/AWS secrets, snapshot disks for forensics, notify users/regulator within 72 h where the law requires it (Kenya DPA / GDPR). |

## 7. Capacity planning

- 1 message ≈ 1 KB envelope + fan-out rows. 5k MAU × 50 msgs/day ≈ 250k envelopes/day ≈ 0.5 GB/day
  including indexes before E2EE retention. Monthly partitions keep this manageable. Review disk monthly.
- Sockets: ~10–20 KB RAM each in Node. 5k sockets ≈ 100 MB per replica.
- TURN: budget ~1.5 Mbps per relayed 1:1 video call. Expect ~15–20 % of calls to need relay.

## 8. Operator CLI

```bash
docker compose run --rm api node dist/cli.js <command>
  users:find --phone +2547...            # masked output
  users:ban <userId> --reason "spam"
  users:unban <userId>
  devices:revoke <deviceId>
  reports:list --status open
  sms:stats --days 7
  retention:run --dry-run
```
