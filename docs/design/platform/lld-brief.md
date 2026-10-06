---
module: platform
doc: lld-brief
summarises: lld.md v0.5
---

# Platform: LLD brief

A human-readable summary of [the LLD](./lld.md) for review and approval. The LLD is the contract the agents build from; this brief is what the owner reads. If the two ever disagree, the LLD wins and the brief is out of date.

## 1. What this builds

The platform is the foundation every other Budmon module stands on. Nothing a user would call a "feature" lives here. What it provides:

- **A clean repository.** The old `server/` code is deleted. In its place is one repository (a "monorepo") holding the server, the web app, the Android app and a shared **contract**: the single definition of every API call, from which the API documentation (OpenAPI) and the Android client code are generated.
- **Shared building blocks for the server:**
  - exact money arithmetic (integers in the smallest unit, such as piastres, never floating point);
  - currency exchange rates and conversion;
  - one consistent error format;
  - safe retries ("idempotency": sending the same "create" twice creates it once);
  - background jobs;
  - encryption of the Gmail credentials that only the capture worker can undo;
  - logging and error reporting that can't leak amounts, payees, messages or tokens.
- **Web and Android skeletons.** They hold no Budmon screens yet, but have everything screens will need: error and "update required" screens, the offline banner and sync indicator, translations from day one, right-to-left layout rules, and accessibility checks.
- **The "just me" infrastructure (stage 0):** one Hetzner server running everything, nightly encrypted backups to Backblaze B2, monitoring with email alerts, and a deploy process that only installs releases that passed a full "rehearsal" in CI and that you approved.
- **The rehearsal:** before every release, CI builds a copy of production (the real stage-1 layout, with fake Google and fake exchange-rate services). It upgrades a copy of the previous database, checks no private data leaks into any log, and checks that rolling back works.

**Deliberately left out** (a later "stage-1" design, written before you invite anyone):
- the separate capture server;
- disk encryption with manual unlock;
- the host firewall and outbound-traffic allowlist;
- the 12-item checklist before inviting people.

The code for stage 1 is all built now (the HLD's rule: moving to stage 1 must not need code changes). Only the extra servers and their setup wait.

## 2. Needs your attention

| # | Item | Why it matters | LLD ref |
| - | ---- | -------------- | ------- |
| 1 | **Q-1, open: exchange rates before 2 March 2024.** The free backup rate source has no data before that date. Options: (a) show "no rate" for older dates; (b) also fetch older dates from Open Exchange Rates, up to ~300 calls a month; (c) let you type rates in later. | Matters if you import old history. OXR's own pages (seen only through search snippets) say its free plan includes historical rates, but one other site says it's paid-only; I couldn't confirm. The reviewer recommends (b) if it's free, else (a). Doesn't block building the first slices. | §11 |
| 2 | **Extra approval click on every release** (not just hotfixes). Agents work under your GitHub account, so a merged release PR alone could otherwise lead to a release. Now you also click "approve" once before any release is tagged. | Safer, at the cost of one click per release. **You can drop it** and approve only hotfixes and infra-only releases. | §9 S-16 (`tag.yml`) |
| 3 | **GitHub setup you must do by hand** (no agent can or should):<br>• a tag ruleset so that only a dedicated GitHub App can create release tags (you included);<br>• that GitHub App, installed on this repository only;<br>• two environments: `tagging` (holds the App's key, `main` only) and `tag-approval` (you as the required approver);<br>• the `production` environment with you as the approver;<br>• a token for agents **without** the "Deployments", "Administration", "Environments" or "Secrets" permissions, and revoking any old classic token;<br>• a hardware security key (2FA) on your GitHub account. | Together these make "signed release" mean "reviewed, rehearsed and approved by you". A guard job checks the settings every hour and emails you if they change. A compromised GitHub account would still defeat it, hence the hardware key. | §9 S-16, F-174, F-186 |
| 4 | **Buy the domain (`budmon.com`, or `.io`) before the first deploy.** | HTTPS certificates, Google's sign-in redirect and the Android app's server address all need it. Changing it later means reinstalling the Android app. | §9 S-15c AC-15.1 |
| 5 | **Manual acceptance after the first deploy:** run the first **restore drill** (rebuild the database from backup on a throwaway server and check it), and **test-fire each alert** once. | Proves the backups and alarms actually work before you rely on them. Both are in runbooks and recorded in `docs/operations/`. | §9 S-15c AC-15.2, AC-15.3 |
| 6 | **DV-1:** "telemetry dropped" alerts. The HLD said the log collector (Alloy) counts every field it strips. It can only count that for logs, so stripped trace and metric fields are counted in the app instead. The ones the monitoring libraries always add are labelled "expected" and don't alert. | Same protection, fewer false alarms. Needs your OK because it differs from the HLD wording. | §1 |
| 7 | **DV-2:** a fourth environment name, `rehearsal`. It has production's rules, except that a local stand-in for Google's key service is allowed. | Lets the rehearsal be strict without real Google keys. | §1 |
| 8 | **DV-3:** the UI component library is picked now (**Kobalte**). The HLD wanted a trial first; the trial is now a test in the web slice, and switching to Ark UI would be an amendment if it fails. | A design document can't leave a dependency open. | §1, S-11b |
| 9 | **DV-4:** the "Gmail connections healthy" gauges are built by the `sources` module, not here. | The platform can't count connections before their tables exist. | §1 |
| 10 | **DV-5:** the rate-limit counter table has no created/updated timestamps. | Short-lived counters; skipping them saves a write per login attempt. | §1 |
| 11 | **Decision: releases are numbered by GitHub's run counter.** That number also serves as the web app's version. Servers refuse anything older than what they run, except exactly the previous release (rollback). | Prevents replaying an old release. Renaming the release workflow needs a one-time adjustment (runbook). | F-185, F-171 |
| 12 | **Decision: the server considers itself "ready" if the database is at most one migration ahead of the code.** | This is what makes one-step rollbacks possible. | F-57 |
| 13 | **Decision: on the web, "Try again" after an uncertain save reuses the same idempotency key** while you haven't changed the form. | It can't create a duplicate even if the first attempt actually succeeded. | F-205 |
| 14 | **Decision: database passwords are stored and set as hashes** (SCRAM "verifiers"), so the deploy never handles a plaintext password for another service. Rotating the database admin's own password works through a one-time fallback. | Keeps the capture worker's password away from everything else; lets you rotate passwords at the stage-1 gate. | F-15, F-92, F-191 |
| 15 | **Decision: TypeScript is pinned to 5.9.3,** not the new 7.x. | The linter doesn't support 7 yet. | §2.4 |

## 3. Data

Four small tables, all owned by the platform:

| Table | What it holds | On delete |
| ----- | ------------- | --------- |
| `currencies` | Every real ISO currency, with its number of decimals (EGP 2, JPY 0, KWD 3). Loaded from a file on every deploy. | Never deleted; withdrawn currencies are marked inactive. Changing a currency's decimals is refused. |
| `exchange_rates` | One rate per currency per day, against USD, written exactly as the provider sent it. | Never changed once stored. |
| `idempotency_records` | For each "create" request: who sent it, its key, a fingerprint of the input, and the new item's id. Never the item's content. | Deleted after 90 days, and when the user is erased. |
| `rate_limit_counters` | Counters for "too many attempts" limits, keyed by a hash of the IP or email, never the raw value. | Expire within minutes; not even saved to disk. |

**Other stores:**
- the job queue's tables (pg-boss);
- two private storage buckets: `exports` (deleted after 7 days) and `erasure-log` (a record of erased users, kept 30 days so a restored backup can be re-erased);
- the encrypted backups.

**Database roles:** each part of the system logs in as its own role, with only the rights it needs. The capture worker's role can never read credential tables (passwords, sessions), and a test fails if anyone grants it that.

## 4. API and screens

**API** (everything under `https://budmon.com/api/v1`):

| Call | Purpose |
| ---- | ------- |
| `GET /meta/client-config` | Tells the apps the minimum and latest supported versions. The only public call. |
| `GET /health/ready`, `/health/live` | For monitoring and deploys; not part of the API proper. |
| `GET /version.json` | The web app checks this to offer "Reload to get the latest version". |

**Every API answer follows the same rules:**
- errors have one shape (a code such as `NOT_FOUND`, plus a fixed message);
- unexpected errors say whether anything was saved ("Nothing was changed" vs "We couldn't confirm this was saved");
- every response carries a short reference you can quote when reporting a problem.

**Screens and shared pieces** (wording as agreed in the HLD):
- Web: an error page ("Something went wrong on our side" with **Try again** and a reference), field and form error messages, a "too many attempts" countdown, the update toast and banner, the offline banner, and a placeholder home page.
- Android:
  - the full-screen "Update Budmon to continue", which keeps your offline entries;
  - the update card;
  - the error screen;
  - the offline banner;
  - the sync indicator ("3 waiting to sync") and per-entry chips ("Not yet synced", "Couldn't sync: tap to fix", "Check before syncing").
- Web lists that can grow large use a virtualised table: only visible rows are drawn, tested on 100,000 rows.

## 5. Functions at a glance

The LLD's catalog has about 184 functions. They're grouped by area here; the right column names only the ones worth a look.

| Area | Functions | Responsibility | Worth a look |
| ---- | --------- | -------------- | ------------ |
| Repository tooling | 10 (F-1 to F-9) | Lint rules, CI checks. | F-1: lint bans on float money maths, bypassing the layers, raw logging. F-6/F-6b: migrations only on release branches. |
| Shared money, time, IDs | 11 (F-300 to F-313) | Exact money in code shared by server and web; Android mirrors it. | F-302 `allocate` (splits always add up exactly); F-303 conversion (rounds once, half-to-even); test vectors shared with Android. |
| Configuration and database | 14 (F-10 to F-23) | Settings checked at start-up, database roles and grants, building dev databases, `db:reset`. | F-11: a wrong setting stops the process and never prints secret values. F-15/F-16: roles, passwords and grants. F-20: `db:reset` refuses anything but a local database. |
| Observability and privacy | 12 (F-30 to F-42) | Logging, error reports, traces, metrics. | F-30/F-31: logs accept only a fixed list of safe fields. F-33: errors reported without their message. F-35/F-40: Sentry and trace scrubbing. |
| API server and errors | 9 (F-50 to F-58) | The HTTP server, error mapping, login hooks, health checks. | F-52: maps every failure to the error format, never leaking internals. F-53: every call needs login unless explicitly public. |
| Security baseline | 6 (F-61 to F-66) | Headers, size limits, rate limits, password hashing. | F-63: rate limits shared by all servers. F-66: Argon2id password hashing. |
| Jobs and workers | 12 (F-70 to F-81) | Background job queue, retries, dead-letter queue. | F-72: job data may only hold IDs and codes, never text. F-76: failed jobs store a sanitised error only. |
| Entry points and wiring | 7 (F-90 to F-96) | Start-up of api, workers, migrate and the CLI. | F-92: database migration on deploy. |
| Idempotency and paging | 6 (F-100 to F-105) | Safe retries; list paging. | F-100: a create sent twice is created once. F-103: page cursors are encrypted, so URLs never show amounts or payees. |
| Credential encryption | 12 (F-110 to F-122) | Sealing secrets so only the capture worker can open them; Google sign-in plumbing. | F-111/F-112: Google's key service (KMS) sealing and unsealing. F-121: capture can only talk to Google's hosts. F-122: proxy support built in now for stage 1. |
| Exchange rates | 6 (F-130 to F-138) | Daily rates and conversions. | F-132: rates are "provisional" until the day's rate arrives. F-137: switches to the backup provider after 6 hours. |
| Storage and erasure | 7 (F-140 to F-146) | Export files, the erasure log. | F-146: the erasure log that keeps deleted users deleted after a restore. |
| Operations | 3 (F-150, F-151, F-160) | Restore check, erasure replay, server-side message text. | F-150: checks a restored database is complete and uncorrupted. |
| Deploy and hosts | 8 (F-170 to F-177) | Database image, deploy bootstrap, Compose, Caddy, Alloy, hosts. | F-170: the database refuses to start empty by accident. F-171/F-174: only signed, newer releases are installed. F-172: automatic rollback if the new release isn't healthy. |
| Owner commands | 3 (F-190 to F-192) | `budmonctl` secrets tools on your machine. | F-191: rotate a database password. |
| Release tooling and rehearsal | 13 (F-180 to F-199) | Generating migrations, release checks, tagging, the rehearsal. | F-182: migrations must rebuild the exact schema. F-186: who may tag a release. F-195: the rehearsal. |
| Web | 21 (F-200 to F-221) | Skeleton, errors, updates, offline, i18n, virtual table. | F-205: create retries reuse the same key. F-219/F-220: the big-table component. |
| Android | 14 (F-250 to F-263) | Skeleton, offline outbox, sync, update handling. | F-255: the offline outbox resends the exact original bytes, so a retry can't duplicate. |
| Contract | 10 (F-340 to F-349) | The API definition and its rule checks. | F-340: money is a whole number on the wire. F-348: automatic checks of those rules. |

## 6. Build plan

| Slice | Delivers | How you'd see it working | Depends on |
| ----- | -------- | ------------------------ | ---------- |
| S-0 | Repo restructure and clean-up, lint, CI skeleton | Old `server/` gone; `pnpm check` passes on a fresh clone; CI runs on PRs. | none |
| S-1 | Money, time and ID library | Test vectors pass (e.g. 100 split three ways is 34/33/33). | S-0 |
| S-2 | Settings, database, local dev | `pnpm dev` starts everything and the health check answers within 90 s. | S-1 |
| S-3 | Safe logging, error reports, traces | Tests that push fake "canary" secrets through everything find none in any output. | S-2 |
| S-4 | Contract, API server, errors | `GET /api/v1/meta/client-config` answers; every other call says "login required". | S-3 |
| S-5 | Security headers, limits | The 301st request in a minute gets "Too many attempts". | S-4 |
| S-6 | Background jobs | A failing job is retried, then lands in the dead-letter queue with no private data. | S-4 |
| S-7 | Idempotency, paging | Sending the same create twice gives the same result and one row. | S-6 |
| S-8 | Credential encryption | A sealed secret opens only in the capture worker; the API can't. | S-6 |
| S-9 | Exchange rates | Yesterday's rates appear each morning; conversions match the vectors. | S-6 |
| S-10 | Storage, erasure log, restore check | `restore:verify` reports a healthy database. | S-6 |
| S-11a | Web lint guards, translations | A left/right CSS class or a hard-coded string fails lint; pseudo-languages render. | S-4 |
| S-11b | Web UI foundations | Error page, update toast, offline banner, right-to-left test page all pass in the browser tests. | S-11a |
| S-12 | Web big-table component | 100,000 rows scroll smoothly within the stated targets. | S-11b |
| S-13 | Android skeleton | Offline entries sync when back online; an old app version shows "Update Budmon to continue". | S-4, S-7 |
| S-14 | Release-migration tooling | A release branch gets one generated migration, checked against the schema. | S-2 |
| S-15a | Images, database safeguards, Compose, Caddy, Alloy | The stage-0 stack runs in CI; the database refuses to initialise without the setup flag. | S-5 to S-10, S-11b, S-14 |
| S-15b | Deploy bundles, bootstrap, `budmonctl` | A deploy installs only a signed, newer release and rolls back if unhealthy. | S-15a |
| S-15c | Server provisioning, backups, alerts, first deploy | The server is live; nightly backups appear; you've done the restore drill and test-fired the alerts. | S-15b |
| S-16 | Release rehearsal and release workflow | A release PR runs the full rehearsal; after your approvals, the release deploys. | S-15c, S-11b, S-13 |

## 7. Testing

About 245 test cases:

| Type | Count | Notes |
| ---- | ----- | ----- |
| Unit | ~130 | Including 9 for the deploy shell scripts. |
| Integration | ~85 | Against a real Postgres database. |
| End-to-end | 16 | Browser, Android emulator, and the rehearsal. |
| Static checks | 10 | Configuration and workflow checks. |
| Manual | 2 | The first restore drill and alert test-firing. |

**What's covered:**
- every function;
- every error;
- the privacy "canary" checks on every slice;
- "every call needs login";
- database rights per role;
- right-to-left layout;
- the release signing chain (including a check that GitHub's protection settings are still in place).

**Not covered here:**
- **Accessibility checks report but never block**, as you asked. Only four simple lint rules block (images need alt text, buttons need names, valid ARIA, no positive tab order).
- **Real Google, Backblaze and Grafana services** are stood in for by fakes in CI. The first real contact is the first deploy.
- **The capture worker's privacy paths with real Gmail data** are tested when the `sources` module is built.

## 8. Risks

- **One server holds everything in stage 0.** If it dies, Budmon is down until it's rebuilt from scripts and backups (under an hour plus the restore). Data loss is limited to about 5 minutes.
- **Your GitHub account is the root of trust.** If it's compromised, the release protections can be switched off. Mitigations: a hardware key, agents without approval rights, and an hourly settings check that emails you.
- **Young libraries:** the API framework (oRPC), the UI library (Kobalte, pre-1.0) and the Android client generator. Early "spike" tests in S-4 and S-11b catch problems before modules depend on them.
- **The backup rate provider** is a free community service with no guarantee. Every stored rate records its source, and no paid plan is used without asking you.
- **Free-tier limits** on monitoring and error reporting could cut off data during a big incident. Usage is checked monthly.
