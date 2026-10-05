# Platform decisions (2026-10-05)

Decided by the user in conversation, as input for the `platform` HLD. The planner records them as decisions and fills in the details.

| Topic | Decision | Notes |
| ----- | -------- | ----- |
| Database | PostgreSQL, not MongoDB/NoSQL | Domain is relational and needs transactions (splits, transfers, balances). Flexible parts (templates, extracted fields, budget rule conditions) go in `jsonb`. |
| Backend runtime | Node.js + TypeScript | I/O-bound workload suits Node. |
| HTTP framework | Fastify (replacing Express), confirmed after an Express comparison | Over Express: built-in pino logging, plugin encapsulation per module, `app.inject()` for integration tests without a network port, better typing; speed is not the reason. Over Hono: mature Node ecosystem (rate limiting, helmet, CORS, cookies), built-in pino logging, mature OpenTelemetry instrumentation. Hono's edge/Bun portability isn't needed. |
| API style | oRPC ("I'm sold on oRPC"), contract-first, publishing an OpenAPI document (replacing the tRPC stub) | Native Android (Kotlin) gets a client generated from OpenAPI; the web app uses oRPC's TypeScript client. Chosen over ts-rest: actively developed, Standard Schema / zod 4 support. |
| Background work | Separate worker process(es) from the same codebase; job queue pg-boss (confirmed: "pg-boss it is") | pg-boss stores jobs in Postgres: no extra infrastructure, and jobs can be enqueued in the same database transaction as the data change. Revisit BullMQ (Redis) only if job volume outgrows Postgres; keep the queue behind a small interface. Listeners and syncing (Gmail, SMS ingestion, FX rates, reminders, notifications) run in workers. |
| Gmail | Push via Gmail `watch` + Google Cloud Pub/Sub, not polling | User: "that's awesome!" |
| Gmail tokens | Encrypted at rest with a managed key; only the capture worker can decrypt | User will review this closely. |
| Money | 64-bit integers in minor units, plus each currency's decimal places | |
| Performance | Indexes designed per query; budget progress maintained incrementally; connection pooler in front of Postgres; table partitioning only if ever needed | User: "indexes will be very important here". |
| API servers | Stateless, so more can be added | |
| Observability | OpenTelemetry instrumentation; structured logs with pino; Sentry (free plan to start) for errors on backend, web and Android, and Grafana Cloud's free tier for traces, metrics and logs (confirmed: "we'll go with this") | Hard rule, user: "yes, totally, very important": logs, traces and error reports never contain amounts, payees, message content or tokens. Keep metric labels low-cardinality (free tier: 10k active series). |
| Scale target | Design for public scale, launch invite-only | |

## Answers to the platform HLD v0.3 open questions (2026-10-05)

| Question | Answer (user's words where useful) |
| -------- | ---------------------------------- |
| Web app framework (D-7) | "can we make the webapp a solid or vanilla ts web app instead? since sometimes the app will show big tables and performance will be crucial" → SolidJS (vanilla TS rejected: it would mean hand-building a component, state and routing layer; table performance comes from virtualisation, which Solid supports). |
| Q-1 Backups | Accepted: daily, 14-day retention, 7 days point-in-time recovery. |
| Q-2 Capture-only key | Accepted as proposed. |
| Q-3 Alerts | Accepted ("awesom"). |
| Q-4 Hosting | "hosting during the first stage where it's invite only will probably run on hetzner or on a locally run and managed not so expensive server" — hosting, environments and costs are to be designed for the invite-only stage. |
| Q-5 FX provider | "we'll have to find something that works and not for too much money" — research cheap/free options that cover currencies like EGP and historical rates. |
| Q-6 Domain | "let's try getting budmon.ai or budmon.com and we can have the backend be a subdomain or just a subpath like /api/v<x>_<y>/" |
| Q-7 Language | "english first, accessible and calm only in very high-level documents. however technical talk its good for hld's that involve protocols, technologies, algorithms or any such things, and is definitely the preferred language for lld's" (recorded as a documentation-style rule in the planner's instructions; the app's own UI tone is still open, P8). |
| Q-9 Staging | "sounds good, I guess, but let's find a cheaper option cuz that sounds like too much. when discussing deployment and running costs and environments please concern yourself with the invite-only stage" |
| Q-11 Gmail publishing status | Recommendation accepted: (b) "In production" without verification, confirmed by a spike before `sources` is designed; (a) as fallback. |
| Q-12 Production pooler | "none at launch" |
| Q-13 Release step | Accepted; "let's get to it when we have something to release". |
| Q-14 Hotfixes | (a) built from the last release. |
| Q-8, Q-10 | Not answered; recommendations stand as assumptions. |
