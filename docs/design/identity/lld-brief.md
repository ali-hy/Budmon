---
module: identity
doc: lld-brief
summarises: lld.md v0.4
---

# Identity: LLD brief

A human-readable summary of [the LLD](./lld.md) for review and approval. The LLD is the contract the agents build from; this brief is what the owner reads. If the two ever disagree, the LLD wins and the brief is out of date.

## 1. What this builds

When identity is done, Budmon has real users:

- **Getting in:**
  - You create the first (owner) account with one command on the laptop.
  - Everyone else joins from an emailed invitation, with a password or with Google.
  - People sign in on the web and on Android and stay signed in for about a month (at most 90 days before signing in again).
  - Two-step verification with an authenticator app is optional, with ten recovery codes.
  - Forgotten passwords are reset by email.
- **Settings:**
  - Name, base currency, time zone and language.
  - Sign-in methods: password, Google, two-step, and the list of signed-in devices.
  - Inviting people within an allowance.
  - Exporting all your data as a ZIP of CSV and JSON.
  - Deleting your account with a 7-day undo.
- **For other modules:** the "who is calling" check on every request, a way to look up a user by exact email, attribution names, and hooks that let each module take part in data export and account erasure.
- **For the admin portal (built next):** ready-made operations for the owner: list users and invitations, set the user cap and allowances, delete or ban users, and reset someone's two-step verification. The portal's screens and audit log are `admin`'s.

Deliberately left out: changing your email address, passkeys, other sign-in providers, a "recent security activity" screen (events are recorded, not shown), and copyable invitation links.

## 2. Needs your attention

| # | Item | Why it matters | LLD ref |
| - | ---- | -------------- | ------- |
| 1 | **Decided in the HLD under your delegation, flagged "needs user confirmation":** 90-day absolute session limit; sharing invitations count against the inviter's allowance; you can turn off someone's two-step verification; finding users by exact email only (no invite links yet); all security notices are emailed. | These are product choices you may want to change. | HLD D-2, D-10, D-25, D-20, D-19 |
| 2 | **New table `known_devices`** (DV-2), for a fairer sign-in limit. A stranger hammering your email address can block password sign-in only from devices that have never signed in before. Your own phone and laptop keep working. | It's the answer to "limit guessing without letting someone lock you out". | §1 LD-1, §3.1 |
| 3 | **Cookies on `http://localhost` aren't `__Secure-` prefixed** (DV-3). They're still `Secure` and `HttpOnly`. The choice is made by the address the browser used, and each kind of cookie is accepted only where it belongs. | It removes a browser-compatibility risk on the laptop. A spike test still checks that the browsers keep the cookies. | §1 DV-3, TP-0.30 |
| 4 | **The capture worker can read the whole `users` row**, including email and name; it still can't see any password, session or code (DV-4). | The platform only supports table-level grants. Column-level grants would be a platform change. | §3.2 |
| 5 | **Lifetimes are constants in code**, not settings (DV-1). | Changing "30 days" means a small code change, not an environment variable. | F-1 |
| 6 | **A few extra error cases** beyond the HLD's list (DV-5): for example "your Budmon account is connected to a different Google account", "the owner can't delete their own account", and "your account is already being deleted" (cancelling is refused once the 7 days are up). | They make edge cases explicit; wording is in §8.1. | §6 |
| 7 | **Built on the platform LLD v0.13.** Your earlier requests PA-1 to PA-6 are in it as amendments A-1 to A-6, and identity uses their exact names. The `budmon-local bootstrap-owner` command and Android's Google client-ID setting are the platform's, not identity's. | Nothing to align later. | §1 |
| 8 | **Five platform requests (PA-7 to PA-11) have landed** in the platform LLD v0.13 as A-22 to A-26: a proper file name for export downloads; a "delete all" for Android's offline queue; Google sign-in and the email privacy check in the release rehearsal (with a separate rehearsal owner address); and named spots where modules plug in. Identity uses their final names. Identity's own first slice still adds the `identity` slot to the platform's containers (the platform left that to identity). | Nothing left waiting on the platform. | §1.1 |
| 9 | **Reset links open in the phone's browser for the MVP** (LD-9). Your delegated decision Q-1 (a); **needs user confirmation**. | The Android app doesn't open reset links itself. | §1 LD-9 |
| 10 | **Two tabs refreshing at once never sign you out** (DV-9). The reviewer's option (a), taken under your delegation, changes the approved HLD's wording for one case of D-3. Theft detection is unchanged. | The HLD's D-3 text should be updated to match next time it's revised. | §1 DV-9, F-25 |
| 11 | **Google sign-in errors land on the sign-in page.** When Google returns to Budmon with an unknown or expired request, you land on `/sign-in` with "Google sign-in didn't complete. Try again." (as the HLD says). Errors on a known request return to the page that started it. | What you'll see when something goes wrong mid-way. | F-82 |
| 12 | **Admin can record its audit entry in the same step** as each owner action (delete, ban, reset two-step, and so on), and the user-cap email reaches you even when the inviter's account is gone. | Fits the admin portal built next. | F-125, F-32 |
| 13 | **Other recorded deviations:** no separate "event fan-out" job (DV-6); Edge checked by you rather than automatically (DV-7); the module's files are flat in one folder so the platform's checks cover them (DV-8). | Low impact; listed for completeness. | §1 |
| 14 | **Manual checks only you can do** (TP-M.1 to TP-M.6): signing in on the laptop and phone, real Google sign-in (web from the laptop; Android), a real authenticator app, the bootstrap command on Windows, Mailpit emails, and sign-in in Edge. | The build environment has no Windows, Android SDK, real Google or real SMTP. | §10.1 |
| 15 | **Before the first invitation (stage-1 gate):** register the Google sign-in client and Android client IDs, choose the email provider, and set the `budmon.com` redirect. | Configuration only; no code change. | §7.1, §7.2 |

## 3. Data

Fifteen new tables, all owned by identity. "Credential" tables are never readable by the capture worker; the platform's schema step refuses it if someone tries.

| Table | What it holds | On delete of the user |
| ----- | ------------- | --------------------- |
| `users` | Email (lower-cased, unique), name, language, time zone, base currency, status (active or pending deletion, and who asked), owner flag, invite allowance, who invited them, last active (hourly). | The row is deleted at erasure; everything below goes with it. |
| `password_credentials` ★ | The Argon2id password hash. | Deleted. |
| `google_identities` ★ | The linked Google account's ID and email. | Deleted. |
| `two_step_credentials` ★, `recovery_codes` ★ | The encrypted authenticator secret; recovery codes as keyed hashes only. | Deleted. |
| `sessions` ★, `session_refresh_tokens` ★ | One row per signed-in device; every refresh token the device ever had (hashed), so a stolen old one is recognised. | Deleted. |
| `known_devices` ★ | Devices that have signed in before (hashed tokens), for the sign-in limit. A device stays known after you sign out. | Deleted. |
| `auth_challenges` ★ | Short-lived steps: a pending two-step sign-in, a Google round trip, a sign-up ticket. | Deleted; also purged hourly. |
| `password_resets` ★ | Reset links (hashed). | Deleted. |
| `invitations` ★ | Invitations: email, inviter, status (pending, accepted, revoked, expired), hashed token. | Accepted ones go with the user; ended ones are purged after 90 days. |
| `email_bans` | Banned addresses (kept until you lift the ban). | Not tied to a user. |
| `identity_settings` | The user cap (default 90). | — |
| `security_events` | Security history per user (no IP addresses), kept 90 days. | Deleted. |
| `data_exports` | Export requests and where the file is. | Deleted, and the files are removed from storage. |

Nothing that grants access is stored in a usable form. Passwords are hashed; tokens are hashed; recovery codes are keyed hashes; the authenticator secret is encrypted.

## 4. API and screens

**API** (all under `/api/v1`, about 50 procedures):

- **Signing in** (`/auth/…`):
  - sign-in options;
  - sign in, two-step verify, refresh, sign out;
  - Google start/complete (web), Google nonce/token (Android);
  - password-reset request, check and confirm.
- **Your account** (`/me/…`):
  - your profile and preferences;
  - "confirm it's you";
  - connect/disconnect Google;
  - change/add password;
  - two-step setup, enable, disable, new codes, replace authenticator;
  - signed-in devices and signing them out.
- **Invitations** (`/invitations/…`): list, allowance, send, resend, cancel; preview and accept (public).
- **Others:** look up a user by exact email; data exports (list, request, download link); account deletion (check, request, cancel).
- **One route outside the API description:** Google's return address. It only ever redirects back into the app.

**Screens** (web and Android): sign in; two-step code; forgot password and new password; invitation landing, account set-up and invitation problems; Android's "paste your invitation link"; settings home; profile and preferences; sign-in and security (password, Google, two-step, devices); two-step setup with QR code and recovery codes; invite people; your data (export); delete account; the "account will be deleted" banner; the "confirm it's you" dialog; the first-run home ("Welcome to Budmon, {name}."); and a public privacy notice at `/privacy` (its full text is in the LLD, §8.3). Every screen has its empty, loading, error and long-content states, and every message is listed word for word in the LLD.

## 5. Functions at a glance

| Area | Functions | Responsibility | Worth a look |
| ---- | --------- | -------------- | ------------ |
| Foundations | F-1 to F-39 (about 35) | Constants, token and cookie helpers, repositories, session creation, the per-request sign-in check, limits, email sending and templates, jobs, wiring. | **F-24** the per-request check (cookies only from the web app; bearer only from Android). **F-32** invitation and reset links are created inside the email job, so the link never sits anywhere else. **F-39** password hashing with a cap on parallel work. |
| Sign-up and bootstrap | F-40 to F-47 | Invitation preview and acceptance; the owner bootstrap command and its laptop wrapper. | **F-41** the user cap is re-checked when someone accepts. **F-46/F-47** the owner link is printed only to your terminal and never reaches logs. |
| Sign-in, sessions, step-up | F-50 to F-59, F-25, F-130 | Password sign-in, two-step at sign-in, refresh, devices list, "confirm it's you", hourly clean-up. | **F-25** the refresh rules that catch a stolen refresh token without signing out honest users. **F-50** the limits that stop guessing without letting a stranger lock you out. |
| Two-step | F-60 to F-68 | Authenticator codes, recovery codes, setup, turning off, new codes, new phone. | **F-62** authenticator codes are limited per person, recovery codes aren't, so a password thief can't lock you out. |
| Passwords | F-70 to F-74 | Reset by email, change, add. | **F-72** a reset still asks for the two-step code and signs out every other device. |
| Google | F-80 to F-88 | Web round trip, Android sign-in, linking, confirming. | **F-86** automatic linking only for Google-verified emails, and only after two-step. |
| Profile, invitations, lookup | F-90, F-95 to F-106 | Preferences, invitations with allowance and cap, exact-email lookup, names for other modules. | **F-95** the exact order of refusal reasons. |
| Export and deletion | F-110 to F-119 | ZIP export; deletion with grace, erasure across modules, replay after a restore. | **F-118** erasure writes its log record first and is safe to repeat. |
| Owner services | F-125 | Operations for the admin portal. | **Ban** closes the account at once and erases it within minutes. |
| Web and Android | F-150 to F-173, F-200 to F-220 | Screens, silent session renewal, encrypted token storage on Android, Credential Manager. | **F-150/F-203** single-flight renewal on both apps. **F-205** unsynced offline entries never sync into another person's account. |

## 6. Build plan

| Slice | Delivers | How you'd see it working | Depends on |
| ----- | -------- | ------------------------ | ---------- |
| S-0 | Foundations | Tests pass; emails appear in Mailpit in development | Platform v0.13 (A-1 to A-6, A-22 to A-26) |
| S-1 | Sign-up from an invitation with a password | An emailed invitation creates an account on web and Android | S-0 |
| S-2 | Owner bootstrap | `budmon-local bootstrap-owner` prints a link that makes you the owner | S-1 |
| S-3 | Sign-in, sessions, "confirm it's you" | You stay signed in; the devices list works; sign-out works | S-1 |
| S-4 | Two-step verification | Your authenticator app's codes are asked for at sign-in | S-3 |
| S-5 | Password reset and changes | "Forgot password?" emails a working link | S-4 |
| S-6 | Google Sign-In | "Continue with Google" works on the laptop's browser and on Android | S-4 |
| S-7 | Profile and preferences | Language changes instantly; base currency asks first | S-3 |
| S-8 | Invitations | You invite someone; they receive the email and join | S-3 |
| S-9 | Finding a user | Exact-email lookup for sharing | S-3 |
| S-10 | Data export | A ZIP with CSV and JSON downloads, named `budmon-export-<date>.zip` | S-3 |
| S-11 | Account deletion | Delete, undo within 7 days, full erasure after | S-8, S-10 |
| S-12 | Owner services | Ready for the admin portal | S-11 |

## 7. Testing

About 216 test cases:

| Type | Count | What |
| ---- | ----- | ---- |
| Integration | ~135 | Real Postgres, in-process HTTP, the jobs, a fake Google with real signed tokens, and an in-memory mailbox |
| Unit | ~30 | Server, web and Android |
| End-to-end | ~30 | Playwright in Chromium, with a fake Google and a test mailbox; the stage-0 rehearsal |
| Manual | 6 | The owner, on the laptop and phone |

What the tests cover:

- **Every error and every boundary:** an invitation expiring at exactly 7 days; a session at exactly 30 days idle and 90 days absolute; both 60-second windows of the refresh rules, including the "thief redeems an old token while your device is in use" case.
- **Authorization across users:** you can't see or cancel someone else's sessions, invitations or exports.
- **Privacy "canary" tests:** fake emails, passwords and tokens go through every flow, and the logs, traces, error reports and job records must never contain them.
- **The credential-table rule:** the capture worker's database role is refused on every credential table.
- **Erasure:** a guard test fails if any future table references users without being erased.

Not covered automatically: real Google, real SMTP, Android on a device, Windows and Edge. These are the manual cases TP-M.1 to TP-M.6.

## 8. Risks

- **Google on the laptop:** until there's a domain, web Google sign-in works only in a browser on the laptop itself; the phone's browser shows a note. The Android app's Google sign-in isn't affected.
- **Mailpit in stage 0:** emails stay on the laptop (readable at `http://127.0.0.1:8025`). Fine while you're the only user.
- **Platform alignment:** identity is aligned with platform v0.13. Any later change to the platform's names would need an identity amendment.
- **Later modules must join erasure and export:** every module that stores user data registers how it's erased and exported. The guard test catches the ones that forget.
- **Lost authenticator and lost codes:** only you, as owner, can help (by turning two-step off for that user). The user is emailed when you do.
