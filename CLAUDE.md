# CLAUDE.md

## Project name

This budgeting app is **Where Did I Tap** (short form **WDIT**). It was
previously called **Budmon**, and the code still uses that name until the
rename below is done.

- Domain: **wherediditap**, bought on Cloudflare in Oct 2026 (assumed .com).
- In branding (logo, links, social handles, App Store), always write
  **WhereDidITap** with each word capitalised. In lowercase, "wherediditap"
  can be misread as "where did it ap".
- In prose, "Where Did I Tap" is fine. Use **WDIT** for the icon, tight spaces
  and code identifiers.
- Don't suggest new names. The domain is bought. Past candidates and why they
  were rejected are in `naming.md`.

## Pending rename: Budmon → WDIT

Not done yet. When asked to do it:

| Where | From | To |
|---|---|---|
| `server/package.json` `name` | `budmon` | `wdit` |
| `compose.yaml` `POSTGRES_DB` | `budmon` | `wdit` |
| `code-bites.md` docker command | `budmon-postgres`, `POSTGRES_DB=budmon` | `wdit-postgres`, `POSTGRES_DB=wdit` |
| `server/src/errors/index.ts`, `server/src/auth/authErrors.ts` | `BudmonError` | `WditError` |
| `README.md` | — | Use "WhereDidITap" as the project name |

- The GitHub repo is already renamed to `ali-hy/WhereDidITap` (old
  `ali-hy/Budmon` URLs redirect). Local clones can update their remote with
  `git remote set-url origin https://github.com/ali-hy/WhereDidITap`.
- The server connects using `DATABASE_URL` in `server/.env`. After the rename,
  tell the user to change the database name in that URL to `wdit` and recreate
  the Postgres container.
