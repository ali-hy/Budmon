# Platform decisions (2026-10-05)

Decided by the user in conversation, as input for the `platform` HLD. The planner records them as decisions and fills in the details.

| Topic | Decision | Notes |
| ----- | -------- | ----- |
| Database | PostgreSQL, not MongoDB/NoSQL | Domain is relational and needs transactions (splits, transfers, balances). Flexible parts (templates, extracted fields, budget rule conditions) go in `jsonb`. |
| Backend runtime | Node.js + TypeScript | I/O-bound workload suits Node. |
| HTTP framework | Fastify (replacing Express) | Chosen over Hono: mature Node ecosystem (rate limiting, helmet, CORS, cookies), built-in pino logging, mature OpenTelemetry instrumentation. Hono's edge/Bun portability isn't needed. |
| API style | oRPC, contract-first, publishing an OpenAPI document (replacing the tRPC stub) | Native Android (Kotlin) gets a client generated from OpenAPI; the web app uses oRPC's TypeScript client. Chosen over ts-rest: actively developed, Standard Schema / zod 4 support. |
| Background work | Separate worker process(es) from the same codebase; job queue pg-boss | pg-boss stores jobs in Postgres: no extra infrastructure, and jobs can be enqueued in the same database transaction as the data change. Revisit BullMQ (Redis) only if job volume outgrows Postgres; keep the queue behind a small interface. Listeners and syncing (Gmail, SMS ingestion, FX rates, reminders, notifications) run in workers. |
| Gmail | Push via Gmail `watch` + Google Cloud Pub/Sub, not polling | User: "that's awesome!" |
| Gmail tokens | Encrypted at rest with a managed key; only the capture worker can decrypt | User will review this closely. |
| Money | 64-bit integers in minor units, plus each currency's decimal places | |
| Performance | Indexes designed per query; budget progress maintained incrementally; connection pooler in front of Postgres; table partitioning only if ever needed | User: "indexes will be very important here". |
| API servers | Stateless, so more can be added | |
| Observability | OpenTelemetry instrumentation; structured logs with pino; Sentry for errors on backend, web and Android; a hosted backend for traces/metrics/logs (e.g. Grafana Cloud) to be chosen in the HLD | Logs and traces must never contain financial data, message content or tokens. |
| Scale target | Design for public scale, launch invite-only | |
