#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 `install` and `maintenance`. TP-15.22 (a) to (e), stub part.
#
# Assumed (the LLD fixes behaviour, not the mechanics; see the S-15 questions): the prompts read
# answers from stdin, one line per key in F-175's site.env table order (CAPTURE_KEY_VERSION isn't
# asked); `sudo` is a stub that records every call and performs `install`/`grep` without changing
# ownership; F-191 is reached as `pnpm … secrets init-local --home <home>`.

load helpers

# One answer per prompt: PUBLIC_ORIGIN (Tailscale name), GOOGLE_OAUTH_CLIENT_ID (blank), S3_ENDPOINT,
# S3_REGION, S3_BUCKET_EXPORTS, S3_BUCKET_ERASURE_LOG (defaults), SENTRY_DSN, GOOGLE_SIGNIN_CLIENT_ID,
# GOOGLE_SIGNIN_ANDROID_CLIENT_IDS (blank), GOOGLE_SIGNIN_CALLBACK_ORIGIN, GOOGLE_SIGNIN_APP_ORIGINS,
# SMTP_URL, EMAIL_FROM (defaults).
ANSWERS=$'laptop.tailnet.ts.net\n\n\n\n\n\nhttps://k@o1.ingest.sentry.io/1\n123-abc.apps.googleusercontent.com\n\n\n\n\n\n'

setup() {
  common_setup
  cat >"${STUB_CONFIG}" <<'CONF'
stub_git() {
  local args=("$@")
  while [ "${args[0]:-}" = "-C" ]; do args=("${args[@]:2}"); done
  case "${args[0]:-}" in
    rev-parse) echo "c0ffee0000000000000000000000000000000001" ;;
    rev-list) echo 42 ;;
    merge-base|fetch) return 0 ;;
    worktree)
      if [ "${args[1]}" = "add" ]; then
        local dir="" a
        for a in "${args[@]:2}"; do case "${a}" in --*) ;; *) [ -z "${dir}" ] && dir="${a}" ;; esac; done
        mkdir -p "${dir}/infra/local" "${dir}/apps/server"
        (cd "${ROOT_FOR_STUBS}/infra/local" && tar --exclude=./test --exclude=./rehearsal -cf - .) | (cd "${dir}/infra/local" && tar -xf -)
        # Phase B is recorded, not run: install's own steps are what this file tests.
        cat >"${dir}/infra/local/budmon-local" <<'REC'
#!/usr/bin/env bash
printf 'budmon-local\t%s\t%s\tREEXEC=%s\tpath=%s\n' "${PWD}" "$*" "${BUDMON_REEXEC:-}" "$0" >>"${CALLS}"
exit "${PHASE_B_EXIT:-0}"
REC
        chmod +x "${dir}/infra/local/budmon-local"
      fi ;;
  esac
  return 0
}
stub_pnpm() {
  local all="$*" prev="" a home=""
  if [[ "${all}" == *"secrets init-local"* ]]; then
    for a in "$@"; do [ "${prev}" = "--home" ] && home="${a}"; prev="${a}"; done
    fake_init_local "${home}"
  fi
  return 0
}
stub_sudo() {
  case "$1" in
    install)
      local args=("$@") out="${args[-1]}" i dir=0
      for i in "${args[@]}"; do [ "${i}" = "-d" ] && dir=1; done
      if [ "${dir}" = 1 ]; then mkdir -p "${out}"; elif [[ " $* " == *" /dev/stdin "* ]]; then mkdir -p "$(dirname "${out}")"; cat >"${out}"; fi
      return 0 ;;
    grep) shift; grep "$@"; return $? ;;
    cat) shift; cat "$@"; return $? ;;
    *) return 0 ;;
  esac
}
stub_openssl() {
  local prev="" a
  for a in "$@"; do
    case "${prev}" in -out|-keyout) mkdir -p "$(dirname "${a}")"; echo "pem" >"${a}" ;; esac
    prev="${a}"
  done
  echo "pem"
  return 0
}
stub_docker() {
  local all="$*"
  if [[ "${all}" == run\ * && -n "${PROBE_FAIL_DIR:-}" && "${all}" == *"${PROBE_FAIL_DIR}:"* ]]; then return 1; fi
  return 0
}
CONF
  export ROOT_FOR_STUBS="${ROOT}" ANSWERS
}

placeholder_ready_home() {
  # As after (a), with every placeholder filled and F-179's output in site.env.
  printf "%s" "${ANSWERS}" | "${SCRIPT}" install v1.0.0 >/dev/null 2>&1 || true
  fill_placeholders
  sed -i -e 's/^GOOGLE_OAUTH_CLIENT_ID=.*/GOOGLE_OAUTH_CLIENT_ID=123-oauth.apps.googleusercontent.com/' \
    -e 's|^CAPTURE_KEY_VERSION=.*|CAPTURE_KEY_VERSION=projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/1|' \
    "${BUDMON_HOME}/site.env"
  : >"${CALLS}"
}

@test "TP-15.22 (a): install on an empty home runs F-191, hands each service directory to its UID, writes site.env 0600 with two placeholders, and exits 20 naming paths and keys only" {
  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure 20

  run bash -c "awk -F'\t' '\$1==\"pnpm\"' '${CALLS}'"
  assert_output --partial "secrets init-local --home ${BUDMON_HOME}"
  assert_output --partial "${BUDMON_HOME}/build/v1.0.0"

  local uid dir
  for pair in "10001 secrets/main/api" "10002 secrets/main/worker-general" "10003 secrets/capture/worker-capture" "10004 secrets/main/migrate" "999 secrets/main/postgres"; do
    read -r uid dir <<<"${pair}"
    run bash -c "awk -F'\t' '\$1==\"sudo\" && \$3 ~ /^chown -R ${uid}:${uid} /' '${CALLS}'"
    assert_output --partial "${BUDMON_HOME}/${dir}"
    run bash -c "awk -F'\t' '\$1==\"sudo\" && \$3 ~ /^chmod 0?500 /' '${CALLS}'"
    assert_output --partial "${BUDMON_HOME}/${dir}"
    run bash -c "awk -F'\t' '\$1==\"sudo\" && \$3 ~ /^chmod 0?400 /' '${CALLS}'"
    assert_output --partial "${BUDMON_HOME}/${dir}"
  done

  [ "$(stat -c '%a' "${BUDMON_HOME}/site.env")" = "600" ]
  run cat "${BUDMON_HOME}/site.env"
  assert_line "GOOGLE_OAUTH_CLIENT_ID=__FILL_ME__"
  assert_line "CAPTURE_KEY_VERSION=__FILL_ME__"
  assert_line "PUBLIC_ORIGIN=https://laptop.tailnet.ts.net"
  assert_line "S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com"
  assert_line "SMTP_URL=smtp://mailpit:1025"

  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure 20
  assert_output --partial "main/api/S3_ACCESS_KEY_ID"
  assert_output --partial "capture/worker-capture/GCP_CREDENTIALS"
  assert_output --partial "GOOGLE_OAUTH_CLIENT_ID"
  assert_output --partial "CAPTURE_KEY_VERSION"
  refute_output --partial "generated-"
}

@test "TP-15.22 (b): install after every placeholder is filled creates the network, pg/ (999, 0700), writes install.inprogress before first setup, calls _upgrade-continue --no-dump --first, then writes state and prints the tailscale command" {
  placeholder_ready_home
  run "${SCRIPT}" install v1.0.0
  assert_success
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^network create/' '${CALLS}'"
  assert_output --partial "--internal"
  assert_output --partial "--subnet 172.30.42.0/29"
  assert_output --partial "budmon_capture_db"
  run bash -c "awk -F'\t' '\$1==\"sudo\" && \$3 ~ /^install -d/' '${CALLS}'"
  assert_output --regexp "-o 999 -g 999 -m 0700 .*${BUDMON_HOME}/pg"
  run bash -c "awk -F'\t' '\$1==\"budmon-local\"' '${CALLS}'"
  assert_output --partial "_upgrade-continue v1.0.0 --no-dump --first"
  refute [ -e "${BUDMON_HOME}/install.inprogress" ]
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.0.0"
}

@test "TP-15.22 (b): a successful install prints the tailscale serve command for Windows" {
  placeholder_ready_home
  run "${SCRIPT}" install v1.0.0
  assert_success
  assert_output --partial "tailscale serve --bg --https=443 http://127.0.0.1:8080"
}

@test "TP-15.22 (b): install.inprogress (tag=v1.0.0, 0600) exists when Postgres starts with BUDMON_FIRST_SETUP=1" {
  placeholder_ready_home
  cat >>"${STUB_CONFIG}" <<'CONF'
stub_docker() {
  if [[ "$*" == *"BUDMON_FIRST_SETUP=1"* || "${BUDMON_FIRST_SETUP:-}" == 1 ]]; then
    if [ -f "${BUDMON_HOME}/install.inprogress" ]; then
      printf 'marker=%s mode=%s\n' "$(cat "${BUDMON_HOME}/install.inprogress")" "$(stat -c '%a' "${BUDMON_HOME}/install.inprogress")" >>"${CALLS}.marker"
    else
      echo "marker=missing" >>"${CALLS}.marker"
    fi
  fi
  return 0
}
CONF
  run "${SCRIPT}" install v1.0.0
  assert_success
  run cat "${CALLS}.marker"
  assert_output --partial "marker=tag=v1.0.0 mode=600"
  refute_output --partial "missing"
}

@test "TP-15.22 (c): install with state present exits 2" {
  write_state v1.0.0 ""
  run "${SCRIPT}" install v1.0.0
  assert_failure 2
}

@test "TP-15.22 (d): pg/ not empty without state or marker exits 2 (use restore)" {
  mkdir -p "${BUDMON_HOME}/pg/pgdata"
  : >"${BUDMON_HOME}/pg/pgdata/PG_VERSION"
  run "${SCRIPT}" install v1.0.0
  assert_failure 2
  assert_output --partial "restore"
}

@test "TP-15.22 (d2): an initialised pg/ with install.inprogress tag=v1.0.0 resumes without first setup and calls _upgrade-continue --first" {
  placeholder_ready_home
  mkdir -p "${BUDMON_HOME}/pg/pgdata"
  : >"${BUDMON_HOME}/pg/pgdata/PG_VERSION"
  printf 'tag=v1.0.0\n' >"${BUDMON_HOME}/install.inprogress"
  run "${SCRIPT}" install v1.0.0
  assert_success
  run grep -c "BUDMON_FIRST_SETUP" "${CALLS}"
  assert_output "0"
  run bash -c "awk -F'\t' '\$1==\"budmon-local\"' '${CALLS}'"
  assert_output --partial "_upgrade-continue v1.0.0 --no-dump --first"
}

@test "TP-15.22 (d3): resuming with another tag than the marker's exits 2" {
  mkdir -p "${BUDMON_HOME}/pg/pgdata"
  : >"${BUDMON_HOME}/pg/pgdata/PG_VERSION"
  printf 'tag=v1.0.0\n' >"${BUDMON_HOME}/install.inprogress"
  run "${SCRIPT}" install v1.0.1
  assert_failure 2
}

@test "TP-15.22 (e): a failing permission probe for main/api exits 21 naming secrets/main/api" {
  placeholder_ready_home
  export PROBE_FAIL_DIR="${BUDMON_HOME}/secrets/main/api"
  run "${SCRIPT}" install v1.0.0
  assert_failure 21
  assert_output --partial "secrets/main/api"
}

@test "TP-15.22 (e): maintenance on creates the flag, status reports on, off removes it" {
  write_state v1.0.0 ""
  make_release v1.0.0
  mkdir -p "${BUDMON_HOME}/maintenance"
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" maintenance on
  assert_success
  assert [ -f "${BUDMON_HOME}/maintenance/on" ]
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" maintenance status
  assert_success
  assert_output --partial "on"
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" maintenance off
  assert_success
  refute [ -e "${BUDMON_HOME}/maintenance/on" ]
}
