# Budmon

A personal budgeting and money-monitoring application. What it does and for whom is in
[the project brief](docs/product/project-brief.md) and
[the spec summary](docs/product/spec-summary.md). How work is done is in
[CLAUDE.md](CLAUDE.md) and [docs/design/README.md](docs/design/README.md).

## Layout

| Path              | Contents                                                         |
| ----------------- | ---------------------------------------------------------------- |
| `apps/server`     | Fastify and oRPC API server and workers (added by later slices)  |
| `apps/web`        | SolidJS single-page app (added by later slices)                  |
| `apps/android`    | Android app (added by later slices)                              |
| `packages/config` | Shared TypeScript, ESLint and Prettier configuration             |
| `packages/*`      | `shared`, `contract` and `test-support` libraries (later slices) |
| `infra/`          | Compose files, the laptop stack and runbooks (later slices)      |
| `tools/ci`        | CI scripts, such as the migration-file check                     |
| `docs/`           | Product documents and the design documents (HLD and LLD)         |

## Prerequisites

- Node 24 (see `.nvmrc`) and pnpm 10 (`corepack enable` picks up the pinned version).
- Docker with Compose v2, for the database used by integration tests (from slice S-2).
- JDK and Android Studio, for the Android app (from S-13).

## Commands

| Command          | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `pnpm install`   | Installs the workspace                                           |
| `pnpm check`     | Format check, lint, type-check, unit tests and integration tests |
| `pnpm test`      | Every Vitest project except `server-int`                         |
| `pnpm test:int`  | The `server-int` project (needs a database)                      |
| `pnpm lint`      | ESLint                                                           |
| `pnpm format`    | Prettier, writing changes (`pnpm format:check` only checks)      |
| `pnpm typecheck` | `tsc` over the workspace                                         |

## Environments

Stage 0 runs the whole stack on the owner's laptop; stage 1 and 2 move it to hosted
infrastructure without code changes. The stage model, and the environments for development and CI
are described in the
[platform HLD](docs/design/platform/hld.md). Only development and CI exist so far.
