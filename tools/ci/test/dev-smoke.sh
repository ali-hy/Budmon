#!/usr/bin/env bash
# TP-2.18 (S-2, A-55, A-63): from a fresh clone (no .env), `pnpm dev` creates .env from
# .env.example, creates .data/dev-secrets/*, starts Postgres, and creates and pushes database
# `budmon` (the four platform tables) within 90 s.
# From S-4, TP-4.23 adds `/health/ready` answering 200 within the same 90 s.
#
# Runs in CI's `dev-smoke` job (main only). It clones the committed state of this repository (HEAD,
# or the ref given as $1) into a temporary directory, installs, starts `pnpm dev` in the
# background, polls, and always stops the dev stack (`docker compose -p budmon-dev … down -v`).
# The database is checked with psql at DEV_SUPERUSER_URL's host (default: .env.example's value,
# postgres://postgres:postgres@localhost:5432/postgres, A-59).
#
# Usage: tools/ci/test/dev-smoke.sh [ref]
set -euo pipefail

repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
ref="${1:-HEAD}"
commit="$(git -C "$repo_root" rev-parse --verify "${ref}^{commit}")"
superuser_url="${DEV_SUPERUSER_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
budmon_url="${superuser_url%/*}/budmon"
deadline_seconds=90

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/budmon-dev-smoke.XXXXXX")"
checkout="$work_dir/budmon"
dev_pid=""

# shellcheck disable=SC2317 # called through the EXIT trap
cleanup() {
  if [[ -n "$dev_pid" ]]; then
    kill -TERM -- "-$dev_pid" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$dev_pid" 2>/dev/null || true
  fi
  if [[ -f "$checkout/infra/compose.yaml" ]]; then
    docker compose -p budmon-dev -f "$checkout/infra/compose.yaml" down -v >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

echo "TP-2.18: cloning ${commit}"
git clone --quiet --no-hardlinks "$repo_root" "$checkout"
git -C "$checkout" checkout --quiet --detach "$commit"
(cd "$checkout" && pnpm install --frozen-lockfile)
if [[ -e "$checkout/.env" ]]; then
  echo "TP-2.18: the fresh clone already has a .env" >&2
  exit 1
fi

echo "TP-2.18: starting pnpm dev"
setsid bash -c "cd '$checkout' && exec pnpm dev" >"$work_dir/dev.log" 2>&1 &
dev_pid=$!

tables=""
for ((elapsed = 0; elapsed < deadline_seconds; elapsed += 2)); do
  if [[ -d "$checkout/.data/dev-secrets" ]] && [[ -n "$(ls -A "$checkout/.data/dev-secrets" 2>/dev/null)" ]]; then
    tables="$(psql "$budmon_url" -tAc "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'" 2>/dev/null || true)"
    if [[ "$tables" == "currencies,exchange_rates,idempotency_records,rate_limit_counters" ]]; then
      if ! cmp -s "$checkout/.env.example" "$checkout/.env"; then
        echo "TP-2.18: .env wasn't created as a copy of .env.example" >&2
        exit 1
      fi
      echo "TP-2.18: passed after ${elapsed}s (.env and dev secrets created; budmon has the four platform tables)"
      exit 0
    fi
  fi
  if ! kill -0 "$dev_pid" 2>/dev/null; then
    echo "TP-2.18: pnpm dev exited early" >&2
    break
  fi
  sleep 2
done

secrets="$(find "$checkout/.data/dev-secrets" -mindepth 1 -maxdepth 1 -printf '%f ' 2>/dev/null || true)"
echo "TP-2.18: failed (dev secrets: ${secrets:-none}; tables: ${tables:-none})" >&2
tail -n 40 "$work_dir/dev.log" >&2 || true
exit 1
