---
module: platform
doc: hld
status: in-review # draft | in-review | approved
version: 0.5
author: planner
approved_by:
approved_on:
---

# Platform: High-Level Design

The technical base every other Budmon module builds on: repository layout, the API contract and generated clients, worker processes and the job queue, configuration and secrets, credential encryption, data access, migrations and the money type, the error model, observability, the security baseline, file storage, test tooling, CI, local development, hosting and backups, and the clean-up of the current repo.

Sources: [spec summary](../../product/spec-summary.md) v0.10 §4.14 (`PLT`), §3 (XC-n), §5 to §7; the user's [platform decisions](../../product/notes/2026-10-05-platform-decisions.md) (cited as **PD**); the [codebase review](../../product/codebase-review.md) (cited as **CR**); the [project brief](../../product/project-brief.md).

## Changelog

| Version | Date       | Change |
| ------- | ---------- | ------ |
| 0.1     | 2026-10-05 | Initial draft |
| 0.2     | 2026-10-05 | Plan review round 1. **P-1:** D-14 now states the exact money wire mechanism (a shared codec: `z.number().int()` bounded to ±(2^53 − 1) with a JSON-schema override to `integer`/`int64`, explicit number↔bigint conversion in server routers and web data hooks, no `.transform()` in the contract); added to the first contract spike (§9). **P-2:** D-24 gains a "sensitive-data boundaries" list: sanitised job errors (pg-boss output) with a canary on `pgboss.job.output`; messages of non-`BudmonError` errors dropped on server and both clients; oRPC validation `cause` stripped; Postgres `log_error_verbosity = terse` and `log_min_error_statement = panic`; no sensitive values in paths or query strings (sensitive filters in POST bodies, encrypted cursors, D-32); outbound client spans without query strings and allowlisted third-party error fields; Fastify request logging disabled with a custom serialiser; an infrastructure logging checklist and a staging canary gate. **P-3:** D-19 decides where the OAuth code exchange happens (worker-capture, from a sealed authorization code; F-3 redrawn), rewords memory handling, places re-wrap jobs, adds confused-deputy egress rules and the residual trust boundary with IAM restrictions. **P-4:** D-15 defines FX date semantics (the rate of UTC day D, fetched after it closes), immutable stored days, provisional conversions, an `fx.rates-added` notification for recomputation, and per-item rounding; §3.3 contradiction removed. **P-5:** D-13 replaces client-supplied entity IDs with per-user idempotency keys and an `idempotency_records` table; replays are answered from the record. **P-6:** D-21 adds `data.outcome` (`not_applied` / `unknown`) to `INTERNAL`; J-1 and §4.9 wording depend on it; every create takes an idempotency key on web too. **P-7:** D-9/D-12/§7.1 give pg-boss its own role owning the `pgboss` schema (runtime DDL confined there, a documented exception to PLT-BR-5); queues created in the migrate step; one retention for finished jobs plus dead-letter queues; F-4 uses the `stately` policy. **P-8:** new D-35 object storage for exports and the erasure log (private buckets, signed URLs, lifecycle deletion, erasure coverage). **P-9:** D-25 treats token expiry as connection state and alerts on a bounded `capture_connections_stale` gauge. User questions Q-11 (Gmail publishing status) and Q-12 (production pooler) added; Q-4 costs re-estimated with levers. Suggestions applied: S-1 to S-10, S-12, S-13, S-14; S-11 resolved by using 400 instead of 426 (see D-33). **User requirement (migrations only between deployments):** D-12 redesigned: development and test databases are built directly from the Drizzle schema (guarded `db:reset`/`db:sync`, no migration files); one migration per release, generated on a `release/<version>` pull request by the software-engineer, hand-edited for data-preserving changes listed in each LLD's release migration notes, reviewed and gated by release-only CI checks (migrations reproduce the schema, upgrade test, destructive-statement check); staging and production apply only committed migrations; pg-boss schema, roles, reference data and queues handled by an environment-independent schema step. PLT-BR-5 restated (US-7, D-12); D-5, D-9, D-26, D-27, D-28, D-29, D-34, §3, §7.1, §9 and Q-9 updated; Q-13 added. |
| 0.3     | 2026-10-05 | Plan review round 2. **B-1 (a):** release pull requests target main, must be up to date with main, and the pipeline tags the merge commit only after re-running check (i) on it; deploys use that commit (D-12, D-27, D-29). **B-1 (b):** `hotfix/<version>` path from the last release tag, with its own migration, the release checks, and a merge-back exempt from the no-migrations rule; linear journal rule; marked pending Q-14. **B-1 (c):** prompts never answered interactively: development and feature-branch test databases are only built by pushing onto empty databases (`db:sync` removed), and `generate` runs under a pseudo-terminal driver answering "create" and listing ambiguities, with `generate --custom` as fallback (D-12, D-26, §9). **B-1 (d):** the test-architect owns the upgrade test and its raw-SQL fixtures written against the previous release's schema; the planner keeps each LLD's Release migration notes current through amendments. **B-1 (e):** pg-boss upgrades ship alone, with workers scaled to zero and the API in maintenance during the schema step. **B-2:** creates return a fixed `{ id, createdAt }`; the idempotency record stores only that and the status; replays go through output validation; Android resends the stored request bytes (D-13, §3, F-1). **B-3:** successful sync defined per source kind; Gmail safety-net sync at least every 6 hours counts; SMS staleness on the dashboard only (D-25, J-8, Q-3). Suggestions S-1 to S-8 applied: spec v0.10 references and FK wording; OIDC trust scoped to release/hotfix tags in a protected environment; dead-letter lifetime and discarded return values; wider risky-statement check and the no-`CONCURRENTLY` note; staging keeps separate worker identities (costs updated); OAuth state bound to a server-side row (F-3); request bytes resent from the outbox; `db:reset`-only rule in the proposed CLAUDE.md conventions. Q-14 (hotfixes) added. |
| 0.4     | 2026-10-05 | User answers to v0.3's questions ([platform decisions](../../product/notes/2026-10-05-platform-decisions.md)) and plan review round 3 suggestions. **Web (D-7):** SolidJS 1.9 SPA instead of React (vanilla TypeScript rejected with reasons); every web dependency re-chosen for Solid (TanStack Router/Query/Table/Virtual/Form for Solid, oRPC's TanStack Query integration, Kobalte with Ark UI as alternative, `@formatjs/intl`, `@sentry/solid`); large tables made an explicit requirement with targets and a Playwright performance test (§1.1, D-7, D-26); Android lists use Paging 3 (D-8). **Hosting (D-29) redesigned for the invite-only stage on Hetzner:** one CX33 production VM and one CX23 staging VM running Docker Compose (Caddy, api, two workers, Postgres with pgBackRest, Grafana Alloy); forced-command SSH deploys of GHCR images from protected GitHub environments; maintenance switch in Caddy without a code deploy and defined `/health/ready` behaviour (round 3 S-4); staging rebuild rule for hotfixes while staging is ahead (S-2); OpenTofu kept small with encrypted state; cost re-estimated at about €18 to €40 a month. **Dependent decisions:** D-18 no pooler at launch, pools sized against `max_connections`, PgBouncer removed from production and local compose (CI pooler suite kept); D-19 rebuilt without per-process cloud identities: Google Cloud KMS asymmetric key (API seals with the public key, only worker-capture can unwrap), local key for `api-secrets`, residual risk of a root compromise stated (Q-15); D-20 SOPS/age per-service secret files replace Secret Manager; D-24 Caddy/Postgres/Docker logging checklist, Alloy as the allowlisting collector, canary gate searches Grafana and Sentry; D-25 host, backup and certificate alerts added; D-30 pgBackRest with client-side encryption to Backblaze B2 (off-provider), 14-day time-based retention, quarterly restore drills on a temporary VM; D-35 S3-compatible buckets with scoped keys and presigned URLs; §5.1, §5.4, F-3, §7.5, §7.6 (scaling path) updated. **New D-36:** same-origin API under `/api/v1` (no CORS), minor version in `openapi.json` and a header rather than the path (differs from the user's `/api/v<x>_<y>/`, Q-16). **FX (D-15):** provider research table; Open Exchange Rates primary, `fawazahmed0/exchange-api` fallback (Q-18). **Accepted answers recorded:** backups, capture-key scope, alerts, Gmail "In production" with spike, no pooler, release step (command deferred), hotfixes from the last release; Q-8 and Q-10 become assumptions A-12 and A-13. **Round 3 suggestions:** S-1 merge-back check redefined (D-12); S-2, S-3, S-4 (D-29); S-5 list invalidation after creates (§4.5); S-6 staging deploys from release and hotfix tags (D-27, D-29). Open questions renumbered Q-15 to Q-20; P8 for the app UI kept as Q-17. |
| 0.5     | 2026-10-05 | Plan review of v0.4 (ready for the user) suggestions applied; status set to `in-review`. **S-1:** corrected the claim that a disk leak leaves credentials sealed: a disk copy or snapshot exposes the SOPS files and, with the age key on disk, worker-capture's KMS credential; production age key now kept only in tmpfs with `budmonctl unlock` after reboots, no automatic reboots, no production snapshots; D-19 threat table, §7.5, §9 and Q-15 updated. **S-2:** pgBackRest retention corrected to `repo1-retention-full=7` with weekly fulls (oldest backup 7 to 14 days, PITR at least 7 days), matching "within 14 days" (D-30, §3.3). **S-3:** readiness defined as the code's compatible schema window so rollbacks report ready; `db:migrate` verifies journal and hashes only, check (i) stays in CI (D-12, D-29). **S-4:** staging canary gate also scans unfiltered Docker and journald logs via a forced-command scan; alerts on any Alloy drop; Caddy's error logger filtered, credentials redacted (D-24, D-25). **S-5:** restore-drill isolation rules (D-30). **S-6:** service-account key org policy check with fallbacks; FCM credential and Pub/Sub subscriber scope listed; CI secret scan of repo and images (D-19, D-20). **S-7:** internal `data` network, `egress` network, worker-capture behind a hostname-allowlist egress proxy; Alloy's root exception stated (D-29). **S-8:** `@fastify/cors` removed (D-3); D-9 rationale updated for containers and secret files. **S-9:** Q-20 now blocks the Gmail spike and `sources`. **S-10:** library versions pinned as checked on npm; Ark UI status; TanStack Table v9 (D-7). **S-11:** statistical performance targets under CPU throttling on release candidates; placeholder rows keep scroll position and `aria-rowindex` (D-7, D-26). **S-12:** Hetzner price-rise count marked as reported (§9). No suggestion declined. |

## 1. Context and requirements

### 1.1 Requirements

Stories PLT-US-1 to PLT-US-15 and business rules PLT-BR-1 to PLT-BR-8 (spec §4.14), plus the cross-cutting requirements the platform has to make possible:

| Requirement | What the platform must provide |
| ----------- | ------------------------------ |
| XC-1, XC-2, XC-3, PLT-BR-3 | One exact money type (64-bit integer minor units plus the currency's decimals), currency reference data, daily market rates and a conversion function with defined date semantics. |
| XC-5, XC-6 | Conventions and helpers for instants, calendar dates and IANA time zones. |
| XC-9 to XC-16, PLT-BR-1, PLT-BR-2 | Credential encryption that only the capture worker can undo; observability, job storage and URLs that never carry amounts, payees, message content or tokens; hard deletion as the default so erasure (XC-16) is real; backups and logs whose retention is stated. |
| XC-17 | Background jobs and private file storage for exports (the export itself is `identity`'s). |
| XC-19 to XC-22 | A monorepo with backend, web app and native Android app; idempotent creates so Android's offline queue (XC-22, TXN-US-10) can retry safely. |
| XC-25 to XC-28 | Scheduled and queued work in workers (reminders, push and email delivery are `notifications`' and `identity`'s). |
| XC-29 to XC-31 | Gmail push ingestion path; best-effort availability (P9) with alerting. |
| User requirement (2026-10-05, D-7) | The web app shows big tables with performance as a priority: virtualised rendering, server-side keyset pagination, stated targets. |
| IDN-BR-3, §6 (Gmail testing mode) | Nothing that hard-wires invite-only: the platform is designed for public scale (PD "Scale target") but deploys small. |

### 1.2 Goals

- Every module is built the same way, in a predictable place, against a contract that the web and Android apps can't drift from.
- Privacy rules (PLT-BR-1, PLT-BR-2) are enforced by construction and by automated tests, not only by guidelines.
- A fresh checkout plus one documented command runs the whole stack; one command runs every check.
- Launch cheaply for an invited group; scale out (more API instances, more workers, bigger database) without redesign.
- The repo starts from a sound base: the current broken and unsafe code is removed in the first slice (PLT-US-14).

### 1.3 Non-goals

- Any module's own features, tables or screens, including sign-in, sessions and tokens (`identity`).
- Redis, Kubernetes, microservices, GraphQL, a service mesh or a message broker other than pg-boss.
- WebSockets or server-sent events in the MVP (see §5.2).
- Postgres row-level security in the MVP (D-23).
- Exporting client-side (browser or Android) traces to Grafana in the MVP (D-24).
- A persisted offline read cache on Android (only new-entry offline support is in the MVP, XC-22).
- The public-scale deployment (§7.6 describes the path only), multi-region deployment, high availability, and an SLA (P9: best effort). Hosting, environments and costs are designed for the invite-only stage (user decision).
- An operations UI inside Budmon. The product owner's error and health views are Sentry and Grafana (spec P22: an in-app view comes later).
- A feature-flag service. Per-user feature switches are `admin`'s (ADM-US-7).

## 2. Actors and stories

Actors: **developer or agent** (builds Budmon), **product owner** (operates it), **end user** (sees the platform only through what it protects and how reliably the apps work), and **system actors**: the API process, worker-capture, worker-general, the CI pipeline.

The HLD keeps the spec's story IDs so traceability is one-to-one. Each becomes an LLD slice, except that **US-14 (clean-up) is delivered inside the first slice together with US-1** (decided, spec §7 item 4).

| ID | Spec | Story |
| -- | ---- | ----- |
| US-1 | PLT-US-1 | As a developer or agent, I want one repository holding backend, web app, Android app and the shared contract in a documented layout, so every module is built the same way. |
| US-2 | PLT-US-2 | As a developer or agent, I want to start the whole stack locally with one documented command, so anyone can run and test Budmon from a fresh checkout. |
| US-3 | PLT-US-3 | As a developer or agent, I want the API defined as a contract first, with OpenAPI published from it and clients generated from it, so the apps can't drift from the backend. |
| US-4 | PLT-US-4 | As a developer or agent, I want background work in separate worker processes through a job queue, so slow or scheduled work never slows the API and jobs aren't lost. |
| US-5 | PLT-US-5 | As a developer or agent, I want configuration validated when each process starts, so a misconfigured process fails immediately and clearly. |
| US-6 | PLT-US-6 | As an end user, I want the credentials Budmon holds for me encrypted and usable only by the part of Budmon that needs them, so a database or API leak doesn't expose my inbox. |
| US-7 | PLT-US-7 | As a developer or agent, I want staging and production schemas changed only through generated, reviewed, committed migrations, created once per release, while development and test databases are built directly from the schema, so the schema can evolve freely during development and safely once real data exists (user requirement, D-12). |
| US-8 | PLT-US-8 | As a developer or agent, I want one shared money type and helpers (including conversion at market rates), so every module stores, adds and displays amounts exactly. |
| US-9 | PLT-US-9 | As a client developer and end user, I want one error model across the API, so apps show the right message and nothing internal leaks. |
| US-10 | PLT-US-10 | As the product owner, I want errors from backend, web and Android in one place without users' financial data, so I can fix problems fast without breaking the privacy promise. |
| US-11 | PLT-US-11 | As the product owner, I want dashboards and alerts for the API and workers, including whether capture is working, so I notice when capture stops before users do. |
| US-12 | PLT-US-12 | As a developer or agent, I want automated checks on every change, so broken code doesn't reach the main branch. |
| US-13 | PLT-US-13 | As an end user, I want basic protection against abuse (rate limits, CORS, security headers, size limits), so my account can't be brute-forced and the API isn't trivially attacked. |
| US-14 | PLT-US-14 | As a developer or agent, I want the current repo cleaned up per the codebase review inside the first slice, so the first module starts from a sound base. |
| US-15 | PLT-US-15 | As an end user and product owner, I want my data backed up, so a server failure doesn't lose my financial history. |

Business rules carried through: PLT-BR-1 (D-24, §7.5), PLT-BR-2 (D-19), PLT-BR-3 (D-14), PLT-BR-4 (D-4, D-6), PLT-BR-5 (D-12; spec v0.10 wording, from the user's [platform feedback](../../product/notes/2026-10-05-platform-feedback.md)), PLT-BR-6 (D-9), PLT-BR-7 (D-25), PLT-BR-8 (D-21).

## 3. Data model

The platform owns little data: currency reference data and market rates (D-15), idempotency records (D-13), rate-limit counters (D-22), the queue's schema (D-9), the migrations journal in staging and production (D-12), and two storage buckets (D-35). It **removes** the existing `users`, `accounts`, `accountOwners` and `refreshTokens` tables from the codebase: the database is disposable (spec §7 item 1) and `identity` and `accounts` design their own tables fresh (spec §7 item 2).

### 3.1 Tables and stores

| Table / store | New / changed | Purpose | Key columns | Relationships |
| ------------- | ------------- | ------- | ----------- | ------------- |
| `currencies` | Changed (replaces the current table and the `CURRENCY` enum) | ISO 4217 reference data; the source of each currency's number of decimals (XC-1). | `code` (ISO 4217 alpha-3, primary key), `name`, `minor_units` (0 to 4), `is_active` (withdrawn currencies such as EEK are inactive: kept for history, hidden from pickers). Only real ISO 4217 currencies: no metals (XAU, XAG, XPT, XPD), no SDR (XDR), no testing or fund codes, no crypto. | Referenced by `exchange_rates`; later by accounts, users (base currency) and any table holding money. |
| `exchange_rates` | New | Daily market rates (XC-3), stored against one pivot currency (USD) so any cross rate can be derived. | (`currency_code`, `rate_date`) primary key; `units_per_usd` `numeric(24,12)`, parsed losslessly from the provider; `provider`; `fetched_at`. A stored row is **final** (insert-only). | `currency_code` → `currencies.code` (`restrict`). |
| `idempotency_records` | New | Makes create-type mutations safe to retry (offline sync, web retries) without probing or resurrection (D-13). | (`user_id`, `idempotency_key`) primary key; `procedure`; `request_hash` (SHA-256 of the canonical validated input); `response_status`; `result` (`jsonb`, only `{ id, createdAt }`, never entity content); `created_at`; `expires_at` (90 days). | `user_id` → `identity`'s users table with `cascade`, declared in `identity`'s schema (the platform is built before that table exists; both reach staging in the baseline release migration). |
| `rate_limit_counters` | New (`UNLOGGED`) | Shared fixed-window counters for sensitive endpoints, so limits hold across stateless API instances (D-22). | (`bucket_key`, `window_start`) primary key; `hits`; `expires_at`. `bucket_key` is the limiter name plus an **HMAC** of the subject (IP or email), never the raw value. | None. |
| `pgboss` schema | New | pg-boss's tables. | Owned by the `budmon_queue` role; installed and upgraded by the platform's queue schema step for the pinned pg-boss version, in every environment (D-12); pg-boss's own maintenance may create and drop objects inside this schema only (D-12). | Job payloads reference other tables' IDs only, never by foreign key. |
| `drizzle.__drizzle_migrations` | New | The applied-migrations journal. | Managed by Drizzle's migrator; exists in staging, production and release-path test databases (development databases are pushed, D-12). | None. |
| Bucket `exports` | New (S3-compatible object storage, D-35) | Generated data exports (XC-17). | Objects under `users/<userId>/exports/<exportId>.<ext>`; private; deleted after 7 days by a purge job. | Metadata rows are `identity`'s. |
| Bucket `erasure-log` | New (S3-compatible object storage, D-35) | Append-only erasure records (internal user ID + time) to replay after a backup restore (D-30). | One object per erasure; written with a key that can't delete; Object Lock 30 days where available, then lifecycle deletion. | None. |
| Bucket `backups` | New (S3-compatible object storage, D-30) | pgBackRest repository (production only). | Client-side encrypted backups and WAL; 14-day time-based retention. | None. |
| `users`, `accounts`, `accountOwners`, `refreshTokens` | **Removed** | Replaced by `identity` and `accounts` designs (spec §7). | | |

Conventions every module's tables follow (detailed in the LLD):

- **Names:** `snake_case`, plural table names (D-12).
- **Primary keys:** UUIDv7 generated by the server (D-13), except reference tables with a natural key (`currencies.code`).
- **Money columns:** `bigint` minor units plus a `currency_code` column (or a currency fixed by a parent row), never `numeric`, `real` or `double precision` (D-14).
- **Time columns:** `timestamptz` for instants, `date` for calendar dates, `text` IANA zone names; never `timestamp without time zone` (D-16).
- **Every table** has `created_at` and `updated_at`; author columns where a story needs them (for example ACC-US-7).
- **Every foreign key** states its `onDelete` behaviour explicitly (D-17).
- **Sealed secrets** (D-19) live in the owning module's table as one `bytea` column holding a versioned envelope; no central secrets table.
- **Tables holding a user's data** are covered by `identity`'s erasure (XC-16): each module's LLD states how (cascade from the user, or an explicit erasure step).

### 3.2 Entity-relationship diagram

```mermaid
erDiagram
  currencies ||--o{ exchange_rates : "has daily rates"
  currencies {
    char3 code PK "ISO 4217 alpha-3"
    text name
    smallint minor_units "0 to 4"
    boolean is_active
  }
  exchange_rates {
    char3 currency_code PK "FK currencies.code"
    date rate_date PK "UTC day the rate closes"
    numeric units_per_usd "numeric(24,12), final once stored"
    text provider
    timestamptz fetched_at
  }
  idempotency_records {
    uuid user_id PK "FK users added by identity"
    uuid idempotency_key PK
    text procedure
    bytea request_hash
    smallint response_status
    jsonb result "only id + createdAt"
    timestamptz expires_at
  }
  rate_limit_counters {
    text bucket_key PK "limiter + HMAC(subject)"
    timestamptz window_start PK
    integer hits
    timestamptz expires_at
  }
```

### 3.3 Data lifecycle

- **`currencies`:** loaded from a committed ISO 4217 data file by the idempotent reference-data step (D-12); never deleted (`is_active = false` instead). `minor_units` never changes in place: an ISO change would be a deliberate data migration that rescales every stored amount in that currency.
- **`exchange_rates`:** insert-only; a stored day is final and is never overwritten by the application (a provider correction would be a deliberate, reviewed data migration). Kept indefinitely (about 160 currencies × 365 days ≈ 58k rows a year).
- **`idempotency_records`:** deleted 90 days after creation by a platform maintenance job, and with the user on erasure.
- **`rate_limit_counters`:** `UNLOGGED` (a database crash only resets limits); expired rows deleted every 10 minutes.
- **Jobs:** every finished job (completed or failed) is deleted 7 days after it finishes (pg-boss keeps one retention for finished jobs). A job that exhausts its retries is also copied to its role's **dead-letter queue**, which no worker consumes, so its jobs stay queued until the dead-letter queue's own retention (30 days) expires them: that's where failed jobs are inspected (PLT-US-4). Payloads hold IDs only and failure output is sanitised (D-10, D-24), so retention isn't a privacy concern.
- **Exports bucket:** objects deleted by the platform purge job 7 days after creation (lifecycle rule as backstop), and immediately on user erasure (prefix `users/<userId>/`).
- **Erasure-log bucket:** each record is kept 30 days (longer than backup retention, D-30), then deleted.
- **Deletion convention for all modules (D-17):** hard delete is the default; lifecycle states are explicit status columns; soft delete only where a story requires restoring (for example REV-US-4), always with a purge job.
- **Backups (D-30):** daily, kept at most 14 days, point-in-time recovery over at least the last 7 days (as the user accepted). Erasures are replayed after any restore.
- **Telemetry retention** (D-24): logs, traces and error reports keep internal IDs (never names, emails or financial data) for at most 30 days.

## 4. User experience

The platform has almost no screens of its own. What applies is: how unexpected errors, rate limits, offline state and app updates look to the end user, which every module's screens reuse; and how the product owner sees errors and health, which is in external tools (Sentry, Grafana), not in Budmon.

Budmon has no design language yet: `docs/design/ux-guidelines.md` doesn't exist and XC-24 (proposal P8: English first, WCAG 2.2 AA, Android accessibility guidelines, a calm and plain tone) is still open. The conventions below follow P8 provisionally; P8 for the app's UI is still open (Q-17).

### 4.1 User journeys

**J-1 Something goes wrong on Budmon's side (US-9, US-10).** An end user does anything (saves a transaction, opens a list). The server hits an unexpected error. What the user sees depends on whether the server knows nothing was saved (D-21, `outcome`):
- **Nothing was saved** (`outcome: not_applied`): "Something went wrong on our side. Nothing was changed. Try again in a moment." with **Try again** and "Reference: 4bf92f35" (the first 8 characters of the request ID). Form input is kept.
- **Unknown** (`outcome: unknown`, for example the error happened after the change was committed, or the connection dropped after sending): "We couldn't confirm this was saved. Check before trying again." **Try again** is still offered for creates, because every create carries an idempotency key (D-13): a retry returns the original result rather than creating a duplicate.
- Reads show the first message without "Nothing was changed" wording issues (reads change nothing).
- If the user reports the reference, the product owner finds the error in Sentry and the trace in Grafana. The report contains the reference, the user's internal ID, the error type and the code location, never what they typed.
- *Goes wrong:* retrying fails again: same message; nothing is lost. A screen-level failure while loading shows the full-screen fallback (S-2).

**J-2 Invalid input (US-9).** The user submits a form with a value the server rejects. The field is outlined, an icon and message appear under it (for example "Enter an amount greater than 0"), focus moves to the first invalid field, and a screen reader announces the error. The client maps the error's field paths to its fields. Client-side validation catches most of these first using the same rules from the contract's schemas (D-6).
- *Goes wrong:* a field the form doesn't show is rejected: the message appears at the top of the form ("Something in this form isn't valid: <field label>").

**J-3 Too many attempts (US-13).** The user (or an attacker) repeats a sensitive action too often. The form shows "Too many attempts. Try again in 10 minutes." with the wait from the server's `Retry-After`, and the submit button is disabled until then (the countdown is in text, not only a graphic).

**J-4 Offline on Android (XC-22; shared conventions that `transactions` uses for TXN-US-10).** The phone loses its connection. A slim banner appears: "You're offline. New entries are saved on this phone and sync when you're back online." Screens that need the network keep showing what's **already loaded in memory** (there's no persisted read cache in the MVP), marked "Offline: last updated 14:02", and disable server actions, explaining why on tap. If the app was restarted while offline, those screens show "You're offline. Connect to see this." New transactions and transfers can still be recorded (`transactions`). Each such entry shows a "Not yet synced" chip (icon + text). The app bar shows "3 waiting to sync". When back online: "Back online. Syncing 3 entries…", then chips disappear as entries sync.
- *Goes wrong:* the server rejects a synced entry (for example the account was archived or the user lost their role): the entry stays on the phone marked "Couldn't sync: tap to fix", and the app bar shows "1 entry needs attention". Nothing is silently dropped.
- *Goes wrong:* an entry has waited more than 60 days (close to the 90-day idempotency window, D-13): it isn't sent automatically; it's marked "Check before syncing" so the user confirms it, which prevents a duplicate if an earlier attempt had in fact succeeded.
- *Goes wrong:* the API says the app must be updated (J-5): sync pauses; entries stay "Not yet synced" (not "needs attention").
- (Whether offline entries count in on-device balances is P6, owned by `transactions`.)

**J-5 App update (Android, D-33).** When a newer build is available, a dismissible card on the home screen says "A new version of Budmon is available." with **Update** and **Later** ("Later" hides it for 3 days). When the installed build is below the minimum the API supports, the API answers every request with `CLIENT_UPDATE_REQUIRED`, offline sync pauses, and the app shows **Update required** (S-1): "Entries you saved offline are kept and will sync after you update." Recording new offline entries stays possible from that screen.
- *Goes wrong:* the download link fails: "Couldn't open the download. Ask the person who invited you for the latest version." (distribution, A-12).

**J-6 Web app update.** After a new web release, the open web app notices (it checks the deployed version on window focus and every 30 minutes) and shows a non-blocking toast: "Budmon has been updated. Reload to get the latest version." with **Reload**. It never reloads by itself, so unsaved input isn't lost. If the API reports `CLIENT_UPDATE_REQUIRED` to the web app, the toast becomes a persistent banner with the same button.

**J-7 Budmon is down or in maintenance.** The API is unreachable, or the maintenance switch is on (D-29: used for queue-upgrade releases and host work), and requests get 503 `SERVICE_UNAVAILABLE`: "Budmon is temporarily unavailable. Try again in a few minutes." Android keeps recording offline entries. No status page in the MVP.

**J-8 The product owner is alerted (US-10, US-11).** Something breaks (the API stops answering, a worker stops, Gmail notifications back up, a connected Gmail inbox hasn't synced for a day, jobs fail unexpectedly, the VM's disk fills, a backup is overdue). The owner gets an email from Grafana Cloud within about 5 to 15 minutes: subject "[Budmon] Capture worker down", with what's wrong, since when, and links to the dashboard and Sentry. The dashboard shows request rate, errors, latency, queue depth, dead-lettered jobs, Gmail push activity and capture connections by status (counts only). None of these show amounts, payees, message content, tokens, names or emails. When the problem clears, a "Resolved" email follows. First-time experience: right after the first deploy, panels show "No data" until traffic arrives; the synthetic health check produces data within 5 minutes, which proves the pipeline works.
- *Goes wrong:* the monitoring itself fails (Grafana Cloud down, free-tier limit hit): alerts can't fire. Mitigation: a monthly glance at usage against free-tier limits; a second independent uptime check is deferred (D-25).

### 4.2 Screens

| Screen | Purpose | Information hierarchy (first → last) | Primary action | Other actions |
| ------ | ------- | ------------------------------------ | -------------- | ------------- |
| S-1 Update required (Android) | Block use of an app version the API no longer supports, without losing offline entries. | What happened and that it's safe → why → how many offline entries are kept → download | **Update Budmon** | Record an entry offline |
| S-2 Error fallback (web and Android) | Replace a screen that failed to load or crashed. | What happened → what to do → reference | **Try again** | Go to home |

Shared components, used inside every module's screens:

| Component | Purpose | Behaviour |
| --------- | ------- | --------- |
| C-1 Offline banner (Android; the web app shows the same text without the offline-entry sentence) | Tell the user they're offline and what still works. | Appears when connectivity is lost, replaced by "Back online…" for 3 seconds when it returns. |
| C-2 Sync indicator and "Not yet synced" chip (Android) | Show pending and failed offline entries. | App-bar indicator with a count; chip on each pending entry; tapping a failed one opens it with the server's error. |
| C-3 Error message patterns | One look for every module's errors. | Inline field error (icon + text under the field), form-level summary, toast for background failures, full-screen fallback (S-2) for screens that can't load. |
| C-4 Update card (Android) and toast (web) | Announce a new version. | J-5 and J-6. |

S-1 Update required (Android):

```
+----------------------------------+
|                                  |
|        [ update icon ]           |
|                                  |
|  Update Budmon to continue       |
|                                  |
|  This version is no longer       |
|  supported. Updating takes about |
|  a minute.                       |
|                                  |
|  (i) 3 entries you saved offline |
|      are kept and will sync      |
|      after you update.           |
|                                  |
|  [       Update Budmon        ]  |
|                                  |
|     Record an entry offline      |
+----------------------------------+
```

S-2 Error fallback (both apps; web shown):

```
+----------------------------------------------+
| Budmon                          [nav ...]    |
|----------------------------------------------|
|                                              |
|   Something went wrong on our side           |
|                                              |
|   Try again in a moment. If it keeps         |
|   happening, share this reference with the   |
|   person who invited you.                    |
|                                              |
|   [ Try again ]   Go to home                 |
|                                              |
|   Reference: 4bf92f35                        |
+----------------------------------------------+
```

C-1 and C-2 on Android:

```
+----------------------------------+
| (!) You're offline. New entries  |
|     are saved on this phone.     |
|----------------------------------|
| Transactions      [⟳ 3 waiting]  |
|                                  |
|  Coffee         25.00 EGP        |
|  Today · Cash   [⟳ Not yet synced]|
|  Groceries     412.50 EGP        |
|  Yesterday · Bank                |
+----------------------------------+
```

### 4.3 Navigation

The platform adds no navigation destinations of its own. The update-required and error screens sit in front of any screen:

```mermaid
flowchart LR
  Any[Any screen] -- unexpected error while loading --> S2[S-2 Error fallback]
  S2 -- Try again --> Any
  S2 -- Go to home --> Home[Home]
  Any -- API says CLIENT_UPDATE_REQUIRED --> S1[S-1 Update required]
  S1 -- Update Budmon --> Dist[App download page]
  S1 -- Record an entry offline --> Entry[Offline entry form, transactions module]
```

### 4.4 States

| Screen | Empty | Loading | Error | Partial / a lot of data |
| ------ | ----- | ------- | ----- | ----------------------- |
| S-1 Update required | No offline entries: the "(i) entries kept" line is hidden. | Not applicable (shown from local state). | Download link fails: inline message (J-5). | 1,000+ offline entries: "1,000+ entries you saved offline are kept". |
| S-2 Error fallback | Not applicable. | **Try again** shows a spinner in the button and keeps the message. | Retry fails: the screen stays, with "Still not working." added. | Not applicable. |
| C-2 Sync indicator | Hidden when nothing is pending. | "Syncing 3…" with a progress icon (not colour only). | "1 entry needs attention". | "99+ waiting". |
| Product-owner dashboards (Grafana) | "No data" until traffic; the synthetic check fills within 5 minutes. | Grafana's own. | Grafana's own. | Metric labels are bounded (D-25). |

### 4.5 Interaction and feedback

- **Error mapping** is by stable error key, never by parsing messages (D-21). Each client has one table mapping keys to wording; unknown keys fall back to the generic message.
- **Validation errors** are shown inline on submit, and as the user leaves a field when the client already knows the rule from the contract's schema. Server-side validation errors map back to fields by path.
- **Mutations** show progress on the button that triggered them and update the screen after the server confirms. A create returns only `{ id, createdAt }` (D-13), so clients invalidate and refetch the affected list queries (web: TanStack Query invalidation; Android: the list's paging source refreshes) rather than reading the new entity separately. Optimistic updates are a per-module choice; a failure rolls back the change and shows a toast. Offline entries on Android appear immediately with "Not yet synced".
- **Retries:** clients automatically retry only reads and idempotency-keyed creates (D-13), with backoff; other mutations are retried only when the user taps **Try again**. Updates set values (so a repeat is harmless) and a repeated delete that returns `NOT_FOUND` is treated as success.
- **Every response carries `X-Request-Id`**; clients show its first 8 characters as "Reference" on generic errors only.
- **Confirmation and undo** are per module; the platform adds none.

### 4.6 Effort on frequent tasks

The frequent tasks (recording a transaction, reviewing a capture, checking a balance) belong to other modules. The platform's job is not to add steps or latency to them:
- Update prompts never interrupt a task: the soft prompt is a dismissible card on home; the hard block happens only below the minimum supported version (D-33).
- Offline entry is never blocked by the platform, not even by the update-required screen.
- Latency targets for every module (D-25): API p95 under 300 ms for single-item reads and writes, under 800 ms for list and aggregate reads, measured server-side.

### 4.7 Presentation of data

Platform-wide conventions, implemented once in `@budmon/shared` (D-14, D-16) and in Android's equivalent, checked against shared test vectors so both apps agree:

- **Money:** formatted with the user's locale and the currency's code or symbol through `Intl.NumberFormat` (web) and ICU (Android), always with **the currency's `minor_units` from Budmon's `currencies` table** as the number of decimals, overriding the library default ("1,234.50 EGP", "1,234 JPY", "1.234 KWD"). All decimals are always shown. The helper can show a sign (`−12.50`) or not; whether a module shows a minus sign or colours an amount is its UX choice, and colour is never the only cue.
- **Converted amounts** (D-15) can be marked as approximate when the conversion is provisional; modules decide whether to show the mark.
- **Dates:** calendar dates are shown in the user's locale and never shifted by time zone. Instants are shown in the user's time zone (XC-5). Relative times ("2 hours ago") only under 7 days; older ones show the date.
- **Large numbers** don't abbreviate in money fields; reports may abbreviate axis labels.

### 4.8 Platform and accessibility

- **Web:** evergreen browsers (Chrome, Edge, Firefox, Safari, last 2 versions); responsive from 360 px wide to desktop. The platform's components meet WCAG 2.2 AA (P8, provisional): banners use `role="status"` with `aria-live="polite"`, error summaries `role="alert"`, focus moves to the error summary or the first invalid field on submit, contrast at least 4.5:1, all actions keyboard-reachable. Automated axe checks run in the web end-to-end tests (D-26).
- **Android:** Android 8.0 (API 26) and later (A-6), phones first; Material 3 with font scaling to 200% without clipping, TalkBack labels on every icon (the sync chip reads "Not yet synced"), touch targets at least 48 dp, and meaning never conveyed by colour alone.

### 4.9 Wording

Plain, calm, never blaming the user (P8). Key strings (English; clients hold them in message catalogs so other languages can follow):

| Where | Text |
| ----- | ---- |
| Generic error, nothing saved (`INTERNAL`, `outcome: not_applied`) | "Something went wrong on our side. Nothing was changed. Try again in a moment." |
| Generic error, outcome unknown (`INTERNAL`, `outcome: unknown`; or a timeout after sending) | "We couldn't confirm this was saved. Check before trying again." |
| Generic error on a read | "Something went wrong on our side. Try again in a moment." |
| Reference line | "Reference: {first 8 characters of request ID}" |
| Validation, form level (`VALIDATION_FAILED`) | "Some details need fixing." (each field shows its own message) |
| Rate limited (`RATE_LIMITED`) | "Too many attempts. Try again in {n} minutes." |
| Unavailable (`SERVICE_UNAVAILABLE`, network failure) | "Budmon is temporarily unavailable. Try again in a few minutes." |
| Not found (`NOT_FOUND`) | "This item doesn't exist or you no longer have access to it." |
| Forbidden (`FORBIDDEN`) | "You don't have permission to do this." |
| Offline banner | "You're offline. New entries are saved on this phone and sync when you're back online." |
| Offline, nothing loaded | "You're offline. Connect to see this." |
| Back online | "Back online. Syncing {n} entries…" |
| Chips | "Not yet synced" / "Couldn't sync: tap to fix" / "Check before syncing" |
| Update card | "A new version of Budmon is available." Buttons: "Update", "Later" |
| Update required | Title "Update Budmon to continue"; body "This version is no longer supported. Updating takes about a minute."; note "{n} entries you saved offline are kept and will sync after you update."; button "Update Budmon"; link "Record an entry offline" |
| Web update toast | "Budmon has been updated. Reload to get the latest version." Button "Reload" |
| Alert email subject | "[Budmon] {alert name}" and "[Budmon] Resolved: {alert name}" |

`NOT_FOUND` deliberately doesn't distinguish "doesn't exist" from "not yours" (§7.1).

## 5. Interfaces, protocols and integrations

### 5.1 Process and component overview

Invite-only deployment (D-29): one production VM and one staging VM at Hetzner, each running the same Docker Compose project. Diagram shows one environment.

```mermaid
flowchart LR
  subgraph Clients
    Web[Web app<br/>Solid SPA]
    And[Android app<br/>Kotlin + Compose]
  end
  subgraph VM[Hetzner VM, one per environment, Docker Compose]
    Caddy[Caddy<br/>TLS, static SPA, /api reverse proxy,<br/>maintenance switch]
    API[api<br/>Fastify + oRPC, stateless]
    WG[worker-general<br/>FX, notifications, deletion,<br/>exports, maintenance, gauges]
    WC[worker-capture<br/>Gmail listener, OAuth exchange,<br/>capture jobs]
    PG[(postgres<br/>data + pgboss schema,<br/>pgBackRest WAL archiving)]
    Alloy[Grafana Alloy<br/>logs, host and Postgres metrics,<br/>OTLP relay with attribute allowlist]
  end
  Web -- "HTTPS https://domain/ and /api/v1" --> Caddy
  And -- "HTTPS /api/v1" --> Caddy
  Caddy --> API
  API --> PG
  WG --> PG
  WC --> PG
  API -. "seal with public key (no credentials)" .-> WC
  WC -- "asymmetricDecrypt (capture service-account key)" --> KMS[Google Cloud KMS]
  Gmail[Gmail API] -- watch notifications --> PS[Google Cloud Pub/Sub topic]
  WC -- streaming pull --> PS
  WC -- OAuth token exchange, history, messages --> Gmail
  API -- presigned URLs --> OBJ[(Backblaze B2, EU<br/>exports, erasure log, backups)]
  WG -- write exports, erasure records --> OBJ
  PG -- encrypted backups + WAL --> OBJ
  WG --> FX[FX rate provider]
  WG --> FCM[FCM push]
  WG --> Mail[Transactional email]
  API & WG & WC -- OTLP --> Alloy
  Alloy --> Graf[Grafana Cloud]
  API & WG & WC & Web & And -. errors .-> Sentry[Sentry]
```

The dashed API→worker-capture arrow is logical: the API seals with the `capture-credentials` public key and stores the envelope; it never calls worker-capture.

### 5.2 Client ↔ API: one HTTP JSON surface defined by the oRPC contract (D-4, D-6)

- **Transport:** HTTPS, JSON, REST-style paths under `https://<domain>/api/v1`, on the same origin as the web app (D-36), generated from the oRPC contract by oRPC's OpenAPI handler mounted in Fastify. The **web app** calls it with oRPC's `OpenAPILink` driven by the same contract; the **Android app** calls it through a Kotlin client generated from the committed `openapi.json`. Both clients hit the same routes.
- **No sensitive values in URLs (D-24):** paths and query strings may contain only IDs, enum values, dates, limits and encrypted cursors. Procedures whose inputs include amounts, payee names, note or message text, emails or tokens are `POST` with a JSON body, even when they only read (for example a transaction search with a payee or amount filter). A contract test enforces this (D-6).
- **Idempotency (D-13):** every create-type procedure requires an `Idempotency-Key` header (a UUID generated by the client per user action); both apps send it.
- **Auth transport** (bearer token vs cookie) is `identity`'s decision. The platform supports both: an auth hook in the oRPC context and `@fastify/cookie`; the API is same-origin with the web app, so no CORS is configured (D-36).
- **Errors:** oRPC's error envelope, with Budmon keys as codes (D-21).
- **Real-time:** none in the MVP. The web app refetches on focus and after mutations; Android receives push through FCM (`notifications`). No story needs sub-second updates; SSE or WebSockets would add long-lived connections to a stateless API. oRPC supports event streams if a later story needs them.
- **Non-contract routes:** `GET /health/live` (process up; reachable only inside the Docker network) and `GET /health/ready` (database reachable and at the expected migration level; exposed through Caddy, which answers it itself during maintenance, D-29), plain Fastify routes, unauthenticated, excluded from OpenAPI, returning no internals. `GET /api/v1/meta/client-config` (in the contract) returns the minimum supported and latest client versions (D-33). In local development only, a route serves files from the filesystem object store in place of presigned URLs (D-35).
- **Client identification:** both apps send `X-Budmon-Client: android/<versionCode>` or `web/<build id>`; used only for D-33 and as the `client_kind` metric label.

### 5.3 Jobs and workers (D-9, D-10)

- **pg-boss** in the same Postgres. Modules use it only through the platform's `JobQueue` interface: define a job (name `<module>.<job>`, a zod payload schema, the worker role that runs it, retry policy, queue policy), enqueue it inside a database transaction, or schedule it with cron.
- **Two worker roles from one codebase**, each a separately deployed process (PLT-BR-6):
  - **worker-capture:** the only process allowed to decrypt capture credentials (PLT-BR-2). Runs the Gmail Pub/Sub listener, the OAuth code exchange (D-19), and every job that needs a user's credentials or raw message content (owned by `sources` and `capture`), plus re-wrapping of capture envelopes.
  - **worker-general:** everything else: FX rates (platform), notification and reminder delivery (`notifications`), deletion after the grace period and exports (`identity`), reconciliation of derived values (`accounts`, `budgets`), capture-connection health gauges, and platform maintenance.
  - In local development both roles can run as one process (`WORKER_ROLES=capture,general`); in deployed environments they're separate, so the decrypt permission stays isolated.
- **Inbound data that can only arrive through the API** (SMS content uploaded by the Android app, OAuth callbacks) is validated, sealed with the capture key, stored in the owning module's table and enqueued; processing happens in worker-capture (A-1).

### 5.4 Integrations

| Integration | Used for | Owner | Failure modes and behaviour |
| ----------- | -------- | ----- | --------------------------- |
| Google Cloud KMS (asymmetric key `capture-credentials`) | Unwrapping data keys of capture secrets in worker-capture (D-19). Sealing needs no KMS call (public key). | platform | **Down or slow:** unsealing fails, so capture jobs retry with backoff (about 1 hour) and then dead-letter; nothing is lost because a mailbox's history ID isn't advanced until a sync succeeds. Sealing in the API is unaffected. **Key version disabled or credentials revoked** (incident response): same, plus an alert. Timeout 5 s per call. Decrypt calls are recorded in Cloud Audit Logs (principal and key only) and a Cloud Monitoring alert fires on an abnormal decrypt rate. |
| Google Cloud Pub/Sub (pull subscription) | Gmail `watch` notifications (PD). | platform hosts the listener; `sources`/`capture` own the handling | **Listener down:** notifications accumulate (retained 7 days) and are processed on restart; alert when the oldest unacknowledged message is older than 15 minutes. **Notification lost or watch expired:** the safety-net sync (at least every 6 hours) catches up, and the stale-connection gauge alerts after 24 hours (D-25). Notifications contain only an email address and a history ID; the address is never logged. Streaming pull is an outbound gRPC connection, so it works from the Hetzner VM. |
| Gmail API and Google OAuth token endpoint | Exchanging authorization codes, reading in-scope messages. | `sources`, `capture` | Designed in those modules. Platform constraints: runs only in worker-capture; destinations are fixed Google hosts from configuration (D-19). Expired or revoked tokens are a connection state, not a job failure (D-25). |
| FX rate provider (Open Exchange Rates; fallback `fawazahmed0/exchange-api`) | Daily market rates (XC-3). | platform (D-15) | **Primary down:** the daily job retries with backoff for up to 6 hours, then fetches the day from the fallback and records `provider` accordingly; conversions keep working provisionally from the latest stored day; alert if no new day for 36 hours. **Bad data** (unknown currency, zero, negative, unparseable): that currency's row is rejected and counted in a metric. |
| S3-compatible object storage (Backblaze B2, EU region) | Exports and the erasure log (D-35); database backups (D-30). | platform | **Down:** export jobs retry, then dead-letter; the user can request the export again (`identity`). Erasure-log write failure stops the erasure before any data is deleted (D-30). pgBackRest queues WAL locally while the repository is unreachable; an alert fires if archiving fails for 15 minutes (local WAL growth would otherwise fill the disk). |
| Firebase Cloud Messaging | Android push. | `notifications` | Designed there; runs in worker-general. |
| Transactional email | Invitations, password reset, deletion notices (XC-27). | `identity` / `notifications` | Designed there; runs in worker-general through a provider adapter; Mailpit locally, a fake in tests. |
| Sentry | Error reports from all three apps (PD). | platform | **Down or quota reached:** reports are dropped after the SDK's buffer; the app is unaffected. Errors are still in logs. |
| Grafana Cloud (via Grafana Alloy on each VM) | Traces, metrics, logs, alerting, synthetic check (PD). | platform | **Down:** Alloy buffers to disk up to a size limit and then drops; apps never block. Logs are also kept locally by Docker's log rotation (3 × 10 MB per container). |
| GitHub Container Registry | Release images pulled by the deploy script (D-29). | platform | **Down:** the deploy fails before touching the running stack; the previous release keeps running. |
| App distribution (Firebase App Distribution, A-12) | Android builds for the invited group. | platform | Download failure handled in J-5. |

## 6. Key flows

**F-1 A request, from client to database and back, including the error paths.**

```mermaid
sequenceDiagram
  participant C as Client (web/Android)
  participant F as Fastify (API)
  participant O as oRPC handler + middleware
  participant S as Module service
  participant R as Repo(s)
  participant Q as JobQueue
  participant DB as Postgres
  C->>F: POST /api/v1/... (JSON, X-Budmon-Client, Idempotency-Key on creates)
  F->>F: request ID = trace ID, rate limit, body limit (parse errors get a fixed message)
  F->>O: route to procedure
  O->>O: client version check (D-33), authenticate (identity hook), validate input (zod)
  alt input invalid
    O-->>C: 400 VALIDATION_FAILED {issues:[{path,code,message}]}, no input values
  end
  O->>S: call with context (principal, clock, tx factory)
  S->>DB: BEGIN
  opt create with Idempotency-Key
    S->>DB: insert idempotency record or find existing (D-13)
    Note over S,DB: existing + same hash: return stored {id, createdAt} (router validates it as usual)
  end
  S->>R: reads/writes with tx
  S->>Q: enqueue(tx, "module.job", {ids only})
  S->>DB: store {id, createdAt} + status in idempotency record, COMMIT (request marked "committed")
  S-->>O: result
  O->>O: validate output against contract
  O-->>C: 200 JSON
  Note over S,O: BudmonError: rollback, map key/status/details to the error envelope
  Note over S,O: Any other error: rollback if open, report type + stack only (D-24),<br/>500 INTERNAL with outcome not_applied (nothing committed) or unknown (committed), X-Request-Id
```

**F-2 Transactional enqueue, processing, retry and dead-lettering.**

```mermaid
sequenceDiagram
  participant S as Service (API or worker)
  participant DB as Postgres
  participant W as Worker (role that owns the queue)
  participant H as Job handler (wrapped by platform)
  S->>DB: BEGIN; write domain rows; INSERT pgboss job (same tx); COMMIT
  Note over S,DB: Rollback removes the job too
  W->>DB: fetch next job
  W->>H: handle(payload validated by zod)
  alt success
    H->>DB: domain writes (own tx), idempotent by design
    W->>DB: complete job
  else throws
    H->>H: wrapper replaces the error with a sanitised one<br/>(error key or class, stack frames, allowlisted code)
    W->>DB: fail attempt (sanitised output only); retry with exponential backoff
    Note over W,DB: After retryLimit: copied to the role's dead-letter queue (kept 30 days);<br/>metric jobs_dead_lettered_total; owner retries with a CLI command
  end
```

**F-3 Connecting Gmail: the API never sees tokens or the client secret and can't decrypt anything it sealed (D-19).**

```mermaid
sequenceDiagram
  participant U as User's browser/app
  participant API as API (holds only the capture public key)
  participant DB as Postgres
  participant WC as worker-capture (holds capture service-account key)
  participant KMS as Google Cloud KMS
  participant G as Google OAuth + Gmail
  U->>API: start connection
  API->>API: generate state + PKCE verifier; seal verifier (random DEK, AES-256-GCM, DEK wrapped with RSA-OAEP public key)
  API->>DB: insert pending OAuth row {state, user ID, sealed verifier, expires in 10 min}
  Note over API,DB: works for Android (custom tab, bearer auth): the callback carries no session,<br/>so the state row, not a session, identifies the user
  API-->>U: redirect to Google consent (code challenge, state)
  U->>G: consent
  G-->>U: redirect to https://domain/api/v1/... callback with code + state
  U->>API: callback(code, state)
  API->>DB: look up unexpired pending row by state (single use)
  API->>API: seal {code} with the capture public key
  API->>DB: store sealed code + enqueue sources.gmail-exchange {pendingId} (one tx)
  API-->>U: "Connecting…" (polls status)
  DB-->>WC: job
  WC->>KMS: asymmetricDecrypt(wrapped DEKs)
  KMS-->>WC: DEKs
  WC->>G: token exchange (code, verifier, client secret held only by worker-capture)
  G-->>WC: refresh + access token
  WC->>WC: seal refresh token (AAD = table + row + purpose) with the public key; access token kept in memory only
  WC->>DB: store sealed token, mark connected, delete pending exchange (one tx)
  U->>API: poll status: "Connected"
  Note over WC,G: Code expired or exchange fails: pending exchange deleted, status "Couldn't connect, try again"
```

**F-4 Gmail push into capture jobs (with fan-out to several connections).**

```mermaid
sequenceDiagram
  participant G as Gmail
  participant PS as Pub/Sub topic + pull subscription
  participant L as Listener (worker-capture)
  participant DB as Postgres (pg-boss)
  participant J as capture job handler (worker-capture)
  G->>PS: {emailAddress, historyId} on mailbox change
  L->>PS: streaming pull
  PS-->>L: notification
  L->>L: HMAC(lowercased address) → look up connections by address hash (never logs the address)
  L->>DB: for each connection (one or more: same inbox connected twice, or a joint inbox of two users, CAP-BR-6):<br/>enqueue "capture.gmail-sync" {connectionId}, queue policy "stately", key = connectionId
  L->>PS: ack (only after the enqueues committed)
  DB-->>J: job
  J->>G: history.list since stored historyId (token opened per D-19)
  J->>DB: write captured transactions, advance historyId (same tx)
  Note over L,DB: "stately": at most one queued + one active job per connection,<br/>so a notification during an active sync queues one more run instead of being dropped.<br/>Listener crash before ack: Pub/Sub redelivers. Metric gmail_push_received_total{matched}.
```

**F-5 Contract change to clients (D-6).**

```mermaid
flowchart LR
  A[Edit contract in packages/contract] --> B[pnpm contract:openapi<br/>writes openapi.json]
  B --> C[Commit contract + openapi.json + server implementation]
  C --> D{CI}
  D --> D1[Server type-check:<br/>implement contract fully]
  D --> D2[Regenerate openapi.json,<br/>fail if it differs from committed]
  D --> D3[oasdiff vs main:<br/>fail on breaking changes]
  D --> D4[Contract rules test:<br/>money fields int64, GET inputs URL-safe]
  D --> D5[Web type-check against contract]
  D --> D6[Android: generate Kotlin client<br/>from openapi.json, compile, test]
```

**F-6 Daily FX rates and late-arriving days (D-15).**

```mermaid
sequenceDiagram
  participant Cron as pg-boss schedule (UTC 00:30)
  participant WG as worker-general
  participant P as FX provider
  participant DB as Postgres
  participant M as Subscribed modules (budgets, reports...)
  Cron->>WG: platform.fx-rates-fetch {rateDate = yesterday (UTC)}
  WG->>P: historical rates for rateDate (USD base), timeout 10 s
  alt ok
    WG->>WG: parse losslessly as decimal strings; keep active ISO codes only; reject bad values
    WG->>DB: INSERT exchange_rates for rateDate (ON CONFLICT DO NOTHING: stored days are final)
    WG->>DB: enqueue fx.rates-added {rateDate, affectedFrom, affectedTo} for each subscribed module (same tx)
    DB-->>M: module recomputes derived values that used provisional rates in [affectedFrom, affectedTo]
  else fails
    WG->>DB: retry with backoff, up to 6 hours, then dead-letter + alert after 36 h without a new day
  end
```

## 7. Cross-cutting concerns

### 7.1 Authorization

- **The platform provides the plumbing; modules decide the rules.** Every procedure is built from one of three bases: `publicProcedure` (explicit allowlist only: in the contract, sign-up/sign-in-type procedures, client config and similar), `authedProcedure` (requires a principal from `identity`'s authentication hook), and `ownerProcedure` (product owner, for `admin`). Resource-level checks live in each module's service.
- **Default deny, tested:** an automated test enumerates every procedure in the contract and calls it without credentials; anything not on the public allowlist must return `UNAUTHENTICATED` (401). This is the structural fix for the unauthenticated `GET /users` (CR X-1).
- **Not found vs forbidden:** reading another user's resource returns `NOT_FOUND` (404), not `FORBIDDEN`, so IDs can't be probed (XC-15, ACC-BR-4). `FORBIDDEN` (403) is for resources the caller can see but can't change (for example a viewer editing an entry, ACC-BR-2). Idempotency keys are scoped per user, so they can't be used to probe other users' data either (D-13).
- **Workers** act as the system, with the user or account ID in the job payload; handlers re-read current state (for example that the source is still connected, the account not frozen) instead of trusting the payload.
- **Database roles (least privilege)** (`budmon_admin` is the owner's interactive role for maintenance, used over SSH only):
  - `budmon_migrator` owns the application schema and is the only role that runs DDL there (the deploy migrate step in staging and production; the push onto empty development and feature-branch test databases).
  - `budmon_queue` owns the `pgboss` schema; pg-boss's internal connections (fetching, maintenance) in the workers use it. Its runtime DDL (pg-boss maintenance creating and dropping objects) is confined to that schema.
  - `budmon_app` (API and workers) gets DML on the application schema, and on `pgboss` tables through default privileges granted by `budmon_queue` (so it can enqueue inside its own transactions).
- **Row-level security** isn't used in the MVP (D-23).

### 7.2 Money and currency

- **Storage:** `bigint` minor units plus the currency code; decimals from `currencies.minor_units` (D-14, PLT-BR-3).
- **In TypeScript:** a `Money` value `{ minor: bigint, currency: CurrencyCode }`; arithmetic only through helpers that reject mixed currencies; no `number` arithmetic on money. ESLint rules ban `parseFloat`, `Number(...)` and `bigint({ mode: "number" })` in money code paths.
- **On the wire:** JSON integers in minor units bounded to ±(2^53 − 1), declared `integer`/`int64` in OpenAPI through the shared money codec; `number` in the contract's TypeScript types; converted explicitly to and from `bigint` at two places only: the server's routers and the web app's data hooks (D-14).
- **Aggregates:** `SUM` over `bigint` returns `numeric`, which the driver returns as a string; repos parse it straight to `bigint` (exact). A value outside the wire range fails the response loudly (`INTERNAL`, reported) rather than losing precision.
- **Rounding:** only conversion, percentages and allocation produce fractions. Conversion and percentages use exact rational `bigint` arithmetic and round once, half-to-even. **Converting a set of amounts rounds each item, then sums** (so totals equal the sum of the converted amounts users see). Allocation uses largest remainder so parts sum exactly (TXN-BR-2).
- **Multi-currency and FX:** D-15 (date semantics, provisional conversions, recomputation). Applied rates on transfers are `transactions`' data (TXN-BR-7), never overwritten by market rates.
- **Formatting:** §4.7.

### 7.3 Consistency and transactions

- **Unit of work:** services open the transaction (`withTransaction`) and pass the handle to every repo and to `JobQueue.enqueue`; repos never open their own. This replaces the `getInstance()` singletons (CR §4.1).
- **Isolation:** `READ COMMITTED` by default; modules use `SELECT … FOR UPDATE` on rows they derive from, or request `SERIALIZABLE` for a specific operation. `withTransaction` retries serialization failures and deadlocks (40001, 40P01) up to 3 times with jitter.
- **Commit tracking:** the request context records whether any transaction committed during the request; the error interceptor uses it for `outcome` (D-21).
- **Jobs and data change together:** same-transaction enqueue (F-2); no outbox table.
- **At-least-once jobs:** every handler is idempotent: check state first, use unique constraints as guards, and record external side effects (such as "push sent") in the module's table in the same transaction that completes the work.
- **Derived values** (balances, budget progress) are maintained incrementally in the same transaction as the change (PD), and a scheduled reconciliation job per module recomputes from source rows, corrects drift, and counts corrections in `reconcile_corrections_total{module}`. Conversions are deterministic given the stored rates, and the `fx.rates-added` job (D-15) tells modules exactly which dates' conversions changed, so incremental values and reconciliation converge.
- **Idempotent creates:** per-user idempotency keys and records (D-13).

### 7.4 Time and time zones

- **Instants:** `timestamptz` in the database, `Temporal.Instant` in TypeScript, RFC 3339 with `Z` on the wire.
- **Calendar dates** (a transaction's date, a budget period's start): `date` in the database, `Temporal.PlainDate` in TypeScript, `YYYY-MM-DD` on the wire, `java.time.LocalDate` on Android; never converted through a time zone.
- **Time zones:** IANA names (`Africa/Cairo`), validated against the runtime's zone database. The user's zone lives in `identity`'s profile; changing it doesn't move stored dates (IDN-US-3).
- **"Today" and periods** are computed from the user's zone (XC-5) through an injectable `Clock`.
- **Servers and cron run in UTC.** Per-user local times (quiet hours, reminders) are computed by the owning module.
- **FX dates:** a transaction's calendar date is matched to the rate stored for that same date (a UTC day) without zone conversion (D-15).
- **Library:** Temporal, native where the runtime has it, otherwise the polyfill, behind `@budmon/shared` (D-16).

### 7.5 Privacy and security

- **PLT-BR-1 enforcement** (D-24): allowlist-only logging; values that print as `[redacted]`; telemetry configured to capture no bodies, query strings, headers or local variables; messages of unexpected errors dropped everywhere; sanitised job output; no sensitive values in URLs; infrastructure logging (Caddy, Postgres, Docker, Alloy) configured by checklist; an attribute allowlist in Alloy; a privacy canary suite in CI and a canary gate on staging before each production release.
- **PLT-BR-2:** envelope encryption; the API seals with a public key and holds no credential that can decrypt; only worker-capture can unwrap through Google Cloud KMS (D-19). Residual risk stated in D-19: root on the production VM defeats process separation.
- **Secrets:** SOPS-encrypted files in the repository (age), decrypted only on the target VM at deploy into per-service files readable only by that service's container user (D-20); CI and agents never hold decryption keys for staging or production.
- **Transport:** TLS (Caddy, Let's Encrypt) for all client traffic, HSTS; Postgres isn't exposed outside the Docker network; all outbound integrations over TLS.
- **Host hardening (D-29):** SSH key-only with a forced-command deploy key; Hetzner Cloud Firewall allowing only 22, 80, 443; unattended security upgrades; containers as non-root users with read-only root filesystems, `no-new-privileges`, all capabilities dropped, memory limits; the Docker socket is mounted into no container.
- **At rest:** Hetzner doesn't advertise encryption at rest for cloud server disks, so the design doesn't rely on it: backups are encrypted client-side by pgBackRest before upload (D-30), exports live in a private bucket reachable only through 15-minute presigned URLs (D-35), and credentials are envelope-encrypted (D-19). **What a copy of the production disk (or a Hetzner snapshot or backup of it) exposes:** the Postgres data files (financial data, unencrypted at the block level), and, if the SOPS age key is stored on disk, every service's secrets, including worker-capture's service-account key, which lets the holder call KMS decrypt on the sealed tokens (audited, rate-alerted and revocable, but not prevented). Mitigations: the production age key is kept **only in tmpfs**, entered by the owner after each reboot (D-20, Q-15), so the disk holds no usable key material; **no Hetzner snapshots or Hetzner backups of the production VM** (hosts are rebuilt from cloud-init and OpenTofu, data from pgBackRest). Full-disk encryption is revisited before any public launch.
- **Job payloads** hold IDs only (D-10).
- **Hashing utilities** for `identity`: Argon2id for low-entropy secrets, HMAC-SHA-256 for high-entropy tokens, constant-time comparison, a random token generator (D-22).
- **Abuse protection:** rate limits, same-origin API (no CORS surface), headers, body limits, timeouts (D-22, D-36).
- **Errors** never leak internals (PLT-BR-8, D-21).
- **Data minimisation:** date of birth is dropped (spec §7 item 3); rate-limit keys and mailbox lookups use HMACs; telemetry retention capped at 30 days.
- **Android:** the local database (offline entries) is excluded from Android Auto Backup and device-to-device transfer, and never attached to Sentry reports.

### 7.6 Scale, performance and observability

- **Expected load (A-4):** invite-only, up to about 100 users, roughly 100 to 300 transactions per user per month; a few requests per second at peak. One 4 vCPU / 8 GB VM carries this with large headroom.
- **Large tables (web):** a requirement (D-7): ledgers and reports render with virtualised rows and keyset pagination; targets in D-7.
- **Path to public scale** (not designed now): stateless API (PLT-BR-6) and the queue behind an interface (PD) mean scaling is a deployment change: move Postgres to a dedicated server or managed service with a replica, put a transaction-mode pooler in front (code is already pooler-safe, D-18), run several API containers or hosts behind a Hetzner Load Balancer, give each worker role its own host, and put a CDN in front of the static SPA (path-based routing keeps `/api` on the origin). KMS, object storage, observability and the contract are unchanged.
- **Indexes per query:** every module's LLD lists each query with the index that serves it; `pg_stat_statements` is enabled and reviewed after each module ships.
- **Latency targets:** §4.6; tracked with request-duration histograms per route template.
- **Observability** (D-24, D-25): OpenTelemetry traces and metrics plus pino logs from API and workers through Alloy to Grafana Cloud; host and Postgres metrics from Alloy; Sentry for errors from all three apps; W3C trace context from clients; email alerting.

## 8. Decisions

Decisions D-1 to D-4, the queue and worker part of D-9, D-11's push, the core of D-14, D-18's pooler, D-19's managed key and capture-only decryption, and D-24's tool choices were **made by the user** (PD) and are recorded here with their rationale; they aren't reopened. The rest are the planner's proposals.

### D-1: PostgreSQL as the only database (user decision, PD)
- **Options considered:** PostgreSQL; MongoDB or another document store; PostgreSQL plus a document store.
- **Decision:** PostgreSQL. Flexible data (templates, extracted fields, budget rule conditions) goes in `jsonb`. Major version: the current stable major at implementation time (18 or later), pinned to the same major in local, CI and production.
- **Rationale:** the domain is relational and needs multi-row transactions (splits, transfers, balances); `jsonb` covers the flexible parts; the same database hosts the job queue (D-9).

### D-2: Node.js + TypeScript (user decision, PD), on Node 24 LTS with a planned move to 26
- **Options considered:** runtime: Node + TypeScript (chosen by the user); Kotlin/JVM; Go. Version: Node 24 (Active LTS until this month, then maintenance until April 2028); Node 26 (becomes LTS in October 2026).
- **Decision:** start on **Node 24 LTS**; move to Node 26 as a single pinned-version change (`engines`, `.nvmrc`, CI, Docker image) once it's LTS and the native and instrumented dependencies (`@node-rs/argon2`, pg-boss, OpenTelemetry instrumentations) support it, before the first production deploy if possible. TypeScript in strict mode with the review's settings kept (ESM, `module: nodenext`, `.js` import suffixes, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Production runs compiled JavaScript (`tsc -b`); development uses `tsx watch`.
- **Rationale:** the workload is I/O-bound (PD); one language across backend, web and contract lets the web app use the contract's types directly. Starting on the proven LTS avoids being first on a fresh major with native bindings; the move is cheap and planned.

### D-3: Fastify replaces Express (user decision, PD)
- **Options considered:** Express 5 (current), Fastify, Hono.
- **Decision:** Fastify, with `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie` (no `@fastify/cors`: the API is same-origin, D-36); oRPC's OpenAPI handler is mounted through its Fastify adapter. Fastify's built-in request logging is **disabled** (`disableRequestLogging`), replaced by the platform's allowlisted request log, and its logger uses the platform's serialisers for requests and errors (D-24).
- **Rationale (PD):** built-in pino logging, plugin encapsulation per module, `app.inject()` for in-process tests, better typing, mature plugins and OpenTelemetry instrumentation. Speed isn't the reason.

### D-4: oRPC contract-first, one OpenAPI-shaped wire protocol for both clients (user decision for oRPC; planner decision for the single protocol)
- **Options considered:** (a) oRPC serving both its native RPC protocol (web, `RPCLink`) and the OpenAPI protocol (Android); (b) only the OpenAPI protocol, with the web using `OpenAPILink`; (c) ts-rest (rejected by the user); (d) tRPC (the current stub; superseded).
- **Decision:** (b). The contract (`@orpc/contract`, zod 4 schemas) lives in `packages/contract`; the server implements it with `implement(contract)`; Fastify mounts only the `OpenAPIHandler` under `/api/v1`; the web uses `OpenAPILink` plus oRPC's TanStack Query integration. oRPC is pinned to an exact version.
- **Rationale:** with one protocol, the routes Android uses are exactly the routes the web uses and the tests exercise, and errors, dates and money are encoded once. The RPC protocol's richer native types (`Date`, `BigInt`) are things we don't want on the wire anyway, because Android needs plain JSON and money has its own codec (D-14).

### D-5: Monorepo with pnpm workspaces, no build orchestrator
- **Options considered:** (a) pnpm workspaces with plain scripts; (b) plus Turborepo or Nx; (c) separate repositories per app.
- **Decision:** (a). Layout:

  | Path | What | Package |
  | ---- | ---- | ------- |
  | `apps/server/` | API and workers (one codebase, several entry points). `src/platform/` holds the foundations (config, db, errors, observability, queue, crypto, http, storage, FX service, idempotency, rate limits); `src/<module>/` per spec module with `<module>Router.ts` (oRPC implementation; converts wire values to domain values), `<module>Service.ts`, `<module>Repo.ts`, `<module>Errors.ts`, `<module>Jobs.ts`, and `<module>Validators.ts` for server-only validation (third-party payloads); `src/db/schema/<table>.ts` (`<name>Table`, registered in `src/db/schema/index.ts`); `src/main/{api,worker,migrate}.ts`; `drizzle/` migrations; `test/` | `@budmon/server` |
  | `apps/web/` | SolidJS SPA (D-7) | `@budmon/web` |
  | `apps/android/` | Gradle project (D-8); not a pnpm package | (Gradle) |
  | `packages/contract/` | oRPC contract, zod schemas per module (`src/<module>/`), shared wire schemas (`src/common/`: money codec, dates, IDs, cursors, errors), contract-authoring rules, and the committed `openapi.json` | `@budmon/contract` |
  | `packages/shared/` | Pure helpers for server and web: `Money` and its arithmetic, formatting and wire conversion, time helpers, ID generation; `test-vectors/` (JSON) also read by Android tests | `@budmon/shared` |
  | `packages/config/` | Shared `tsconfig` bases, ESLint flat config, Prettier config | `@budmon/config` |
  | `infra/` | `compose.yaml` for local development; `deploy/` (environment Compose file, Caddyfile, Alloy config, cloud-init, deploy script, `budmonctl`); Dockerfiles; `tofu/` (OpenTofu); `secrets/` (SOPS files) (D-20, D-29) | |
  | `docs/` | As today | |

  Root scripts: `pnpm dev`, `pnpm check`, `pnpm check:all`, `pnpm test`, `pnpm db:reset`, `pnpm db:seed` (development), `pnpm db:release-migration` (release and hotfix branches), `pnpm db:migrate` (deploy), `pnpm contract:openapi`. The review's layering (router → service → repo; only repos touch the database) is kept and enforced with an ESLint import-boundary rule.
- **Rationale:** a handful of packages doesn't need a task graph; Turborepo can be added later without restructuring. One repo keeps contract, server and clients changing in the same pull request, which makes the drift check (D-6) possible. Android stays a plain Gradle project because pnpm can't build it.

### D-6: Contract → OpenAPI → clients, kept in sync by CI; additive API evolution
- **Options considered:** OpenAPI file generated at build time only vs generated and committed; Kotlin client committed vs generated at Gradle build time; drift caught by people vs by CI.
- **Decision:**
  - `pnpm contract:openapi` generates `packages/contract/openapi.json` (OpenAPI 3.1, oRPC's generator with `@orpc/zod`'s zod 4 converter and the platform's schema overrides, D-14) and it's **committed**.
  - The **web** imports the contract package; its client is `OpenAPILink` typed from the contract.
  - The **Kotlin client** is generated during the Android build from the committed `openapi.json` (OpenAPI Generator, `kotlin`, Retrofit + kotlinx.serialization) into the build directory; never committed or hand-edited (PLT-BR-4).
  - **Contract-authoring rules,** checked by a contract test: no `.transform()` or other schemas that convert to an untyped JSON schema; every money field uses the shared money codec and appears as `integer`/`int64` in `openapi.json`; `GET` procedures take only URL-safe inputs (IDs, enums, dates, limits, cursors; D-24); every create declares the `Idempotency-Key` header; every procedure declares its errors.
  - **CI fails if:** the server doesn't implement the contract exactly; a freshly generated `openapi.json` differs from the committed one; `oasdiff` reports a breaking change against main (unless the pull request is labelled as intentionally breaking, which also requires raising the minimum client version, D-33); the contract rules test fails; the web app doesn't type-check; the Android app doesn't compile or its tests fail against the regenerated client.
  - **Runtime:** oRPC validates inputs and outputs against the contract's schemas.
  - **Evolution policy:** additive only (new procedures, new optional fields, new enum values that clients tolerate as "unknown"). A breaking change is a new procedure plus deprecation of the old one, removed only after the minimum supported Android version no longer uses it.
- **Rationale:** each piece fails at the earliest stage that can detect it; generating the Kotlin client at build time removes "forgot to regenerate" drift; breaking-change detection matters because Android installs lag behind deploys.

### D-7: Web app: SolidJS single-page app (user decision for Solid; planner decision for the stack), with virtualised large tables
- **Options considered:** (a) React + Vite SPA (v0.3); (b) **SolidJS + Vite SPA** (the user's choice: "sometimes the app will show big tables and performance will be crucial"); (c) vanilla TypeScript with no framework (raised by the user, rejected); (d) Svelte; (e) a server-rendered framework (Next.js, SolidStart).
- **Decision:** (b), a client-only SPA built with Vite and `vite-plugin-solid`, served as static files by Caddy from the same origin as the API (D-29, D-36). Stack (versions pinned in the LLD; the status of each was checked on 2026-10-05 where noted):

  | Concern | Choice | Notes |
  | ------- | ------ | ----- |
  | Framework | SolidJS **1.9.x** (stable; 1.9.15 on npm on 2026-10-05) | Solid 2.0 is at release candidate (`2.0.0-rc.13` on the `next` tag); migrate once 2.0 is stable **and** the libraries below support it (tracked as a risk, §9). |
  | Routing | TanStack Router for Solid (`@tanstack/solid-router` 1.170.x) | Typed routes; search parameters validated with zod schemas, which is where D-24's "URL-safe values only" rule is enforced. Alternative: `@solidjs/router`. |
  | Server state | TanStack Query for Solid (`@tanstack/solid-query` 5.104.x) through oRPC's TanStack Query integration (`@orpc/tanstack-query` 1.15.4, which supports Solid; `@orpc/solid-query` 1.15.4 also exists) | `OpenAPILink` client typed from the contract (D-4). |
  | Tables | TanStack Table **v9** (`@tanstack/solid-table` 9.2.x; its API differs from v8, so examples written for v8 don't apply) + TanStack Virtual (`@tanstack/solid-virtual` 3.13.x) | Headless; row virtualisation. |
  | Accessible primitives | **Kobalte** (`@kobalte/core` 0.13.14, Solid-native, WAI-ARIA patterns; pre-1.0) | React Aria has no Solid port. Alternative: Ark UI (`@ark-ui/solid` 5.39.x, actively released, Zag.js state machines, multi-framework). The LLD picks after a spike on dialog, combobox, date field and menu (§9). |
  | Styling | Tailwind CSS | Unchanged. |
  | Forms | TanStack Form for Solid (`@tanstack/solid-form` 1.33.x, stable v1) | Validates with Standard Schema, so the contract's zod 4 schemas plug in directly. Alternative: Modular Forms. |
  | i18n and formatting | `@formatjs/intl` (the framework-agnostic core of react-intl) behind a small Solid context; numbers and dates through `@budmon/shared` | ICU message syntax (plurals) as in v0.3; no React dependency. |
  | Error reporting | `@sentry/solid` 11.4.x (official), with its TanStack Router integration | Configured per D-24 (no Session Replay, no console breadcrumbs, URLs without query strings). |
  | Tests | Vitest + `@solidjs/testing-library` + MSW; Playwright and axe unchanged | D-26. |

  **Large tables are a requirement.** Every unbounded list (transactions, captures, report drill-downs) is a virtualised table: only visible rows plus an overscan are in the DOM; data arrives through keyset pagination (D-32) as an infinite query that fetches the next page as the user nears the end; at most 5,000 rows (50 pages of 100) are kept in memory; pages outside that window are dropped and replaced by **placeholder rows of the same fixed height**, so the scrollbar, scroll position and `aria-rowindex` values stay stable; a placeholder page is refetched when it scrolls into view, and its real rows take the same indexes; sorting and filtering of unbounded lists happen on the server; client-side sorting is allowed only for lists bounded at 1,000 rows. Targets, verified by a Playwright performance test on a fixture of 100,000 transactions, in Chromium with fixed CPU throttling (4×) to reduce runner noise, run on release candidates rather than every pull request: first rows visible within 300 ms of the first page's response (median of 5 runs); while scrolling through 5,000 loaded rows, p95 frame time under 33 ms and no more than 5 long tasks over 100 ms; DOM row count under 200 throughout; after scrolling past the 5,000-row window and back, the same row is at the same `aria-rowindex`. Virtualised tables keep accessibility: `role="grid"` or `table` semantics with `aria-rowcount` (total if known) and `aria-rowindex` on rendered rows, and keyboard navigation that scrolls the focused row into view.

  Data hooks convert wire values to domain values (money to `Money`, dates to `Temporal`) in one place per procedure (D-14). After a create, hooks invalidate and refetch the affected list queries (D-13 returns only `{ id, createdAt }`). Router search parameters hold only URL-safe values (D-24); sensitive filters live in component state.
- **Rationale:** Solid's fine-grained reactivity updates only the DOM nodes whose data changed, with no virtual-DOM diff, which suits large, frequently updated tables; its JSX and component model keep the ecosystem benefits the stack needs (router, query, table, forms, Sentry). Vanilla TypeScript was rejected because Budmon would have to hand-build a component model, reactive state, routing, form handling and accessible widgets, which is a framework's worth of code to maintain, and it wouldn't make tables faster: table performance comes from virtualisation and server-side paging, which Solid supports directly. React (a) was the safer ecosystem choice but loses on rendering cost for big tables. A server-rendered framework adds a second server runtime for an app that's entirely behind sign-in. Costs: a smaller ecosystem (Kobalte is pre-1.0; fewer accessible-component options) and an upcoming Solid 2.0 migration.

### D-8: Android stack: Kotlin, Jetpack Compose, Room, WorkManager, generated Retrofit client
- **Options considered:** UI: Compose vs XML Views. Storage: Room vs SQLDelight vs DataStore. Networking: generated Retrofit client vs generated Ktor client (Multiplatform-ready) vs hand-written. Architecture: single-activity MVVM vs MVI frameworks.
- **Decision:** Kotlin, **Jetpack Compose** with Material 3, single activity, MVVM (`ViewModel` + `StateFlow`), **Hilt**, **Room** for the offline-entry outbox (TXN-US-10), **WorkManager** for sync, **Paging 3** over the cursor API for long lists (D-32), **OkHttp + Retrofit + kotlinx.serialization** through the generated client (D-6), Sentry Android SDK (D-24), minSdk 26. The Room database is excluded from Auto Backup and device transfer (data extraction rules). OkHttp's logging interceptor exists only in debug builds and never logs bodies. Debug builds point at the local API (`http://10.0.2.2:<port>`); release builds at the deployed API.
- **Rationale:** Compose, Room and WorkManager are the current Android defaults with the best testing support; WorkManager survives process death and reboots, which offline sync needs; Retrofit is OpenAPI Generator's most mature Kotlin target. Kotlin Multiplatform is deferred until iOS is scheduled (XC-21).

### D-9: pg-boss with separate worker processes in two roles (user decision for pg-boss and separate workers; planner decision for roles, database role and queue setup)
- **Options considered:** queue: pg-boss (user), BullMQ on Redis (revisit only if volume outgrows Postgres). Split: (a) one worker process; (b) one process per module; (c) two roles: capture and general. Schema ownership: application role with DDL rights; pg-boss's own role; pg-boss with runtime DDL features disabled.
- **Decision:** (c). One `worker` entry point started with `WORKER_ROLES`. Each job definition names its role; a worker only works its roles' queues. **pg-boss runs under its own database role `budmon_queue`, which owns the `pgboss` schema** (§7.1); its maintenance may create and drop objects inside that schema, an explicit and documented exception to PLT-BR-5 confined to it. Queues are **not partitioned** (avoids per-queue table creation). **Queues are created and updated by the schema step** (D-12: `pnpm db:migrate` when deployed, `pnpm db:reset` in development, test setup in CI), through a queue sync from the job registry as `budmon_queue`; workers never create queues and fail fast at start-up if a queue they need is missing. Scheduling uses pg-boss cron schedules (UTC), registered by the general role. Modules use only the platform's `JobQueue` interface (PD).
- **Rationale:** PLT-BR-2 is enforceable only if the capture worker is a separate container with its own secret file holding the only decrypt credential (D-19, D-20), so (a) doesn't work; (b) multiplies deployments for no benefit. pg-boss performs DDL at runtime (maintenance-created objects, deferred index creation), so a DML-only application role can't run it; a dedicated owner role keeps the application schema DDL-free while letting pg-boss work as designed. Creating queues in the schema step keeps all schema-affecting actions in one deliberate place.

### D-10: Transactional enqueue, payload rules, retention and idempotency
- **Options considered:** enqueue after commit (risk: lost jobs); an outbox table; enqueue in the same transaction.
- **Decision:** enqueue in the same transaction, using pg-boss's support for a caller-provided database executor (bound to the Drizzle transaction). **Payloads** hold only IDs, enums, dates and counts, validated by the job's zod schema on enqueue and on receipt; never amounts, payees, message content, tokens, emails or names (sensitive inputs go into the owning module's table, sealed where D-19 applies). **Job output:** the platform's handler wrapper catches every error and rethrows a sanitised one (D-24) so pg-boss only ever stores a key or class name, stack frames and an allowlisted code; it also discards handlers' return values (pg-boss would store them as the completed job's output), so completed jobs store nothing. Dead-lettered copies keep that sanitised output. **Retries:** exponential backoff, default limit 5, per-job override. **Retention:** finished jobs deleted after 7 days (`deleteAfterSeconds`); exhausted jobs copied to the role's dead-letter queue, which nothing consumes, so their lifetime is that queue's retention (30 days); a CLI lists and re-enqueues them. **Queue policies:** default `standard`; `stately` where "one queued plus one running per key" is wanted (F-4); singleton keys for deduplication. Handlers are idempotent (§7.3).
- **Rationale:** same-transaction enqueue is the simplest correct option and the main reason pg-boss was chosen (PD). The payload and failure-output rules keep pg-boss's tables outside PLT-BR-1's blast radius. pg-boss has one retention setting for finished jobs, so longer inspection lives in dead-letter queues.

### D-11: Gmail push via `watch` + Pub/Sub, received by a pull subscription in worker-capture (user decision for push; planner decision for pull)
- **Options considered:** polling (rejected by the user); Pub/Sub push subscription to an HTTPS endpoint; Pub/Sub pull (streaming pull) from a worker.
- **Decision:** a pull subscription consumed by a listener in worker-capture, which maps each notification's mailbox (by HMAC of the lowercased address) to every matching connection and enqueues one `stately` capture job per connection, acknowledging only after the enqueues commit (F-4). `watch` renewal and the safety-net sync are scheduled jobs designed by `sources`.
- **Rationale:** a push endpoint would have to live on the API (the only public HTTP surface), contradicting PLT-BR-6, and would need token verification. Pull keeps ingestion in the worker, needs no public endpoint, and gets redelivery for free; its backlog signals a dead listener (D-25).

### D-12: Keep Drizzle; schema synced directly in development, one reviewed migration per release for staging and production; snake_case
- **Options considered:**
  - ORM: keep Drizzle; Kysely; Prisma; raw SQL with node-pg-migrate.
  - Migration workflow (PLT-US-7 and PLT-BR-5 in spec v0.10: migrations only where deployed data must be preserved): (a) a migration per schema change, committed with each change (v0.1's design); (b) **development and test databases built directly from the Drizzle schema, with one migration generated per release** capturing the net change since the last deployed migration; (c) no migrations at all, `push` everywhere (rejected: `push` can't express data-preserving changes and would change staging and production ad hoc).
  - Who writes the release migration and when: the person or agent merging each module; a release step when a release is cut; the deploy pipeline (rejected: a migration must be reviewed before it runs).
  - Handling `drizzle-kit`'s interactive prompts (it asks "rename or create?" whenever a column or table disappears and another appears, in `push` and in `generate`, including its programmatic API): answer them by hand (impossible for agents and CI); avoid them by only pushing onto empty databases; answer them mechanically ("create" for every ambiguity) through a pseudo-terminal driver and fix renames by hand; write every release migration by hand (`generate --custom`).
- **Decision:** keep **Drizzle ORM** with `node-postgres`; database identifiers become `snake_case` (Drizzle's `casing: "snake_case"`), TypeScript properties stay camelCase. Workflow **(b)**:
  - **The rule (PLT-BR-5, spec v0.10):** staging and production schemas change only by applying committed, reviewed release migrations through the deploy pipeline, and every release migration preserves existing data; development and test databases are disposable and built directly from the current schema.
  - **Prompts are never answered interactively.** Development and test databases are only ever built by **pushing onto an empty database** (no existing tables, so no ambiguity and no prompt). Migration generation (`db:release-migration` and the pending-changes report) runs `drizzle-kit generate` under a **pseudo-terminal driver** that answers "create" to every ambiguity and lists each ambiguity it answered; renames are then hand-edited into the migration as the Release migration notes require. If the driver stops working with a `drizzle-kit` upgrade, the fallback is a hand-written migration (`generate --custom`), which release check (i) still verifies.
  - **Development (local, feature and module branches, main between releases):** no migration files. `pnpm db:reset` drops the local database and rebuilds it with the development schema step (push onto the empty database), then seeds it. There is no incremental `db:sync` (it would prompt). `db:reset` refuses to run unless the target is a local or test database (`APP_ENV` is `development` or `test` and the host is local or a test container); deploy images contain no push command; deployed environments' DDL-capable credentials never reach developer tools.
  - **Release step** (accepted by the user; the `/release` command that runs it is drafted when there's something to release). A release is cut as branch `release/<version>` from main and opened as a pull request **into main**. In it:
    1. the **software-engineer** runs `pnpm db:release-migration`, which generates **one** migration, `NNNN_<version>.sql`, with the net schema change since the last released snapshot, and hand-edits it for data-preserving changes a schema diff can't express: renames, backfills, `NOT NULL` on existing columns (add nullable → backfill → set `NOT NULL`), type changes with conversion; destructive "contract" steps (dropping what the previous release's code still uses) are deferred to a later release so the migration is compatible with old code during rollout (expand then contract). What each module needs is listed in its LLD's **Release migration notes**, which the **planner** writes and keeps current, including when an implementation-time amendment changes a table;
    2. the **test-architect** writes the **upgrade test** and its fixtures: fixture data in raw SQL written against the **previous release's** schema (factories follow the current schema, so they can't be used), under `apps/server/test/upgrade/<version>/`, with assertions that the data survived as the Release migration notes specify;
    3. the **code-reviewer** reviews the migration; the **user** merges.
    - Branch protection requires the release pull request to be **up to date with main** before merging, so any schema change merged to main meanwhile forces an update and re-runs the release checks (and the migration must be regenerated if check (i) fails). The pipeline creates the release tag on the merge commit only after **re-running check (i) on that exact commit**; the deploy uses that commit.
    - Before the first release there are no migrations; the first release migration is the baseline.
    - Drizzle's migrator runs all pending migrations in one transaction, so `CREATE INDEX CONCURRENTLY` isn't available; plain index builds are acceptable at this scale, and a release needing a concurrent build would do it in a separate, documented step.
  - **Hotfix branches (user decision: built from the last release).** An urgent fix to a deployed release branches as `hotfix/<version>` from the last release (or hotfix) tag, because main may hold unreleased schema changes. It follows the release rules: it may carry its own migration (generated against the last released snapshot), and it gets the same checks, staging deploy and canary gate. After deploy, the hotfix branch is merged back into main by a pull request that is **exempt from the "no migration files" rule** (it brings the migration, its Drizzle snapshot and the schema change together). The migration journal stays linear because a release can't be cut while a hotfix merge-back is pending, and the next release migration is generated against the hotfix's snapshot. If staging holds an unpromoted release candidate when a hotfix is needed, D-29's staging rebuild rule applies.
  - **The schema step**, the same in every environment, run by `pnpm db:migrate` (deploy, a one-off job before rollout, never on start-up) and by `db:reset` and test setup (development and CI): (1) idempotent roles and grants; (2) **deployed and release-path test databases:** Drizzle's migrator applying committed migrations as `budmon_migrator`; **development and feature-branch test databases:** push of the current schema onto the empty database; (3) the queue schema: pg-boss's own install or upgrade SQL for the pinned pg-boss version, applied as `budmon_queue` (pg-boss starts with automatic migration off); (4) idempotent reference data (the `currencies` list from a committed data file); (5) the queue sync (D-9). pg-boss's schema is never part of Drizzle's migrations; it's versioned by the pinned pg-boss version.
  - **pg-boss upgrades** ship in a release that changes nothing else (a "queue upgrade release"). During its deploy, the deploy script turns the maintenance switch on (D-29: Caddy answers `/api/*` with `503 SERVICE_UNAVAILABLE`, J-7; Android keeps recording offline) and stops both worker roles before the schema step, then rolls out the new API and workers and lifts maintenance. This takes minutes and means no process on the old pg-boss version ever touches the upgraded schema, without depending on pg-boss's cross-version compatibility.
  - **CI enforcement** (D-27):
    - *Feature and module pull requests:* any change under `apps/server/drizzle/` fails the build. Test databases are built by pushing the current schema onto an empty database (D-26). A non-blocking "pending schema changes" report (what the generator, through the driver, would produce now, with its list of ambiguities) is attached to the pull request so the coming release's data-preserving work is visible early.
    - *Release and hotfix pull requests:* (i) a database built from **committed migrations only** must match the current schema exactly (generating again produces nothing); (ii) the full test suite runs on a template built from migrations only; (iii) the test-architect's upgrade test: build the previous release's database from its migrations, load its raw-SQL fixtures, apply the new migration, assert; (iv) a **risky-statement check** fails on `DROP TABLE`, `DROP COLUMN`, `RENAME`, `ALTER … TYPE`, `SET NOT NULL`, `ADD COLUMN … NOT NULL` without a default, and constraints added without `NOT VALID`, unless the statement carries a `-- reviewed:` comment explaining why it's safe, which the user sees when merging.
    - *Hotfix merge-back pull requests:* exempt from the "no migration files" rule. Main may already hold further unreleased schema changes, so equality with the schema isn't expected; the check is that the committed migrations (now including the hotfix's) apply cleanly to an empty database and that the hotfix's changes no longer appear in the pending-schema-changes diff.
    - *Deploy:* the pipeline re-runs check (i) in CI on the tagged commit; the deploy script (D-29) runs only `pnpm db:migrate`, which verifies the recorded journal and hashes against the image and fails if the database records a migration the image doesn't have.
- **Rationale:** Drizzle is in use, SQL-shaped, type-safe, and its snapshots make "net change since the last generated migration" what `generate` produces, so one migration per release falls out naturally. Syncing development databases from the schema removes migration churn while modules are built, as the user asked, while staging and production change only through reviewed, committed, tested migrations. Pushing only onto empty databases and driving `generate` mechanically removes every interactive prompt from agent and CI paths. Requiring up-to-date release branches and re-checking the tagged commit closes the gap where a schema change merged during an open release would be deployed without its migration. Isolating pg-boss upgrades trades a few minutes of maintenance for not having to trust cross-version compatibility. Cost: data-preserving work is deferred to release time; the Release migration notes, the pending-changes report, the upgrade test, the risky-statement check and staging are the mitigations (§9).

### D-13: Server-generated UUIDv7 IDs; per-user idempotency keys for creates, storing only a minimal result
- **Options considered:** IDs: integer identity (current); UUIDv4; UUIDv7; ULID. Safe retries of creates: (a) clients supply the new entity's ID and the server compares a replay with the current entity; (b) per-user idempotency keys with a stored record. What the record stores: the full response; only a minimal fixed result.
- **Decision:** UUIDv7 primary keys generated by the server's injectable ID generator; reference tables use natural keys. Creates are made retry-safe with **(b)**:
  - Every create-type procedure requires an `Idempotency-Key` header (a UUID the client generates per user action) and **returns a fixed minimal shape: `{ id, createdAt }`**. Clients read the created entity through the normal, authorised read procedures when they need it.
  - In the create's transaction, the service calls the platform's idempotency helper, which inserts `(user_id, key, procedure, request_hash)` into `idempotency_records` before the work (concurrent duplicates wait on the primary key) and stores `{ id, createdAt }` and the status after it. `request_hash` is SHA-256 of the canonical, validated input (keys sorted, defaults applied).
  - A replay is answered **from the record**: same procedure and hash → the stored `{ id, createdAt }` with the original status and `Idempotent-Replayed: true` (the replayed body goes through the router's normal output validation); different procedure or hash → `409 IDEMPOTENCY_KEY_REUSED`. The current entity is never consulted: a later edit doesn't cause a false conflict, a later deletion isn't undone, and losing access to a shared account means the follow-up read returns `NOT_FOUND`.
  - Keys are scoped per user, so another user's key reveals nothing. Records expire after 90 days. Requests that fail don't leave a record (the transaction rolls back).
  - **Android** stores each offline entry's request body **as first serialised** in the Room outbox, with its key, and resends those exact bytes, so an app update that serialises differently can't cause a false `IDEMPOTENCY_KEY_REUSED`. Entries older than 60 days aren't auto-sent (J-4).
- **Rationale:** offline sync and web retries need creates that are safe to repeat. Option (a) leaked existence across users, gave false conflicts after edits and resurrected deleted entries. Storing only `{ id, createdAt }` keeps the record free of financial data (so it can't outlive an entry's deletion or a user's loss of access, D-17), keeps it independent of the wire format (the service has the ID and timestamp; the router still owns domain→wire conversion, D-14), and makes replays trivially valid. Cost: one extra insert per create, and clients make a follow-up read when they need the full entity.

### D-14: Money as 64-bit integer minor units; bigint in code; bounded JSON integers on the wire via one shared codec (user decision for the representation; planner decision for the mechanism)
- **Options considered:** code: `number` restricted to safe integers; `bigint`; a decimal library. Wire: (i) JSON integers; (ii) decimal strings. Mechanism for (i) with oRPC: a zod `bigint` schema (oRPC's JSON-schema converter emits `type: string` with a pattern, and the OpenAPI client serialiser sends bigints as strings, so Kotlin would get `String` and the web would see strings); a `.transform()` (becomes an untyped `{}` schema); a `number` wire schema with an explicit JSON-schema override and explicit conversion.
- **Decision:**
  - **Database:** `bigint` (Drizzle `bigint({ mode: "bigint" })`). **Server and `@budmon/shared`:** `bigint` in `Money`.
  - **Wire:** JSON integers, through **one shared money codec** in `packages/contract/src/common/money.ts`: the wire schema is `z.number().int()` bounded to ±(2^53 − 1); it's registered with the zod 4 JSON-schema registry (or the oRPC converter's override hook) so both input and output schemas are emitted as `{ type: "integer", format: "int64", minimum: −9007199254740991, maximum: 9007199254740991 }`. The contract therefore types amounts as `number`.
  - **Conversion is explicit, in exactly two places,** with `toMoney(minor: number, currency)` and `toWire(money)` from `@budmon/shared`: in each server module's router (wire → domain before calling the service, domain → wire on the way out), and in each web data hook (§D-7). No `.transform()` in contract schemas. Kotlin gets `Long`.
  - Out-of-range input returns `VALIDATION_FAILED`; out-of-range output fails loudly (§7.2).
  - The first contract slice includes this shape in its spike (§9): emitted `openapi.json`, generated Kotlin type, and the web's inferred type.
- **Rationale:** `bigint` makes exact FX conversion possible (a large amount times a scaled rate overflows `number`'s exact range). JSON integers keep both clients simple. The codec makes the wire format a single, tested piece of code rather than a convention, and keeping conversion out of the contract keeps the emitted JSON schema exact. The bound (about 90 trillion units of a 2-decimal currency per value) is the one place the API is narrower than 64 bits, and only on the wire (A-8).

### D-15: Currency reference data and market rates are owned by the platform, with defined date semantics
- **Options considered:** ownership: `accounts`, `transactions`, `reports`, or the platform. Rate date for a daily fetch: store "latest" under the fetch day; store the provider's historical rate for the UTC day that just closed. Late-arriving rates: overwrite and let modules drift; treat stored days as final and notify modules of new days; have modules snapshot the rate they used.
- **Decision:**
  - The platform owns `currencies`, `exchange_rates`, the fetch jobs, and `FxService.convert(money, toCurrency, onDate)` (PLT-US-8). The provider sits behind an interface with a fake for tests.
  - **The rate of date D** is the provider's end-of-day (historical) rate for the **UTC day D**, stored under `rate_date = D`. The daily job runs at 00:30 UTC on D+1 and fetches D. A transaction's calendar date is matched to the rate of that same date without time-zone conversion (§7.4).
  - **Stored days are final:** insert-only; the application never overwrites a stored day.
  - **Conversion for date D:** if D's rate is stored, it's used (`provisional: false`). Otherwise the latest stored date before D is used and the result is marked `provisional: true` with its `rateDate`. (Today's conversions are always provisional until tomorrow's fetch.) If no earlier rate exists either (a back-dated entry before the first stored date), the result is "no rate" and a historical backfill job for D is enqueued.
  - **When new days are inserted** (the daily fetch or a backfill), the platform enqueues an `fx.rates-added` job for each module that registered a handler, with the date range whose conversions just changed (`affectedFrom` = the new date, `affectedTo` = the day before the next stored date, or open-ended). Modules that store converted values (`budgets`' incremental progress) recompute exactly that range; modules that convert on read (`reports`) need no handler. Because conversion is deterministic given stored rates, incremental values and reconciliation converge.
  - **Lossless parsing:** provider responses are parsed so rates stay decimal strings (no float step), stored as `numeric(24,12)`; only active ISO codes in `currencies` are stored (no metals, SDR or crypto); zero, negative or unparseable rates are rejected.
  - **Rounding:** per converted item, then summed (§7.2).
  - **Provider** (researched 2026-10-05; terms to be confirmed when signing up, Q-18):

    | Provider | Coverage (EGP?) | Historical daily rates | Price | Notes |
    | -------- | --------------- | ---------------------- | ----- | ----- |
    | **Open Exchange Rates** (primary) | About 170 currencies, EGP included | Free plan: daily historical; Developer: back to 1999 | Free: 1,000 requests/month, USD base; Developer $12/month, 10,000 requests | Mature, USD base fits the pivot design (D-15); free-plan licence for this use to confirm. |
    | **`fawazahmed0/exchange-api`** (fallback) | 200+ codes, EGP included | Any date, served as static files by date | Free, CC0, no key, no rate limit | Community-run, no SLA, aggregated sources; used only when the primary fails. |
    | ExchangeRate-API | About 160, EGP included | Historical data on paid plans (as remembered; unverified) | Free 1,500 requests/month; paid from about $10/month | Free tier reported as non-commercial. |
    | Frankfurter / ECB-based | About 30, **no EGP** | Yes | Free | Rejected: coverage. |
    | currencyapi.com and similar | EGP included | Paid plans | Free tier non-commercial | No advantage over the primary. |

    Daily usage is 1 request per environment, plus backfills: well inside every free quota. The adapter for each provider sits behind the same interface; the fallback is tried only after the primary has failed for 6 hours, and every stored day records its `provider`.
- **Rationale:** at least four modules need conversion; none should own the others' dependency. Fixing the date semantics and finality makes conversions reproducible, and the explicit "rates added" signal is what keeps incrementally maintained budget progress consistent with reconciliation. Using UTC days for rates is an accepted approximation (a rate is a market's daily figure, not a user's local day).

### D-16: Time representation and the Temporal API
- **Options considered:** `Date` plus date-fns and `@date-fns/tz`; Luxon; Temporal (native or polyfill).
- **Decision:** storage and wire as in §7.4; in TypeScript, **Temporal** (`PlainDate` for calendar dates, `Instant` for instants, `ZonedDateTime` for period boundaries) behind `@budmon/shared`, with an injectable `Clock`. Use the runtime's native Temporal where present (checked for the pinned Node version and supported browsers when the LLD is written), and `@js-temporal/polyfill` otherwise (expected at least for some browsers). Android uses `java.time`.
- **Rationale:** Temporal's types match the domain's distinction between a calendar date and an instant, and mirror `java.time`. `Date` conflates the two, the classic source of off-by-one-day bugs. Cost: polyfill bundle size where native support is missing.

### D-17: Deletion conventions: hard delete by default, explicit lifecycle states, explicit `onDelete`
- **Options considered:** a global soft-delete column; hard delete everywhere; hard delete by default with status columns and targeted soft delete.
- **Decision:** the third option (§3.3). Every foreign key's `onDelete` is chosen and justified in the LLD that creates it.
- **Rationale:** XC-16 promises erasure; a global soft delete would keep data forever and leak into every query. Status columns express real states that stories need anyway.

### D-18: No connection pooler at launch; pooler-safe code and sized pools (user decision: "none at launch")
- **Options considered:** PgBouncer on its own VM; PgBouncer co-located with a worker; no pooler at launch with pools sized against `max_connections` (the user's choice).
- **Decision:** no pooler in staging or production at the invite-only stage. Pools are sized so the total stays well under Postgres's `max_connections` (100): API 10, worker-general 5 plus pg-boss 3, worker-capture 5 plus pg-boss 3, migrate step 2, Alloy's Postgres exporter 1, `budmon_admin` sessions 3: 32 in total, leaving room for a second API container and a restore drill. Code stays **pooler-safe** (transaction-mode discipline: no session-level `SET`, advisory locks only transaction-scoped, no `LISTEN`, no named prepared statements across transactions), checked by the CI pooler compatibility suite (D-26), so a transaction-mode PgBouncer can be added when scaling without code changes. Local development connects directly (no PgBouncer in compose).
- **Rationale:** with one VM and a handful of processes, a pooler adds a component without reducing anything; keeping the discipline and the CI suite costs little and preserves the scaling path (§7.6).

### D-19: Envelope encryption; the API seals with a public key; only worker-capture can unwrap, through Google Cloud KMS (user decisions: managed key, capture-only decryption, Q-2 scope accepted; planner decision for the mechanism on Hetzner)
- **Context:** on Google Cloud, per-service workload identities enforced the split (v0.3). On a Hetzner VM there are no per-process cloud identities, so the split has to come from what each container can read and from what its key material can do.
- **Options considered:**
  - (A) **Remote Google Cloud KMS with an asymmetric key** (RSA-OAEP 3072, SHA-256): any process seals locally with the public key (no credentials, no network call); only worker-capture holds a service-account key file with `cloudkms.cryptoKeyVersions.useToDecrypt` on that key, mounted only into its container.
  - (B) **Local asymmetric envelope** (X25519 sealed boxes / HPKE): the API has the public key; the private key is a file mounted only into worker-capture. No external dependency.
  - (C) Remote symmetric KMS with separate encrypt-only and decrypt credentials (v0.3's IAM split, with key files): the API would hold a credential, which (A) avoids.
  - (D) A local symmetric key-encryption key only in worker-capture, with the API sending plaintext to worker-capture to seal (rejected: plaintext crosses into a job or a call).
- **Comparison of (A) and (B):**

  | Threat | (A) remote KMS, asymmetric | (B) local asymmetric |
  | ------ | -------------------------- | -------------------- |
  | Database or backup leak | Safe: no key material in the database or backups. | Safe, as long as the private key never enters backups (it doesn't: it's in SOPS and on the VM only). |
  | Copy of the VM disk or a snapshot | With the age key on disk: the SOPS files decrypt, exposing the service-account key; the holder can call KMS decrypt until it's revoked (audited, rate-alerted). With the age key in tmpfs only (recommended, D-20): nothing usable. | With the age key on disk: the private key decrypts every sealed secret offline, with no record. With tmpfs only: nothing usable. |
  | API container compromise | Safe: the API has only the public key. | Safe: same. |
  | worker-capture container compromise | Attacker can decrypt while present and with the stolen key file until it's revoked; every decrypt is audit-logged and rate-alerted; revoking the key file or disabling the key version stops it at once. | Attacker can decrypt every sealed secret offline, including copies in old backups, until all secrets are re-sealed under a new key and tokens are revoked; no record of use. |
  | Root on the VM | Same as above (root can read any container's files and memory). | Same as above. |
  | Operational dependency | KMS reachable for every unseal (Google's availability); about €1 to €3 a month (estimate). | None. |
- **Decision:** **(A)** for `capture-credentials` (Gmail refresh tokens, sealed PKCE verifiers and authorization codes, SMS content awaiting processing, and user-provided AI keys later; scope accepted by the user, Q-2). The service-account key file lives in worker-capture's SOPS file only (D-20) and is mounted as a Compose secret into worker-capture alone; the API and worker-general have only the public key (in plain configuration). The Google Cloud project that Gmail and Pub/Sub need anyway (D-11) hosts the key, one key ring per environment. `api-secrets` (two-step verification secrets, which the API must verify at sign-in): a **local symmetric key** (AES-256-GCM key-encryption key) in the API's secret file only, because a KMS round-trip on every sign-in buys nothing when the API itself must decrypt; it protects against a database or backup leak, not against a compromised API.
  - **Envelope format** (both keys): per-secret random 256-bit data key, AES-256-GCM, associated data binding table, row and purpose; the wrapped data key, nonce, ciphertext and key version stored as one versioned `bytea` envelope.
  - **OAuth exchange** in worker-capture (F-3); the Google OAuth client secret is in worker-capture's secret file only.
  - **Plaintext handling:** plaintext exists only in local variables for the duration of an operation; never logged, persisted unsealed, or put in job payloads. Data keys are `Buffer`s zero-filled after use; JavaScript strings can't be wiped (accepted). worker-capture may cache a decrypted refresh token in memory for up to 1 hour per connection to limit KMS calls; access tokens are memory-only until expiry.
  - **Rotation:** a new KMS key version; a worker-capture job re-wraps envelopes (decrypt with the old version, wrap with the new public key), then the old version is disabled. `api-secrets` re-wrap is a one-off command run with the API's secret file.
  - **Egress (confused deputy):** worker-capture sends tokens and message content only to destinations fixed in configuration (Google's OAuth and Gmail hosts), never to a destination taken from database data. User-hosted AI endpoints (XC-12) need their own design (flagged for `capture`).
  - **Detection and response:** Cloud Audit Logs data-access logging is enabled for the key; a Cloud Monitoring alert emails the owner when decrypt requests exceed a threshold (set in the LLD from observed volume). The incident runbook: disable the key version and the service-account key, rotate the OAuth client secret, re-seal under a new version, and ask users to reconnect.
  - **Who can decrypt (residual trust boundary):** anything that can read worker-capture's secret file or memory: root on the production VM (the owner, or an attacker who gets root), and the deploy path, which can change what worker-capture runs. Restrictions: SSH key-only access for the owner; CI deploys through a forced-command key that can only run the deploy script with a released tag (D-29) and never receives decryption keys; production deploys need the user's approval in a protected GitHub environment; no other humans have access.
  - **Stated plainly: a root-level compromise of the running production VM defeats the process separation.** A copy of its disk does too, unless the age key is kept off disk (D-20); this design keeps it off disk and takes no snapshots of the production VM (§7.5). The split protects against the likelier failures (a database or backup leak, a compromised API process, a leaked API secret file); (A) adds detection and instant revocation for the worst case. Separating worker-capture onto its own VM would raise the bar (root on the API host would no longer suffice) for about €6 a month; it's listed as a cost lever (Q-15).
  - **Service-account key availability:** Google Cloud organisations created since 2024 enforce `iam.disableServiceAccountKeyCreation` by default. If Budmon's project sits under an organisation, the key file can't be created without overriding that policy. The crypto slice's spike checks this first; fallbacks are workload identity federation with an X.509 client certificate held by worker-capture, or option (B). The same applies to FCM's service-account credential (D-20).
  - **Pub/Sub** uses the same capture service account, with `roles/pubsub.subscriber` granted on that environment's Gmail subscription only.
  - **Local development and tests** use a local key provider behind the same interface; configuration refuses it when `APP_ENV` is `staging` or `production`.
- **Rationale:** (A) keeps the property the user cares about: the API can't decrypt capture secrets even if fully compromised, with no credential in the API at all. Over (B), it adds an audit trail, rate alerting and instant revocation, and keeps the long-term key off the VM, for a few euros a month and a dependency on a Google project that exists anyway.

### D-20: Configuration and secrets: validated at start-up; SOPS-encrypted secret files per service
- **Options considered (secret storage on Hetzner):** (a) GitHub environment secrets written to the VM by CI at deploy; (b) **SOPS with age**: encrypted files in the repository, decrypted on the VM with a host-held key; (c) files maintained by hand on the VM; (d) a secrets service (Vault, Infisical, a cloud secret manager).
- **Decision:**
  - **Validation:** one zod schema per process kind (API, worker-capture, worker-general, migrate) built from shared parts, parsed once at start-up; on failure the process prints the **names** of missing or invalid variables and the rule each broke (never values) and exits non-zero before opening any port or connection. Secret-typed values print as `[redacted]`. Secrets are read from files (`*_FILE` variables pointing at Compose secret mounts); non-secret settings from environment variables. `.env.example` lists every variable that's read, with safe development values; a test checks schema and example list the same variables.
  - **Storage: (b).** `infra/secrets/<environment>/<service>.sops.yaml`, one file per service, encrypted to two age recipients: that environment's VM key and the owner's personal key (kept with an offline copy). **Where the VM key lives:** on **production**, only in tmpfs: after each boot the owner runs `budmonctl unlock` over SSH and pastes the key from their password manager; until then the stack doesn't start, and an alert fires ("production locked after reboot"). Unattended upgrades therefore install security updates but never reboot on their own; the owner reboots when convenient and unlocks. This keeps every secret unreadable from a copy of the disk (§7.5) at the cost of a manual step after reboots (Q-15). On **staging** (synthetic data, test accounts only) the key is stored on disk, readable only by root. The deploy script decrypts each file on the VM into a tmpfs directory readable only by that service's container user, and Compose mounts it into that container only. CI, agents and developers never hold the staging or production age keys. Development uses `.env` files (`node --env-file`) with throwaway values.
  - **Process-specific secrets** exist only in that process's file: the capture service-account key and the Google OAuth client secret in worker-capture's; the `api-secrets` key, cursor key and presigning credentials in the API's; the erasure-log and export write keys and FCM's service-account credential in worker-general's; the backup repository key and passphrase only in the Postgres container's.
- **Leak checks:** CI runs a secret scanner over the repository and over every built image's layers (for example gitleaks and trivy's secret scanner); a finding fails the build.
- **Rationale:** PLT-US-5 and CR X-5. SOPS gives versioned, reviewable secret changes without a secrets service, keeps decryption on the VM, and maps one file to one container, which is what D-19's split needs. Option (a) would put every production secret in CI; (c) isn't reproducible; (d) is more infrastructure than an invite-only deployment needs.

### D-21: Error model: `BudmonError` keys become oRPC error codes; nothing internal leaks; the outcome is reported
- **Options considered:** keep `BudmonError` with a custom body; adopt oRPC's error envelope; RFC 9457 problem details.
- **Decision:** keep `BudmonError(key, status, message, details)` and map it onto **oRPC's error envelope** (`code` = key, `status`, `message`, `data` = details), so both clients decode errors without custom code. Keys are `UPPER_SNAKE_CASE` and globally unique; each procedure declares its errors in the contract. Platform keys: `VALIDATION_FAILED` 400 (`data.issues: [{ path, code, message }]`, never input values), `CLIENT_UPDATE_REQUIRED` 400 (D-33), `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `IDEMPOTENCY_KEY_REUSED` 409, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429 (with `Retry-After`), `INTERNAL` 500, `SERVICE_UNAVAILABLE` 503.
  - **Any non-`BudmonError`** becomes `INTERNAL` with a fixed generic message and `data.outcome`: `not_applied` if no transaction committed during the request, otherwise `unknown` (for example output validation failing after commit). Clients word the message from `outcome` (§4.9).
  - **oRPC's validation errors** carry the input or output in their `cause`; the interceptor builds `issues` (path, code, message) and **discards the cause** before anything is logged or reported. Output validation failures are reported with issue paths and codes only.
  - **Malformed request bodies** (JSON parse errors) return `VALIDATION_FAILED` with a fixed message, never the parser's message (it quotes the body).
  - Every response carries `X-Request-Id` (the trace ID). `message` is developer-facing English; clients map keys to wording.
- **Rationale:** keeps the pattern the review said to keep, fixes X-3 and X-4 structurally (one interceptor), and the `outcome` field stops clients from claiming "nothing was changed" when they can't know.

### D-22: Security baseline: rate limits shared through Postgres, same-origin API, headers, limits, hashing utilities
- **Options considered (rate-limit storage):** per-instance memory only; Redis; Postgres; the cloud's edge rate limiting (paid).
- **Decision:**
  - **Rate limits:** a coarse per-instance in-memory limit per IP on all routes, plus **shared limits in Postgres** (`rate_limit_counters`, fixed windows) for sensitive operations, per IP and per target account (email HMAC). Modules declare limits per procedure in their LLDs. Exceeding a limit returns `RATE_LIMITED` with `Retry-After`. The client IP comes from Caddy's `X-Forwarded-For`, trusting exactly one hop (the `caddy` container's network address).
  - **CORS:** none; the web app and API share one origin, and the API answers no preflights (D-36).
  - **Headers:** helmet on the API (`Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, HSTS); Caddy serves the SPA with a strict CSP (no inline script; `connect-src 'self'` plus the Sentry endpoint), HSTS and `Referrer-Policy: no-referrer`.
  - **Limits:** JSON body 100 kB by default (per-route override in the LLD), request timeout 30 s, Fastify's default header and URL limits.
  - **Hashing utilities:** Argon2id (`@node-rs/argon2`, OWASP parameters) for passwords and recovery codes; HMAC-SHA-256 for high-entropy tokens; constant-time compare; 256-bit random token generator. `identity` decides where each is used.
- **Rationale:** stateless instances need shared counters for limits to mean anything (US-13); a Postgres upsert per sensitive request is cheap at this scale, with no new infrastructure. Argon2id is the OWASP recommendation and avoids bcrypt's 72-byte truncation.

### D-23: Authorization plumbing in the application; no row-level security in the MVP
- **Options considered:** application-level checks only; Postgres row-level security as defence in depth.
- **Decision:** application-level checks with default-deny procedure bases and the "every procedure rejects anonymous callers" test (§7.1), plus cross-user authorization test cases in every LLD. RLS revisited before any public launch.
- **Rationale:** RLS with transaction pooling needs per-transaction `SET LOCAL`, policies joining account memberships and shared vocabularies, and a worker bypass: significant complexity for an invite-only MVP whose rules are still being designed module by module. The default-deny test addresses the failure that actually happened (CR X-1).

### D-24: Observability: OpenTelemetry, pino, Sentry and Grafana Cloud, with PLT-BR-1 enforced in layers (user decision for the tools and the rule; planner decision for the enforcement)
- **Options considered (enforcement):** guidelines and review only; deny-list redaction; allowlists plus automated canary tests; an OpenTelemetry Collector with a redaction processor as an extra layer.
- **Decision:**
  - **Backend tooling:** OpenTelemetry Node SDK (HTTP server and client, Fastify, `pg`, pg-boss instrumentation) exporting traces and metrics by OTLP to Grafana Cloud; pino logs to stdout and Grafana Cloud with `trace_id`; Sentry Node SDK for errors, linked by trace ID.
  - **Layer 1: allowlist logger.** Modules get a typed logger whose fields come from a closed set of safe keys (IDs, enums, counts, durations, error keys, booleans). Importing `pino` directly or using `console` is an ESLint error outside the observability folder. Fastify's own request logging is disabled; the platform's request log records method, route template, status, duration, client kind, request ID and internal user ID only.
  - **Layer 2: values that can't leak by accident.** `Money` and the secret wrapper print `[redacted]` from `toString`, `toJSON` and Node's inspect hook.
  - **Layer 3: sensitive-data boundaries**, each a rule with a test:
    1. *Unexpected errors carry no message.* On the server and in both apps, errors that aren't `BudmonError` (or a client's own typed errors) are reported and logged as type, stack frames and an allowlisted code only (for example Postgres SQLSTATE, Node `errno` code, HTTP status); their `message` is dropped, because messages of runtime errors can contain values (a `RangeError` with an amount, a `SyntaxError` quoting a body, Android's `NumberFormatException` with the input). Database driver errors lose `detail`, `where`, `parameters` and query text. Third-party SDK errors (Google's Gaxios errors carry request config and the bearer token) are serialised through an allowlist: HTTP status, provider reason code, retryable flag.
    2. *Job failures are sanitised* by the handler wrapper before pg-boss stores them (D-10); pg-boss's `error` event is logged through the same serialiser.
    3. *Validation errors* lose their `cause` (which holds the input or output) before logging or reporting (D-21).
    4. *No sensitive values in URLs:* paths and query strings carry only IDs, enums, dates, limits and encrypted cursors (§5.2, D-32), because URLs end up in Caddy's access logs, browser history and breadcrumbs. Web router search parameters follow the same rule.
    5. *Outbound calls:* HTTP client spans and breadcrumbs record scheme, host and path only, never query strings (provider API keys and Gmail search strings live there).
    6. *Telemetry configuration:* span names and `http.route` use templates; no headers or bodies recorded; database spans keep parameterised SQL text, never parameter values; custom span attributes go through the allowlist.
    7. *Sentry in all apps:* `sendDefaultPii: false`, no request bodies, no local variables, no attachments; **no Session Replay on web**; **no screenshots or view hierarchy on Android**; web console breadcrumbs off; navigation breadcrumbs and transaction names stripped of query strings; a `beforeSend`/`beforeBreadcrumb` that keeps only allowlisted fields.
    8. *Postgres server logs:* `log_error_verbosity = terse` (no DETAIL lines such as "Failing row contains…"), `log_min_error_statement = panic` (failing statements aren't logged), `log_statement = none`, `log_parameter_max_length = 0` and `log_parameter_max_length_on_error = 0`.
    9. *Infrastructure logs*, configured by a checklist kept with the deploy files: Caddy access logs record method, path without query string, status, duration and upstream timing, with all request and response headers removed; Caddy's error (default) logger gets the same filters, since reverse-proxy errors can include request details; `Authorization` and `Cookie` stay redacted (Caddy's default; credential logging is never enabled); Postgres settings per rule 8 in the committed `postgresql.conf`; pgBackRest at `info` level (no data); Docker `json-file` rotation (3 × 10 MB per container) as the only local copy; Pub/Sub without message logging; the host's SSH and system logs stay on the host (journald, 14 days).
    10. *Alloy allowlist:* Grafana Alloy relays all OTLP data and collects container logs, and drops any span or log attribute and any metric label outside the platform's allowlist before export, a second, independent copy of rules 1, 5 and 6.
  - **Layer 4: canaries.** The **privacy canary suite** (CI) drives real flows (API requests, worker jobs, failures and unexpected errors, including a failing job) with canary values in every sensitive field, captures all logs, an in-memory span and metric exporter, Sentry's test transport, **and `pgboss.job` output**, and fails if any canary appears. Each module's LLD adds its flows. Web and Android have unit tests on their Sentry scrubbers. A **staging canary gate** runs the same canary flows against staging before each production promotion and searches Grafana Cloud (Loki logs, which include Caddy, Postgres and container logs, Tempo traces, Prometheus labels) and Sentry for the canaries, which covers infrastructure logs CI can't see. Because Alloy's allowlist (rule 10) filters what reaches Grafana, the gate **also scans the staging VM's unfiltered logs** (Docker `json-file` logs and journald) through a forced-command SSH key that runs only `budmon-canary-scan <run-id>` and returns match counts, never log lines. A hit anywhere blocks promotion. In both environments, Alloy's dropped-attribute and dropped-label counters are exported, and **any drop alerts** (D-25): a drop means a layer 1 to 3 rule was broken upstream.
  - **Clients:** web and Android report errors to Sentry (one organisation, one project per app) with the internal user ID only (A42), and send a W3C `traceparent` header so client errors line up with server traces. They don't export spans in the MVP.
  - **Retention:** Sentry and Grafana Cloud at their free-plan retention (30 days or less, confirmed when the accounts are set up); local container logs a few days at most (rotation by size); host journald 14 days; Pub/Sub messages 7 days. The privacy policy says operational logs keep internal IDs, never names or financial data, for up to 30 days.
  - **Grafana Alloy on each VM** is the collector: apps export OTLP to it, it adds the allowlist layer (rule 10), ships container logs, and collects host metrics (node exporter subset) and Postgres metrics (postgres exporter, via a read-only monitoring role).
- **Rationale:** guidelines fail silently; deny-lists miss new field names (and message scrubbing by pattern is a deny-list); allowlists fail closed. The canaries are what make the rule hard to break: a new log line, span attribute, job failure or infrastructure setting that carries a payee fails CI or blocks the release.

### D-25: Metrics cardinality, latency targets and alerting
- **Options considered (alerting):** none; Sentry alerts only; Grafana Cloud alerting to email; push to the owner's phone. Capture health: job failures; notification silence; connection state gauges.
- **Decision:**
  - **Metric labels (PLT-BR-7):** only bounded values: `service`, `environment`, `http_route` (template), `method`, `status_class`, `client_kind`, `queue`, `job_state`, `module`, `error_key` (bounded by the error catalog), `source_kind` (gmail/sms), `connection_status` (an enum owned by `sources`), `age_bucket` (24h/72h). Never user IDs, emails, amounts, account or connection IDs, raw paths or instance IDs. Histograms use 6 fixed buckets. Each LLD lists its metrics and labels; the platform keeps a series budget under 5,000 of the free tier's 10,000.
  - **Core metrics:** HTTP count and duration; queue depth, job duration and outcomes, `jobs_dead_lettered_total`; `gmail_push_received_total{matched}`; `fx_rates_fetched_total`; worker heartbeat; `reconcile_corrections_total`; **`capture_connections{source_kind, connection_status}`** and **`capture_connections_stale{source_kind, age_bucket}`** (active connections with no successful sync in 24 or 72 hours), computed every 5 minutes. **A successful sync** is defined per source kind: for **Gmail**, any completed sync run for the connection, including the safety-net sync when there's no new mail, with a requirement on `sources` that the safety-net sync runs at least every 6 hours per active connection; for **SMS**, a sync only happens when a bank SMS arrives, so SMS staleness is shown on the dashboard but **excluded from alerting** in the MVP (an app heartbeat is `sources`' option later). The gauges are computed by a worker-general job from counts only. Node runtime metrics. **Host and database metrics** (via Alloy): disk usage, memory, CPU steal, Postgres connections, replication-free WAL size, last successful backup and WAL archive time.
  - **Token expiry is connection state, not job failure:** when a sync finds a refresh token expired or revoked, the job completes and the connection moves to a "needs reconnect" status that the user sees (`sources` designs the state and prompt). So expected expiries (§9, Gmail publishing status) never dead-letter or alert; they show on the dashboard as counts.
  - **Alerting (accepted by the user):** Grafana Cloud alerting, email to the product owner, on: API health check failing for 5 minutes (Grafana synthetic check); a worker heartbeat missing for 5 minutes; Gmail notifications backing up (oldest unacknowledged older than 15 minutes); **any active Gmail connection stale for 24 hours**; any job dead-lettered in a capture queue, or more than 5 dead-lettered in any queue in an hour; API 5xx above 5% for 10 minutes; no new FX day for 36 hours; KMS errors in the last 15 minutes. **Added for self-hosting:** disk usage above 80%; memory above 90% for 10 minutes; Postgres connections above 80% of `max_connections`; no successful backup for 26 hours; WAL archiving failing for 15 minutes; TLS certificate expiring within 14 days (Caddy renews automatically; this catches failures); any attribute or label dropped by Alloy's allowlist (D-24); production locked after a reboot (D-20). **KMS decrypt-rate anomaly** is a Google Cloud Monitoring alert by email (D-19). The deploy script silences the health alert during deploys (D-29).
  - A second, independent uptime check is deferred.
- **Rationale:** the backlog alert catches a dead listener; the stale-connection alert catches what a backlog can't (an expired watch, a broken sync, a token problem the code didn't classify) because it measures the outcome, successful syncs; treating expiry as state avoids weekly false alarms. All within free tiers.

### D-26: Test tooling (foundation for the test-architect)
- **Options considered:** Vitest vs Jest vs `node:test`; database isolation by rollback, truncation, or a database per test file from a template; Testcontainers vs an always-running database.
- **Decision:**
  - **TypeScript (server, packages, web unit and component):** **Vitest**; web component tests with Testing Library and MSW (handlers typed from the contract).
  - **Server integration tests** against **real Postgres** (same major as production), started by **Testcontainers** from Vitest's global setup, both locally and in CI (GitHub's runners have Docker); `TEST_DATABASE_URL` can point at an existing server instead. Global setup builds a template database with the schema step (D-12): on feature and module branches, a **push of the current schema onto an empty database** (no prompts are possible); on `release/*` and `hotfix/*` branches, **committed migrations only**; in both cases with roles, the `pgboss` schema, reference data and queues; each test file gets its own database created from the template, connecting **directly** (not through PgBouncer); tables are truncated between tests within a file. API tests run in-process through Fastify's `inject()`. pg-boss runs for real in queue tests; job handlers are also unit-tested as plain functions.
  - **Pooler compatibility suite:** a small integration suite runs through a PgBouncer container in transaction mode (with a wildcard database entry, so per-file databases resolve) covering transactions, transactional enqueue, pg-boss fetch and maintenance.
  - **Determinism:** injectable `Clock` and ID generator; every external integration (KMS, Pub/Sub, Gmail, OAuth, FX provider, object storage, FCM, email, Sentry transport) behind an interface with an in-memory fake. Factories per table in `apps/server/test/factories/`.
  - **Dependency injection:** D-31.
  - **Web end-to-end:** **Playwright** against the real API, workers and a database built by the schema step (D-12), started by Playwright's `webServer`, with `@axe-core/playwright` checks on each screen.
  - **Web table performance test:** a Playwright test on a 100,000-row fixture checks D-7's statistical targets under fixed CPU throttling, on release candidates (time to first rows, p95 frame time and long tasks while scrolling, DOM row count, stable `aria-rowindex` across dropped pages).
  - **Android:** JUnit, MockK and Turbine for ViewModels; Room and Compose UI tests on the JVM with Robolectric; OkHttp MockWebServer for the generated client; a small instrumented smoke suite on an emulator, run on release candidates.
  - **Shared test vectors** (`packages/shared/test-vectors/*.json`) for money formatting, rounding, conversion and the wire codec, run by both TypeScript and Kotlin suites.
  - **Platform-owned suites every module extends:** privacy canary (D-24), default-deny (§7.1), contract rules (D-6).
- **Rationale:** Vitest handles ESM and TypeScript natively; a database per file gives real-Postgres fidelity without rollback isolation's pitfalls (pg-boss and services open their own transactions); one mechanism (Testcontainers) in both places avoids local/CI divergence; the pooler suite proves D-18 without slowing every test.

### D-27: CI on GitHub Actions
- **Options considered:** GitHub Actions; GitLab CI; Google Cloud Build.
- **Decision:** GitHub Actions (A-3), on every pull request and on main. Stages, failing fast:
  1. install (pnpm, cached); format check (Prettier), lint (ESLint, including layering and logging rules), type-check (`tsc -b`);
  2. contract checks (D-6), env-example check (D-20), and the migration checks for the branch type (D-12): on feature and module pull requests, "no migration files changed" plus the pending-schema-changes report; on `release/*` pull requests, migrations reproduce the schema, the destructive-statement check, and (in stage 4) the upgrade test;
  3. unit tests (all TypeScript workspaces);
  4. server integration tests (Testcontainers), including the privacy canary, default-deny and pooler compatibility suites;
  5. web end-to-end (Playwright, Chromium; all three browsers on release candidates);
  6. Android (when `apps/android/`, `packages/contract/` or `packages/shared/test-vectors/` changed, and on release candidates): ktlint and Android lint, Kotlin client generation, unit and Robolectric tests, `assembleDebug`;
  7. on main: build container images and the web bundle (no deploy). On a release or hotfix tag (created by the pipeline on the merge commit after re-running D-12's check (i) on it): build and push images to GitHub Container Registry, deploy to staging through the forced-command SSH deploy (D-29), run the staging canary gate, upload the Android build to distribution; production is a manual, user-approved promotion of the same images.
  `pnpm check` runs stages 1 to 4 locally; `pnpm check:all` adds end-to-end and Android (`./gradlew check`). Main is protected: required checks green before merge (the user merges).
- **Rationale:** PLT-US-12; path filters keep the slow Android job off unrelated changes while catching contract and test-vector changes; slower suites run on release candidates rather than nightly.

### D-28: Local development: compose for infrastructure, one command for the stack
- **Options considered:** everything in containers; infrastructure in containers and apps on the host; dev containers.
- **Decision:** `infra/compose.yaml` (replacing the root `compose.yaml`) runs Postgres (the same pinned image as production, D-29) and **Mailpit** (local SMTP with a web inbox, so developers and QA can follow invitation and reset links). Apps run on the host with hot reload; Vite's dev server proxies `/api` to the local API, so the web app is same-origin locally as in production (D-36). `pnpm dev` starts compose, waits for the database, builds the schema with the development schema step (D-12: push onto an empty database, no migrations) if it doesn't exist, seeds development data (idempotent), then runs the API, one worker with both roles, and the web dev server. Integrations default to local stand-ins: KMS → local key provider; FX → fixed sample rates; email → Mailpit; FCM → logged no-op; object storage → a local filesystem store under `.data/` served by a development-only route; Gmail → disabled unless real development credentials are configured. Android builds against the local API from the emulator. The README documents prerequisites (Node, pnpm via Corepack, Docker, JDK and Android Studio) and commands. Seed data is a platform framework; modules add their rows in their own slices.
- **Rationale:** PLT-US-2; host-run apps keep hot reload and debugging simple; the pinned image keeps the database identical to CI and production; stand-ins let anyone run Budmon with no cloud accounts.

### D-29: Hosting, environments and deployment for the invite-only stage: Hetzner VMs with Docker Compose (user decision for Hetzner; planner decision for the design)
- **Options considered:**
  - Host: (a) **Hetzner Cloud VMs** (the user's direction); (b) a self-run machine at home (no off-site redundancy, residential IP and uplink, physical risk; rejected while a VM costs a few euros); (c) Google Cloud (v0.3; rejected by the user on cost).
  - Process management: **Docker Compose** with images from CI; systemd units running Node directly; a lightweight orchestrator (k3s, Nomad, Coolify/Dokku-style PaaS layers).
  - Staging: (i) **a second small VM**; (ii) a second Compose project on the production VM with its own database and secrets; (iii) a VM created on demand per release and deleted after.
  - Infrastructure as code: OpenTofu; click-ops plus a written runbook.
- **Decision:**
  - **Location:** Hetzner Germany (Nuremberg or Falkenstein, `eu-central`) for both VMs (A-11); backups and buckets at Backblaze B2's EU region (D-30, D-35), so backups are off-provider.
  - **Production VM:** CX33 (4 shared vCPU, 8 GB RAM, 80 GB local disk). **Staging VM:** CX23 (2 shared vCPU, 4 GB, 40 GB), always on, option (i): it keeps staging failures (a runaway migration, a full disk) from touching production and exercises the same deploy path, for about €6 a month. Option (ii) was rejected because staging runs release candidates before they're trusted and shares the kernel, disk and memory with production; (iii) is a cost lever (Q-19).
  - **Containers per VM** (one Compose project, images pinned by digest): `caddy` (TLS via Let's Encrypt, serves the SPA, reverse-proxies `/api/*` and `/health/ready` to `api`, security headers, maintenance switch), `api`, `worker-general`, `worker-capture`, `postgres` (official Postgres image plus pgBackRest), `alloy` (Grafana Alloy), and a one-off `migrate` container. Docker networks: `edge` (caddy, api); `data`, **internal** (no outbound route: api, workers, migrate, postgres, alloy); `egress` (outbound internet: caddy for ACME, api for Sentry, worker-general, postgres for pgBackRest, alloy for Grafana Cloud); worker-capture is **not** on `egress`: its only way out is an `egress-proxy` container (an HTTP CONNECT proxy with a hostname allowlist: Google OAuth, Gmail, Cloud KMS, Pub/Sub, Sentry), a host-level backstop to D-19's egress rule. Postgres publishes no port. Containers run as distinct non-root UIDs with read-only root filesystems, `no-new-privileges`, all capabilities dropped and memory limits; no container mounts the Docker socket. **Exception:** Alloy runs as root inside its container, because the container log files under `/var/lib/docker/containers` and the host's `/proc` and `/sys` it reads are root-owned; its mounts are read-only, it has no added capabilities and no Docker socket.
  - **Images:** built in CI and pushed to GitHub Container Registry (private), tagged with the release version; the VM pulls with a read-only token. Old images are pruned to the last 5 releases.
  - **Deploy mechanism:** a GitHub Actions job in a protected environment (`staging`: automatic on release and hotfix tags; `production`: manual promotion, requires the user's approval) connects over SSH as user `deploy`, whose key is restricted with a forced command (`command="/usr/local/bin/budmon-deploy"`, no PTY, no forwarding) that accepts only `<environment> <tag>` matching `^(staging|production) v[0-9]+\.[0-9]+\.[0-9]+(-hotfix\.[0-9]+)?$`. The script, on the VM:
    1. pulls the release's images; if pulling fails, it stops with the old release untouched;
    2. decrypts that environment's SOPS files into tmpfs (D-20);
    3. if the release is a queue upgrade (D-12), turns the maintenance switch on and stops both workers;
    4. runs the `migrate` container (`pnpm db:migrate`), which verifies that every migration recorded in the database exists in the image with the same hash, then applies pending ones (D-12's check (i) ran in CI on the tagged commit; deploy images contain no `drizzle-kit`);
    5. runs `docker compose up -d` with the new images; Caddy holds and retries requests for up to 10 s while `api` restarts, so a normal deploy is seen as a short delay;
    6. waits up to 60 s for `/health/ready`; on failure, restarts the previous release's application images (migrations are forward-only and expand-then-contract, so the previous code runs on the new schema) and fails the job;
    7. turns maintenance off if it turned it on, and creates a 15-minute Grafana alert silence for that environment's health check around steps 3 to 6.
  - **Maintenance switch** (no code deploy needed): Caddy checks for a flag file (`/srv/budmon/<environment>/maintenance/on`, mounted read-only). When present it answers `/api/*` with `503` and the standard error envelope (`SERVICE_UNAVAILABLE`, J-7) and `/health/ready` with `503 {"status":"maintenance"}`. The owner toggles it with `budmonctl maintenance on|off` over SSH; the deploy script uses the same command. Outside maintenance, `/health/ready` is answered by the API: `200` when the database is reachable and its schema is in the code's **compatible window**: the newest migration the code knows is applied, and any migrations applied after it belong to at most one later release (migration names carry their release version). Because releases are expand-then-contract (D-12), the previous release's code is ready on the new schema, so a rollback (step 6) reports ready; new code on an old schema reports `503`.
  - **Hotfix while staging is ahead of production** (a release candidate on staging not yet promoted): the hotfix branches from the production tag (D-12). The staging database holds only synthetic data, so the deploy script, given a hotfix tag lower than staging's current release, rebuilds staging's database from scratch (drop, migrate to the hotfix's level, seed), deploys the hotfix, and runs the canary gate; the open release is re-cut on top of the merged-back hotfix afterwards.
  - **Host configuration:** cloud-init (committed) installs Docker, creates users, sets SSH key-only access, unattended security upgrades (without automatic reboots on production, D-20) and the Docker log rotation; Hetzner snapshots and backups stay disabled for production; Hetzner Cloud Firewall allows only 22, 80 and 443.
  - **Infrastructure as code:** **OpenTofu**, kept small: Hetzner servers, firewalls and SSH keys (`hcloud` provider); the Google Cloud pieces (project services, KMS key rings and keys, the capture service account and its IAM binding, Pub/Sub topics and subscriptions); B2 buckets and scoped application keys. State is encrypted with OpenTofu's client-side state encryption and stored in a B2 bucket. Service-account and B2 key secrets are created outside OpenTofu and stored in SOPS, so the state never contains them. Rationale: the IAM binding that enforces D-19 and the two environments should be reviewable and recreatable; the footprint is small enough that this is a few files, not a platform.
  - **Environments:** `development` (local), `test` (CI), `staging`, `production`. One Google Cloud project with per-environment key rings, service accounts, Pub/Sub topics and OAuth clients.
- **Cost estimate (invite-only stage),** monthly, excluding VAT. Hetzner server prices are the post-June-2026 list prices as reported by secondary sources (Hetzner's own price page was blocked by this environment's network); everything marked "est." is an estimate I couldn't check:

  | Item | Monthly |
  | ---- | ------- |
  | Production VM, CX33 | €8.49 |
  | Staging VM, CX23 | €5.49 |
  | Two primary IPv4 addresses | about €1.20 (est.) |
  | Backblaze B2: backups, exports, erasure log (a few GB) | under €1 (est.) |
  | Google Cloud: KMS asymmetric key versions and decrypt operations; Pub/Sub within free tier | about €1 to €3 (est.) |
  | Grafana Cloud, Sentry (free tiers), GitHub Container Registry | €0 to €1 (est.) |
  | FX provider (D-15): Open Exchange Rates free plan, or Developer plan if its terms require | €0, or about €11 ($12) |
  | Domain, amortised (D-36): `.com` about €1; `.ai` about €6 to €8 (est.; `.ai` registrations are multi-year) | €1 to €8 |
  | **Total** | **about €18 to €40** |

  Cost levers: drop always-on staging for an on-demand staging VM (saves about €6); keep staging always on but downsize nothing further (CX23 is the smallest x86 size listed).
- **Rationale:** a single VM per environment with Compose is the cheapest setup that keeps containers, Postgres and OTLP portable, and it's operable by one person with a deploy script, cloud-init and a small OpenTofu module. The design stays honest about what a single host can't do (D-19's residual risk, no high availability under P9) and keeps the path to public scale a deployment change (§7.6).

### D-30: Backups and restore: pgBackRest to off-provider object storage (user decision for the policy: daily, 14 days, 7-day PITR; planner decision for the mechanism)
- **Options considered:** pgBackRest; WAL-G; nightly `pg_dump` only (no PITR, rejected); Hetzner's server backups (whole-disk images, not consistent for a running database, kept on the same provider; rejected as the database backup). Repository: Hetzner Object Storage (€6.49/month base, same provider) vs Backblaze B2 (pay per use, a different provider).
- **Decision:**
  - **pgBackRest** inside the `postgres` container, repository on **Backblaze B2 (EU region)** through its S3-compatible API, in a dedicated bucket with a key scoped to that bucket and held only by the Postgres container.
  - **Client-side encryption** (`repo1-cipher-type=aes-256-cbc`); the passphrase is in SOPS and in the owner's password manager (losing it means losing the backups).
  - **Schedule:** full backup weekly, differential daily, continuous WAL archiving (asynchronous, compressed) with `archive_timeout = 300` (at most about 5 minutes of data loss).
  - **Retention:** time-based with weekly fulls (`repo1-retention-full-type=time`, `repo1-retention-full=7`). pgBackRest keeps the newest full backup that is at least 7 days old plus everything after it, so the oldest backup kept is between 7 and 14 days old: point-in-time recovery always covers at least the last 7 days (as accepted), daily backups are available for at least 7 and at most 14 days, and nothing older than 14 days is kept. Deleted users' data therefore leaves backups within 14 days of erasure, which is the privacy-policy wording.
  - **Monitoring:** a systemd timer runs `pgbackrest check` and `info` and writes the last-success timestamps for Alloy to export; alerts on no successful backup for 26 hours and on WAL archiving failing for 15 minutes (D-25).
  - **Restore drill** every 3 months, following a runbook: create a temporary Hetzner VM, restore the latest backup and a point in time, run integrity checks and the erasure replay command, record the time taken, delete the VM (a few cents). A restored production database contains queued jobs, cron schedules and sealed tokens, so on the drill VM: only Postgres and the erasure command run; no workers, API, Alloy or Sentry DSNs; no capture service-account key, FCM or email credentials are copied there; outbound traffic is blocked except to the backup repository. Staging never receives production data. A real restore follows the same order: restore, replay erasures, then start the stack.
  - **Erasure after restore:** `identity`'s erasure first writes an erasure record (internal user ID and time) to the `erasure-log` bucket (D-35) and then deletes data; the restore runbook replays every record newer than the restore point; replay is idempotent.
  - Staging's database isn't backed up (synthetic data, rebuilt by its deploys when needed).
- **Rationale:** pgBackRest is mature, supports time-based retention, encryption, parallel restore and `verify`. An off-provider repository means an account problem or a Hetzner location failure doesn't take the backups with it, and B2 costs cents at this size (estimate) against Hetzner Object Storage's €6.49 base. Its S3 compatibility with pgBackRest is expected but I couldn't verify it here; the fallback is Hetzner Object Storage in a different Hetzner location.

### D-31: Composition root and injectable dependencies instead of singletons
- **Options considered:** keep `getInstance()` singletons; a DI container library; a hand-written composition root with constructor injection.
- **Decision:** a composition root per process (`createApiContainer`, `createWorkerContainer`) building config, database, clock, ID generator, queue, KMS client, object store, integrations, then repos and services. Services receive repos and integrations through constructors; repos receive the database executor per call. Tests build the container with overrides.
- **Rationale:** fixes the review's singleton problems (CR §4.1) and makes injectable dependencies explicit for the test-architect, without a framework.

### D-32: Keyset pagination with encrypted cursors
- **Options considered:** fix the current offset helper (CR X-8); keyset pagination with plain base64 cursors; keyset with ID-only cursors; keyset with encrypted cursors.
- **Decision:** lists use keyset pagination: request `{ cursor?, limit }` with `limit` 1 to 100 (default 50); response `{ items, nextCursor | null }`. The cursor holds the sort key, the last ID, a hash of the list's filters and an expiry (24 hours), **encrypted and authenticated** (AES-256-GCM with a server-side cursor key from configuration), so it can travel in a query string without exposing amounts, payee names or dates (D-24). A tampered, expired or mismatched cursor returns `VALIDATION_FAILED`. The broken offset helper is removed.
- **Rationale:** ledger lists grow without bound and change while being read; keyset pages are stable and use the sort's index. Plain base64 cursors would expose the sort key (an amount or payee) in URLs; ID-only cursors would need an extra lookup and break when that row is deleted. Encryption is cheap and keeps cursors opaque in fact, not only in name.

### D-33: Client version policy and update prompts
- **Options considered:** no version handling; store-only updates; a server-driven minimum version. Status code: 426 (requires an `Upgrade` header naming a protocol, which doesn't fit an app update), 400 with a dedicated key.
- **Decision:** clients send `X-Budmon-Client`. Configuration holds, per client kind, the minimum supported and latest versions, exposed by `meta/client-config`. Below the minimum, every procedure except `meta/client-config` returns **`400 CLIENT_UPDATE_REQUIRED`** (clients act on the key, as for every error); Android pauses offline sync and shows S-1 (J-5), the web shows J-6's banner. Between minimum and latest, apps show the soft prompt. The minimum is raised only together with a deliberate breaking contract change (D-6).
- **Rationale:** Android builds outside a store can't be force-updated; a server-driven floor lets the API evolve safely, and the offline queue survives updates. A 400 with a specific key is HTTP-compliant and needs nothing special from proxies or clients.

### D-34: The clean-up happens in the first slice, by verdict
- **Options considered:** a separate clean-up pull request; inside the first slice (decided by the user, spec §7 item 4).
- **Decision:** the first slice restructures the repo into D-5's layout and handles every item:

  | Item (CR §5 unless noted) | Verdict | Handling in the first slice |
  | ------------------------- | ------- | --------------------------- |
  | `src/index.ts` bootstrap | Keep (rework) | Replaced by `apps/server/src/main/api.ts` on Fastify (D-3) with the security baseline (D-22). |
  | `src/router/index.ts` | Rework | Replaced by the oRPC contract router (D-4); the broken `../trpc.js` import and the tRPC stub are removed. |
  | `src/env.ts` | Keep (rework) | Becomes the fail-fast config module (D-20). |
  | `src/errors/index.ts` | Keep class, rework handler | `BudmonError` kept; the Express handler replaced by the oRPC error interceptor (D-21); unused `ValidationError` removed. |
  | `src/auth/*` | Replace flows, keep patterns | Deleted; `identity` designs sign-in fresh; patterns carried into conventions; bcrypt replaced by the Argon2id utility (D-22). |
  | `src/users/usersRouter.ts` | Replace | Deleted (removes X-1 and the hanging `POST /users`, X-11). |
  | `src/users/userRepo.ts` | Rework | Deleted; `identity` designs its repo. |
  | `src/accounts/accountsRepo.ts` | Replace | Deleted. |
  | `src/db/schemas/users.ts`, `account.ts`, `refreshTokens.ts` | Rework / replace | Deleted (database disposable); `dob` is gone with them (spec §7 item 3). |
  | `src/db/schemas/currencies.ts` | Rework | Replaced by the new `currencies` table (§3). |
  | `src/db/index.ts` (CR X-10: `refresTokens` typo, missing tables and relations) | Rework | Replaced by `src/db/schema/index.ts` registering every table and relation, and the platform's database module (D-18, D-31). |
  | `src/enums/currency.ts` | Replace | Deleted; `currencies` is the single source. |
  | `src/utils/pagination.ts` | Rework | Replaced by keyset pagination (D-32). |
  | `src/types/TableRecord.ts` | Replace | Deleted. |
  | `server/dist/` | Remove from git | Removed; `dist/` stays ignored. |
  | `server/.env.example` | Replace | Replaced by a correct one checked by the env test (D-20). |
  | `server/drizzle.config.ts` | (CR §1.3) | Moved to `apps/server/`, pointing at `src/db/schema/`, `casing: "snake_case"`, no non-null assertion (reads validated config). |
  | `server/tsconfig.json` | (CR §1.3) | Replaced by per-package configs extending `packages/config` bases (no `rootDir: "."`, no `jsx` on the server). |
  | `package.json` scripts and dependencies | Rework | Workspace scripts (D-5) with real `build`, `test`, `db:reset`, `db:release-migration`, `db:migrate`; the old `db:push` script is replaced by the guarded `db:reset` (D-12). Removed: `@rollup/plugin-typescript`, `rollup`, `tslib`, `@types/mssql`, Express and `@types/express`, morgan and `@types/morgan`, `@trpc/server`, `jsonwebtoken` and `@types/jsonwebtoken`, `drizzle-zod`, `dotenv`, bcrypt and `@types/bcrypt`. |
  | `server/.gitignore` | (CR §3.4) | Prisma line removed; ignores consolidated in the root `.gitignore` (including `.data/` and `.env*` except `.env.example`). |
  | `compose.yaml` | Keep (rework) | Moved to `infra/compose.yaml`, image pinned, Mailpit added (D-28). |
  | Root `.prettierrc` | (CR §4.1: rework) | Replaced by the full Prettier config in `packages/config`, referenced from the root. |
  | `.zed/settings.json` | (CR §1.1) | Kept (personal editor setting, harmless). |
  | `code-bites.md`, empty root `README.md` | (CR §1.1) | A real README (layout, prerequisites, commands, environments) replaces both; `code-bites.md` deleted. |
  | Debug endpoints `GET /`, `GET /auth/test-auth` | (CR §3.4) | Gone with the files above. |

  The first slice also proposes CLAUDE.md's "Project conventions" text (based on CR §4.2, updated for this HLD); only the user approves CLAUDE.md, so the text goes into the pull request for the user to accept (Q-10). It includes the database rules agents follow (and states that the web app is SolidJS): rebuild the development database only with `pnpm db:reset`; never write migration files outside `release/*` and `hotfix/*` branches.
- **Rationale:** decided by the user; doing it inside the slice means the skeleton and the removals are reviewed together.

### D-35: Private S3-compatible object storage for exports and the erasure log
- **Options considered:** storing exports in Postgres (`bytea`); streaming exports from the API; object storage with presigned URLs. Provider: Hetzner Object Storage; Backblaze B2; Cloudflare R2.
- **Decision:** a platform `ObjectStore` interface over the S3 API (filesystem store locally, in-memory fake in tests), on **Backblaze B2 (EU region)**, the same provider as backups (D-30) but separate buckets and keys. Per environment:
  - **`exports`:** private bucket. worker-general writes under `users/<userId>/exports/<exportId>` with a key scoped to this bucket (read, write, delete); downloads only through **S3 presigned URLs valid 15 minutes**, issued by the API after an authorization check, signed with a separate read-only key held by the API. Deletion after 7 days by a platform purge job (deterministic and tested), with a bucket lifecycle rule as a backstop; `identity`'s erasure deletes the user's prefix. Object names contain IDs only.
  - **`erasure-log`:** append-only erasure records (D-30), written by worker-general with a key that can write but not delete (B2 application keys carry per-bucket capabilities), with Object Lock retention of 30 days where available, then lifecycle deletion.
- **Rationale:** exports are a full copy of a user's financial data, so they need private storage, short-lived access and guaranteed deletion (XC-16, XC-17); generating them in the API would break PLT-BR-6 for large exports. The erasure log must live outside the database to survive a restore. Scoped keys give least privilege per process. B2's capability-scoped keys and Object Lock are as I remember them; I couldn't verify current details here, and the fallback is Hetzner Object Storage with per-project credentials.

### D-36: Domain, same-origin API under a path, and the API version in the path
- **Context:** the user will try to acquire `budmon.ai` or `budmon.com`, and suggested the API as a subdomain or as a subpath like `/api/v<x>_<y>/`.
- **Options considered:**
  - Placement: (a) **subpath on the web app's origin** (`https://<domain>/api/...`); (b) subdomain (`https://api.<domain>/...`).
  - Version in the path: (1) **major only, `/api/v1`**, with additive changes (D-6); (2) major and minor, `/api/v<x>_<y>/`.
- **Decision:** **(a) and (1).** The web app is served at `https://<domain>/`, the API at `https://<domain>/api/v1/...`, the health endpoint at `https://<domain>/health/ready`, all through the same Caddy site.
  - **Same origin** means no CORS at all (the API sends no `Access-Control-*` headers and rejects preflights), cookies can be `Secure; HttpOnly; SameSite=Strict` scoped to `Path=/api` if `identity` chooses cookies, the CSP is `connect-src 'self'` plus the telemetry endpoints, and one certificate covers everything. Android uses the same base URL. The later Electron app (spec §5 Later) will need either CORS for its origin or a custom protocol; that's designed when it's scheduled.
  - **Version:** the path carries the **major version only**. Because the contract evolves additively (D-6), a minor version in the path would either force every client to change URLs for non-breaking changes or require the server to serve every `v1_y` alias as the same routes, which adds nothing. The contract's version (`1.<minor>`) is published in `openapi.json` (`info.version`) and in an `X-Budmon-API-Version` response header, which clients can log and Sentry can tag. `/api/v2` exists only if the whole API is ever redesigned; individual breaking changes are new procedures (D-6). This differs from the user's suggestion and is flagged as Q-16.
  - **Domain choice** doesn't change the design; until a domain is acquired, staging and production use a placeholder in configuration.
- **Rationale:** a single origin is the simplest and safest setup for one host (no CORS surface, strictest cookie policy) and doesn't block scaling: CDNs and load balancers route by path. A subdomain would only pay off when the API and web are hosted separately, which the scaling path can still do later behind the same paths.

## 9. Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| oRPC is young and evolving (a v2 is in development). | API churn could force rework of contract or handler code. | Pin an exact version; keep oRPC behind the platform's procedure bases, codec and error interceptor; the OpenAPI document is the stable external contract. |
| OpenAPI Generator's Kotlin output may handle oRPC's OpenAPI 3.1 output poorly (unions, `oneOf`, nullable), and the money codec's override may not apply to both input and output schemas. | Android compile errors, `String` instead of `Long`, or web amounts typed as strings. | **First contract slice spike:** emit `openapi.json` for representative shapes (money in inputs and outputs, nested objects, discriminated unions, nullable fields, enums, the error envelope), generate and compile the Kotlin client, check the web's inferred types; the contract-rules test (D-6) then guards the result. |
| pg-boss's transactional `send` through a Drizzle transaction under a different database role. | Privilege errors on maintenance-created objects, or a weaker enqueue guarantee. | Verified in the first queue slice with integration tests (default privileges from `budmon_queue`); fallback: grant explicit privileges in the queue schema step. |
| Single VM per environment: a host failure, a full disk, or a bad kernel update takes production down; Postgres is self-managed. | Downtime (best effort accepted, P9); data loss bounded by WAL archiving (about 5 minutes). | Health, disk, memory, backup-age and WAL-archive alerts (D-25); tested restores every 3 months (D-30); cloud-init and OpenTofu rebuild a host in under an hour; no snapshots of production (§7.5): a broken host is rebuilt, not restored from a snapshot. |
| Root compromise of the production VM. | Defeats the API/worker-capture separation; exposes the database. | Hardening (§7.5), forced-command deploy key, user-approved production deploys, KMS audit and rate alerts with instant revocation (D-19); separate VM for worker-capture as an option (Q-15). |
| Data on the VM's disk isn't encrypted at the block level. | A copy of the disk exposes the database files; with the age key on disk it would also expose every secret, including worker-capture's KMS credential. | Production age key only in tmpfs with a manual unlock after reboots, and no production snapshots (§7.5, D-20, Q-15); backups encrypted client-side; full-disk encryption revisited before public launch. |
| Hetzner raised prices in 2026 (two or three rounds, as reported by secondary sources). | Costs rise again. | Absolute amounts are small; containers, Postgres and OTLP are portable to another provider. |
| Solid 2.0 is at release candidate; Kobalte is pre-1.0. | A framework migration soon after launch; component library gaps or breaking changes. | Start on Solid 1.9; migrate when 2.0 and the libraries are stable; spike the accessible components first (D-7); keep UI primitives behind Budmon's own component layer. |
| FX: free-plan terms may not allow Budmon's use; the fallback (`fawazahmed0/exchange-api`) has no SLA and aggregated sources. | Paid plan needed; fallback rates may differ slightly from the primary. | Q-18; `provider` recorded per stored day; fallback used only after the primary fails for 6 hours. |
| Backblaze B2's compatibility with pgBackRest and its key capabilities weren't verified here. | Backup or least-privilege design needs adjusting. | Verified in the backup slice; fallback Hetzner Object Storage in another location (D-30, D-35). |
| Free-tier limits (Sentry about 5k errors a month; Grafana 10k series and log volume). | Missing data in an incident storm. | SDK sampling and rate limits; series budget (D-25); Alloy drops verbose host metrics; monthly usage check. |
| A privacy leak through an SDK default, an infrastructure log, or a runtime error message. | Breaks PLT-BR-1. | D-24's boundaries, Alloy's attribute allowlist, CI canary suite (including job output), staging canary gate (including Caddy, Postgres and container logs in Loki), scrubber tests in each app. |
| Gmail OAuth "In production" without verification (Q-11 (b), accepted): token lifetime unconfirmed. | Weekly reconnection if tokens still expire. | The spike before `sources` is designed; fallback (a) weekly reconnection with a one-tap prompt; token expiry is a connection state, not an alert (D-25). |
| Release-time migrations (D-12): data-preserving changes are deferred until a release is cut. | A missed rename or backfill could lose data in staging or production; a `drizzle-kit` upgrade could break the prompt driver. | Release migration notes in each LLD; the pending-changes report on every pull request; the pseudo-terminal driver lists every ambiguity; upgrade test and risky-statement check; staging before production; PITR (D-30). |
| Exact-money discipline erodes (someone uses `number` arithmetic). | Rounding drift, violating XC-1. | Branded `Money` type, codec, lint rules, shared test vectors, review checklist. |

## 10. Assumptions

| ID | Assumption |
| -- | ---------- |
| A-1 | PLT-BR-6 ("ingestion runs in workers, never in the API") allows the API to **receive** inbound data that can only arrive over HTTP (SMS uploaded by the Android app, OAuth callbacks), as long as it only validates, seals, stores and enqueues it. |
| A-2 | The platform owns currency reference data, market rates and conversion (D-15). |
| A-3 | The repository is (or will be) hosted on GitHub, so CI is GitHub Actions and images go to GitHub Container Registry. |
| A-4 | Invite-only load: up to about 100 users, 100 to 300 transactions per user per month, a few requests per second at peak. |
| A-5 | API messages are English-only and for developers; clients localise by error key. |
| A-6 | Android minimum version is 8.0 (API 26). |
| A-7 | One product owner (A28) receives all alerts by email; their address lives in deployment configuration. |
| A-8 | No single amount exceeds ±(2^53 − 1) minor units (D-14). |
| A-9 | Two-step verification secrets (IDN-US-8) are verified inside the API, so they use the `api-secrets` key, not the capture key (D-19). |
| A-10 | Matching a transaction's local calendar date to the rate of the same UTC day is acceptable precision (D-15). |
| A-11 | Hetzner's German locations suit the invited group (EU data location, reasonable latency to Europe and the Middle East). |
| A-12 | Android builds reach the invited group through Firebase App Distribution (v0.3 Q-8, unanswered; recommendation stands). |
| A-13 | The first slice's pull request proposes CLAUDE.md's "Project conventions" text for the user to approve (v0.3 Q-10, unanswered; recommendation stands). |

## 11. Open questions

**Resolved by the user** (2026-10-05, [platform decisions](../../product/notes/2026-10-05-platform-decisions.md)):

| v0.3 question | Answer | Recorded in |
| ------------- | ------ | ----------- |
| Q-1 Backups | Accepted: daily, 14 days, 7-day PITR. | D-30 |
| Q-2 Capture-only key scope | Accepted as proposed. | D-19 |
| Q-3 Alerts | Accepted. | D-25 |
| Q-4 Hosting | Hetzner (or an inexpensive self-managed server); design for the invite-only stage. | D-29 |
| Q-5 FX provider | Find something that works for little money. | D-15 (recommendation; Q-18) |
| Q-6 Domain | `budmon.ai` or `budmon.com`; API as subdomain or subpath such as `/api/v<x>_<y>/`. | D-36 (Q-16) |
| Q-7 Language | A documentation-style rule (recorded in the planner's instructions); the app's own UI tone remains open. | Q-17 |
| Q-9 Staging | Keep, but cheaper. | D-29 |
| Q-11 Gmail publishing status | (b) "In production" without verification, confirmed by a spike before `sources`; (a) as fallback. | §9, D-25 |
| Q-12 Production pooler | None at launch. | D-18 |
| Q-13 Release step | Accepted; the `/release` command is drafted when there's something to release. | D-12 |
| Q-14 Hotfixes | (a) from the last release. | D-12, D-29 |
| Q-8, Q-10 | Not answered; recommendations stand. | A-12, A-13 |

**Open:**

| # | Question | Proposal | Blocks |
| - | -------- | -------- | ------ |
| Q-15 | Capture-only decryption on a single Hetzner VM (D-19). Accept option (A): Google Cloud KMS with an asymmetric key, the API holding only the public key and worker-capture alone holding the decrypt credential, with audit logging, a decrypt-rate alert and instant revocation? Accept the residual risks? (1) **Root on the running production VM can decrypt capture secrets.** (2) **A copy of the VM's disk** (a snapshot, a provider-side leak) exposes the database files, and, if the SOPS age key is stored on disk, every secret including worker-capture's KMS credential, which lets the holder call KMS decrypt until revoked (audited and rate-alerted, not prevented). To close (2), keep the production age key only in memory: you run `budmonctl unlock` over SSH after every reboot (the stack stays down until you do; security updates install automatically but reboots are yours to schedule), and production gets no Hetzner snapshots. Optionally run worker-capture on its own small VM (about €6 a month more) so that root on the main VM isn't enough. | (A); accept (1) for the invite-only stage; close (2) with the in-memory age key and manual unlock; worker-capture on the main VM, separate VM revisited before public launch. | The crypto slice. |
| Q-16 | API path: you suggested `/api/v<x>_<y>/`. Proposed instead: `/api/v1` with additive changes, the minor version in `openapi.json` and an `X-Budmon-API-Version` header (D-36), because a minor version in the path forces URL changes for non-breaking changes. Same origin as the web app (subpath, not subdomain). | `/api/v1`, same origin. | The first contract slice. |
| Q-17 | The app's own UI conventions (P8 for end users): English first with layouts ready for other languages and right-to-left; WCAG 2.2 AA on web and Android accessibility guidelines; a calm, non-judgemental tone toward spending. | Accept; `identity` proposes `ux-guidelines.md` from it. | Any module's screens. |
| Q-18 | FX provider budget: Open Exchange Rates' free plan (1,000 requests a month, daily historical rates, USD base) if its terms allow Budmon's use, otherwise its Developer plan at $12 a month; `fawazahmed0/exchange-api` (free, CC0, includes EGP, historical by date) as fallback. Up to $12 a month OK? | Yes. | The FX slice. |
| Q-19 | Cost levers (D-29): keep staging always on (CX23, about €6 a month), or create it on demand per release (cents, slower releases)? | Always on. | Deployment slices. |
| Q-20 | Domain: which one you acquire (`.ai` is several times the price of `.com` and is registered for multiple years). Configuration uses a placeholder until then. | Your choice. | The Gmail "In production" spike (Q-11's follow-up) and the `sources` design, because Google's consent screen needs an authorised domain with homepage and privacy-policy URLs and real OAuth redirect URIs; and the production deploy. |

## 12. Out of scope / future work

- Public-scale deployment (§7.6): dedicated or managed Postgres with a replica, a transaction-mode pooler, several API hosts behind a load balancer, separate worker hosts, a CDN for the SPA.
- Full-disk encryption on the VMs; high availability; cross-provider failover (before any public launch).
- An OpenTelemetry Collector beyond Alloy's allowlist; client-side trace export (D-24).
- Postgres row-level security (before any public launch, D-23).
- Real-time updates (SSE or WebSockets) if a later story needs them (§5.2).
- A persisted offline read cache and full offline use on Android (XC-22, later).
- A separate egress design for user-hosted AI endpoints (XC-12, flagged for `capture`, D-19).
- Kotlin Multiplatform data layer when iOS is scheduled (D-8); CORS or a custom protocol for the Electron app (D-36).
- The `/release` command (D-12, drafted when there's something to release).
- Turborepo or Nx if builds get slow (D-5); BullMQ on Redis if job volume outgrows Postgres (PD); table partitioning only if ever needed (PD).
- A status page; a second independent uptime check; an in-app error and health view for the owner (spec P22).
- Public-launch requirements: Google verification and security assessment, Play Store SMS compliance (spec §5 Later).
