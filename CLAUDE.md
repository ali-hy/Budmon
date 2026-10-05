# CLAUDE.md

## Project name

This budgeting app is **Where Did I Tap** (short form **WDIT**). It was
previously called **Budmon**; the code was renamed to WDIT in Oct 2026.

- Domain: **wherediditap**, bought on Cloudflare in Oct 2026 (assumed .com).
- In branding (logo, links, social handles, App Store), always write
  **WhereDidITap** with each word capitalised. In lowercase, "wherediditap"
  can be misread as "where did it ap".
- In prose, "Where Did I Tap" is fine. Use **WDIT** for the icon, tight spaces
  and code identifiers.
- Don't suggest new names. The domain is bought. Past candidates and why they
  were rejected are in `naming.md`.

## Code naming

- Package, Docker container and database: `wdit` (`wdit-postgres`,
  `POSTGRES_DB: wdit`).
- Base error class: `WditError` in `server/src/errors/index.ts`.
- The GitHub repo is `ali-hy/WhereDidITap` (old `ali-hy/Budmon` URLs redirect).
  Local clones can update their remote with
  `git remote set-url origin https://github.com/ali-hy/WhereDidITap`.
- The server connects using `DATABASE_URL` in `server/.env`; its database name
  should be `wdit` to match `compose.yaml`.
