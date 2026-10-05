# CLAUDE.md

## Project name

This budgeting app is **Where Did I Tap** (short form **WDIT**).

- Domain: **wherediditap**, bought on Cloudflare (assumed .com).
- In branding (logo, links, social handles, App Store), always write
  **WhereDidITap** with each word capitalised. In lowercase, "wherediditap"
  can be misread as "where did it ap".
- In prose, "Where Did I Tap" is fine. Use **WDIT** for the icon, tight spaces
  and code identifiers.
- The name is final; don't suggest alternatives.

## Code naming

- Package, Docker container and database: `wdit` (`wdit-postgres`,
  `POSTGRES_DB: wdit`).
- Base error class: `WditError` in `server/src/errors/index.ts`.
- GitHub repo: `ali-hy/WhereDidITap`.
- The server connects using `DATABASE_URL` in `server/.env`; its database name
  should be `wdit` to match `compose.yaml`.
