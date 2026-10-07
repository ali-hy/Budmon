---
module: platform
doc: lld-brief
summarises: lld.md v0.6
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
- **The "just me" setup (stage 0) on your Windows laptop:**
  - Docker Desktop (WSL2 backend), with the code and all commands inside WSL2;
  - Budmon reachable at `https://<laptop>.<tailnet>.ts.net` through Tailscale, from the laptop and your phone (directly over Wi-Fi at home, through Tailscale elsewhere);
  - one command, `budmon-local`, to install, upgrade (building the images from a release tag), roll back, restore and switch maintenance on and off;
  - a database copy on the laptop before every upgrade (the last 5 kept), but **no off-site backups**, as you decided;
  - Sentry e-mails for errors; no other monitoring or alerts (the laptop sleeps, so uptime alerts would fire constantly);
  - the Android app built with the laptop's Tailscale address (a build setting, never committed).
- **The rehearsal:** before every release, CI runs the release on a copy of the laptop setup (with fake Google and fake exchange-rate services). It upgrades a copy of the previous database, checks no private data leaks into any log, checks the capture worker is cut off from the main database network, and checks that rolling back works.

**Deliberately left out** (a later "stage-1" design, written before you invite anyone):
- the servers and their provider, the domain, the tunnel to the capture server, disk encryption with manual unlock;
- deploying from CI: signed releases, the GitHub App and tag protection, approval environments, the settings guard job;
- off-site backups (pgBackRest), Grafana monitoring and alert rules, the outbound-traffic allowlist;
- the 15-item checklist before inviting people.

The code stage 1 needs is built now (the HLD's rule: moving off the laptop must not need code changes). Only the servers, their setup and the release chain wait.

## 2. Needs your attention

| # | Item | Why it matters | LLD ref |
| - | ---- | -------------- | ------- |
| 1 | **Q-1, decided: exchange rates before 2 March 2024 show "no rate".** The free backup rate source has no data before that date, so conversions dated earlier say "no rate" instead of guessing. This was the recommended default and went ahead with your go-ahead. | Matters only if you import old history. It can be extended later by an amendment, for example fetching older rates from Open Exchange Rates if its free plan includes them (not confirmed). | §11, F-132 |
| 2 | **Q-2, deferred: an approval click on every release.** It belonged to the release-signing chain, which now starts at stage 1. In stage 0 nothing deploys from CI: a merged release PR only gets a tag, and you run `budmon-local upgrade` yourself, which is the approval. | Nothing to decide now; it comes back with the stage-1 design. | §11 Q-2 |
| 3 | **One-time laptop setup by hand**, following `infra/runbooks/stage0-laptop.md`: WSL2 with Ubuntu, Docker Desktop (WSL2 backend, start at login), Tailscale on the laptop and phone (MagicDNS and HTTPS certificates switched on), the Google Cloud bootstrap script, two Backblaze B2 buckets for exports and the erasure log (free tier), filling in the few secret placeholders, then `budmon-local install` and `tailscale serve`. | No agent can or should do these. Budmon refuses to start while a placeholder is unfilled, so a missed step shows up at once. | §2.2 runbook, F-178, F-179, F-191 |
| 4 | **Your laptop's disk must be encrypted** (BitLocker or Windows device encryption). Budmon checks nothing here; the runbook asks you to confirm it. | Your real financial data and the Gmail credential file sit on that disk. This is the HLD's assumption A-14. | runbook, HLD A-14 |
| 5 | **No off-site backups in stage 0** (your decision). Before every upgrade a copy of the database is saved on the laptop (last 5 kept). If the laptop's disk dies or the laptop is lost, the data is gone. | Recorded as accepted. Off-site backups start at stage 1. | F-178, HLD D-30 |
| 6 | **No alerts in stage 0** except Sentry's "new error" e-mails. If Budmon stops while you're away, nothing tells you. | The laptop sleeping would make uptime alerts useless. Grafana and alerts start at stage 1. | §7.5 |
| 7 | **Gmail is connected from the laptop's browser**, not the phone. Google's sign-in sends you back to `http://localhost:8080`, because there's no domain yet. A new setting (`GOOGLE_OAUTH_REDIRECT_ORIGIN`) makes this possible. | Once per Gmail connection; capture then runs on its own. | §4.2, HLD A-16 |
| 8 | **Manual checks after the first install:** open Budmon on the laptop and on the phone (Wi-Fi and mobile data); record an entry on the phone while the laptop sleeps and see it sync after; trigger a test error and get the Sentry e-mail. | Proves the setup works end to end before you rely on it. | §9 S-15 AC-15.1 to AC-15.4 |
| 9 | **DV-1:** "telemetry dropped" alerts (from stage 1, when Alloy and alerts arrive; the app-side counters exist now). The HLD said the log collector (Alloy) counts every field it strips. It can only count that for logs, so stripped trace and metric fields are counted in the app instead. The ones the monitoring libraries always add are labelled "expected" and don't alert. | Same protection, fewer false alarms. Needs your OK because it differs from the HLD wording. | §1 |
| 10 | **DV-2:** a fourth environment name, `rehearsal`. It has production's rules, except that a local stand-in for Google's key service is allowed. | Lets the rehearsal be strict without real Google keys. | §1 |
| 11 | **DV-3:** the UI component library is picked now (**Kobalte**). The HLD wanted a trial first; the trial is now a test in the web slice, and switching to Ark UI would be an amendment if it fails. | A design document can't leave a dependency open. | §1, S-11b |
| 12 | **DV-4:** the "Gmail connections healthy" gauges are built by the `sources` module, not here. | The platform can't count connections before their tables exist. | §1 |
| 13 | **DV-5:** the rate-limit counter table has no created/updated timestamps. | Short-lived counters; skipping them saves a write per login attempt. | §1 |
| 14 | **Decision: the web app's build number is the number of commits in the release** (`git rev-list --count <tag>`). It only grows along `main`, and a hotfix gets a higher number than the release it fixes. | Lets the server tell old web versions to reload. Stage 1 may switch to a release-workflow counter. | F-185 |
| 15 | **Decision: the server considers itself "ready" if the database is at most one migration ahead of the code.** | This is what makes one-step rollbacks possible. | F-57 |
| 16 | **Decision: on the web, "Try again" after an uncertain save reuses the same idempotency key** while you haven't changed the form. | It can't create a duplicate even if the first attempt actually succeeded. | F-205 |
| 17 | **Decision: database passwords are stored and set as hashes** (SCRAM "verifiers"), so the migration step never handles a plaintext password for another service. A one-time fallback to the previous password lets the migration account's own password be rotated. The rotation commands themselves come with stage 1. | Keeps the capture worker's password away from everything else. | F-15, F-92, F-190, F-191 |
| 18 | **Decision: a daily "missing exchange rates" check**, also run whenever the worker starts. | The laptop is off at times, and the job scheduler doesn't catch up on missed runs; this fetches up to 31 missing days. | F-139 |
| 19 | **Decision: TypeScript is pinned to 5.9.3,** not the new 7.x. | The linter doesn't support 7 yet. | §2.4 |

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
- the local pre-upgrade database copies on the laptop (encrypted backups start at stage 1).

**Database roles:** each part of the system logs in as its own role, with only the rights it needs. The capture worker's role can never read credential tables (passwords, sessions), and a test fails if anyone grants it that.

## 4. API and screens

**API** (everything under `/api/v1`: on the laptop `https://<laptop>.<tailnet>.ts.net/api/v1`, from stage 1 `https://budmon.com/api/v1`):

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

The LLD's catalog has about 179 functions. They're grouped by area here; the right column names only the ones worth a look.

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
| Exchange rates | 7 (F-130 to F-139) | Daily rates and conversions. | F-132: rates are "provisional" until the day's rate arrives. F-137: switches to the backup provider after 6 hours. F-139: fills days missed while the laptop was off. |
| Storage and erasure | 7 (F-140 to F-146) | Export files, the erasure log. | F-146: the erasure log that keeps deleted users deleted after a restore. |
| Operations | 3 (F-150, F-151, F-160) | Restore check, erasure replay, server-side message text. | F-150: checks a restored database is complete and uncorrupted. |
| Laptop stack | 4 (F-170, F-175, F-178, F-179) | Database image, the laptop's Compose files and Caddy, `budmon-local`, the Google Cloud setup script. | F-170: the database refuses to start empty by accident. F-175: the database port is never published, so the development tools can't reach real data. F-178: an upgrade saves a database copy first and rolls back by itself if the new release isn't healthy. |
| Owner commands | 2 (F-190, F-191) | `budmonctl` secrets tools on the laptop. | F-191: creates every secret file, keeping the capture worker's secrets in their own folder. |
| Release tooling and rehearsal | 10 (F-180 to F-185, F-194 to F-198) | Generating migrations, release checks, the web build number, the rehearsal. | F-182: migrations must rebuild the exact schema. F-195: the rehearsal. |
| Web | 21 (F-200 to F-221) | Skeleton, errors, updates, offline, i18n, virtual table. | F-205: create retries reuse the same key. F-219/F-220: the big-table component. |
| Android | 15 (F-250 to F-264) | Skeleton, offline outbox, sync, update handling, server address. | F-255: the offline outbox resends the exact original bytes, so a retry can't duplicate. F-264: a release build refuses to build without an `https` server address. |
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
| S-9 | Exchange rates | Yesterday's rates appear each morning; days missed while the laptop was off are filled in; conversions match the vectors. | S-6 |
| S-10 | Storage, erasure log, restore check | `restore:verify` reports a healthy database. | S-6 |
| S-11a | Web lint guards, translations | A left/right CSS class or a hard-coded string fails lint; pseudo-languages render. | S-4 |
| S-11b | Web UI foundations | Error page, update toast, offline banner, right-to-left test page all pass in the browser tests. | S-11a |
| S-12 | Web big-table component | 100,000 rows scroll smoothly within the stated targets. | S-11b |
| S-13 | Android skeleton | Offline entries sync when back online; an old app version shows "Update Budmon to continue"; the release build needs the server address. | S-4, S-7 |
| S-14 | Release-migration tooling and tagging | A release branch gets one generated migration, checked against the schema; merging it creates the tag. | S-2 |
| S-15 | Stage-0 laptop stack | Budmon runs on your laptop and opens on your phone over Tailscale; an upgrade saves a copy first and rolls back if unhealthy; a test error reaches you by e-mail. | S-5 to S-10, S-11b, S-14 |
| S-16 | Release rehearsal (laptop shape) | A release PR runs the full rehearsal: upgrade, leak scan, isolation checks, rollback, smoke test. | S-15, S-11b, S-13 |

## 7. Testing

About 240 test cases:

| Type | Count | Notes |
| ---- | ----- | ----- |
| Unit | ~128 | Including 4 for the `budmon-local` and Google Cloud scripts. |
| Integration | ~90 | Against a real Postgres database. |
| End-to-end | 15 | Browser, Android emulator, and the rehearsal. |
| Static checks | 11 | Configuration, workflow and Android build checks. |
| Manual | 2 | First install and phone access; the Sentry test e-mail. |

**What's covered:**
- every function;
- every error;
- the privacy "canary" checks on every slice;
- "every call needs login";
- database rights per role;
- right-to-left layout;
- `budmon-local`'s upgrade, rollback and restore, with stand-ins for Docker and Git;
- the tagging step and the rehearsal on every release.

**Not covered here:**
- **Accessibility checks report but never block**, as you asked. Only four simple lint rules block (images need alt text, buttons need names, valid ARIA, no positive tab order).
- **Real Google, Backblaze and Sentry services, Windows, Docker Desktop and Tailscale** aren't in CI. The first real contact is the first install on your laptop (the manual checks above).
- **The capture worker's privacy paths with real Gmail data** are tested when the `sources` module is built.

## 8. Risks

- **Your laptop holds everything in stage 0, with no off-site copy.** A dead disk, theft or a failed Windows reinstall loses all data since you started. You accepted this; stage 1 adds off-site backups. A pre-upgrade copy protects only against a bad upgrade.
- **Budmon is only up while the laptop is on and awake.** The phone keeps entries offline and syncs later; Gmail capture and exchange rates catch up when it wakes (Gmail's push messages are kept 7 days).
- **Windows-specific trouble** (WSL2 memory, line endings, Docker Desktop updates). The runbook pins the settings (`.wslconfig`, `.gitattributes`), and every script runs inside WSL2.
- **The agents' GitHub token can create release tags in stage 0** (`tag.yml` uses the built-in token). That only names a commit: nothing deploys until you run `budmon-local upgrade`, and it only accepts tags on `main` or a hotfix branch.
- **Young libraries:** the API framework (oRPC), the UI library (Kobalte, pre-1.0) and the Android client generator. Early "spike" tests in S-4 and S-11b catch problems before modules depend on them.
- **The backup rate provider** is a free community service with no guarantee. Every stored rate records its source, and no paid plan is used without asking you.
- **Free-tier limits** on monitoring and error reporting could cut off data during a big incident. Usage is checked monthly.
