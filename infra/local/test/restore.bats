#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 `restore`. TP-15.22 (f) to (h7), stub part.
#
# docker is a stub; SQL sent to psql (in arguments or on stdin) is appended to $CALLS as a line
# starting `sql<TAB>`, so ordering against other calls is kept. Behaviour per case:
#   LIST_EXIT / LIST_OUTPUT  `pg_restore --list` (default: lists TABLE public and TABLE pgboss)
#   SAFETY_EXIT              the safety pg_dump (default 0)
#   VERIFY_EXIT              `cli.js restore:verify` (default 0)
#   READY_EXIT               readiness checks (default 0)
#   RENAME_FAILS             how many RENAME statements fail before one succeeds (default 0)
#   DB_SIZE                  pg_database_size('budmon') in bytes (default 1000)
#   DF_AVAIL_BYTES           free space reported by df (default 10^12)
#
# Assumed (see the S-15 questions): free space comes from `df` (any of -B1/-k/-m/--output=avail) and
# the database size from psql's output.

load helpers

DUMP_NAME="20261001T120000Z_v1.1.0.dump"

setup() {
  common_setup
  write_state v1.2.0 v1.1.0
  make_release v1.1.0
  make_release v1.2.0
  mkdir -p "${BUDMON_HOME}/dumps" "${BUDMON_HOME}/maintenance" "${BUDMON_HOME}/pg"
  printf 'PGDMP-fake-dump-content' >"${BUDMON_HOME}/dumps/${DUMP_NAME}"
  chmod 0600 "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  : >"${BUDMON_HOME}/rename-count"
  cat >"${STUB_CONFIG}" <<'CONF'
stub_git() {
  local args=("$@")
  while [ "${args[0]:-}" = "-C" ]; do args=("${args[@]:2}"); done
  case "${args[0]:-}" in
    rev-parse) echo "0000000000000000000000000000000000000000" ;;
    tag) echo "v1.1.0" ;;
  esac
  return 0
}
stub_df() {
  local avail="${DF_AVAIL_BYTES:-1000000000000}" unit=1 a
  for a in "$@"; do
    case "${a}" in -B1) unit=1 ;; -k|-Pk|-kP) unit=1024 ;; -m) unit=1048576 ;; -B*) unit="${a#-B}" ;; esac
  done
  echo "Filesystem 1-blocks Used Available Use% Mounted on"
  echo "/dev/x $((avail / unit)) 0 $((avail / unit)) 0% /"
}
stub_docker() {
  local all="$*"
  if [[ "${all}" == *"psql"* ]]; then
    local sql="${all}"
    if [ ! -t 0 ]; then sql="${sql} $(cat)"; fi
    printf 'sql\t%s\n' "${sql//$'\n'/ }" >>"${CALLS}"
    if [[ "${sql}" == *"pg_database_size"* ]]; then echo "${DB_SIZE:-1000}"; fi
    if [[ "${sql}" == *"RENAME TO"* ]]; then
      local n; n="$(wc -c <"${BUDMON_HOME}/rename-count")"
      if [ "${n}" -lt "${RENAME_FAILS:-0}" ]; then
        printf 'x' >>"${BUDMON_HOME}/rename-count"
        echo 'ERROR:  database "budmon" is being accessed by other users' >&2
        return 1
      fi
    fi
    return 0
  fi
  if [[ "${all}" == *"pg_restore"*"--list"* ]]; then
    cat >/dev/null
    if [ -n "${LIST_OUTPUT+x}" ]; then printf '%s\n' "${LIST_OUTPUT}"; else
      printf '%s\n' "215; 1259 16390 TABLE public currencies budmon_migrator" "216; 1259 16400 TABLE pgboss job budmon_queue"
    fi
    return "${LIST_EXIT:-0}"
  fi
  if [[ "${all}" == *"pg_dump"* ]]; then printf 'PGDMP-safety'; return "${SAFETY_EXIT:-0}"; fi
  if [[ "${all}" == *"restore:verify"* ]]; then echo '{"ok":true}'; return "${VERIFY_EXIT:-0}"; fi
  if [[ "${all}" == *"healthcheck"* || "${all}" == *"pg_isready"* ]]; then
    [[ "${all}" == *"pg_isready"* ]] && return 0
    return "${READY_EXIT:-0}"
  fi
  return 0
}
CONF
}

run_restore() {
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "$@"
}

# The ordered events of a restore, as short names.
events() {
  awk -F'\t' '
    $1=="docker" && $3 ~ /pg_restore/ && $3 ~ /--list/ { print "list"; next }
    $1=="docker" && $3 ~ /pg_dump/ { print "safety-dump"; next }
    $1=="sql" && $2 ~ /CREATE DATABASE budmon_restore/ { print "create-restore-db" }
    $1=="docker" && $3 ~ /pg_restore/ && $3 ~ /budmon_restore/ { print "pg_restore"; next }
    $1=="docker" && $3 ~ /migrate/ && $3 ~ /budmon_restore/ && $3 !~ /restore:verify/ { print "migrate"; next }
    $1=="docker" && $3 ~ /restore:verify/ { print "verify"; next }
    $1=="docker" && $3 ~ / stop / { print "stop"; next }
    $1=="sql" && $2 ~ /RENAME TO budmon_old_/ { print "rename-old" }
    $1=="sql" && $2 ~ /budmon_restore RENAME TO budmon[^_]/ { print "rename-new" }
    $1=="sql" && $2 ~ /budmon_restore RENAME TO budmon$/ { print "rename-new" }
    $1=="docker" && $3 ~ / up -d/ { print "up" }
  ' "${CALLS}" | uniq
}

@test "TP-15.22 (f): restore of a v1.1.0 dump: list, safety dump, budmon_restore restored and migrated and verified, then the switch, up with releases/v1.1.0, state current=v1.1.0, exit 0" {
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_success

  run events
  local seq; seq="$(printf '%s' "${output}" | tr '\n' ' ')"
  [[ "${seq}" == "list safety-dump create-restore-db pg_restore migrate verify stop "* ]] || { echo "${seq}"; return 1; }
  [[ "${seq}" == *"rename-old rename-new"*"up"* ]] || { echo "${seq}"; return 1; }

  local safety; safety="$(find "${BUDMON_HOME}/dumps" -name '*_v1.2.0_pre-restore.dump')"
  [[ "$(basename "${safety}")" =~ ^[0-9]{8}T[0-9]{6}Z_v1\.2\.0_pre-restore\.dump$ ]]
  [ "$(stat -c '%a' "${safety}")" = "600" ]

  run bash -c "awk -F'\t' '\$1==\"docker\" && (\$3 ~ /restore:verify/ || (\$3 ~ /migrate/ && \$3 ~ /run/))' '${CALLS}'"
  assert_output --partial "DB_NAME=budmon_restore"
  assert_output --partial "releases/v1.1.0/"

  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / up -d/' '${CALLS}'"
  assert_output --partial "releases/v1.1.0/compose.main.yaml"
  assert_output --partial "TAG=v1.1.0"
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.1.0"
  assert_line "previous=v1.2.0"
  refute [ -e "${BUDMON_HOME}/maintenance/on" ]
}

@test "TP-15.22 (f): the switch blocks connections before terminating, and re-opens the new budmon" {
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_success
  run bash -c "awk -F'\t' '\$1==\"sql\" { print \$2 }' '${CALLS}' | tr '\n' ' '"
  [[ "${output}" == *"ALLOW_CONNECTIONS false"*"pg_terminate_backend"*"RENAME TO budmon_old_"*"ALLOW_CONNECTIONS true"* ]] || { echo "${output}"; return 1; }
}

@test "TP-15.22 (g): restore:verify failing exits 6 with no rename, no maintenance, state unchanged, and prints the safety dump path" {
  export VERIFY_EXIT=6
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 6
  assert_output --regexp "dumps/[0-9]{8}T[0-9]{6}Z_v1\.2\.0_pre-restore\.dump"
  run grep -c "RENAME TO" "${CALLS}"
  assert_output "0"
  refute [ -e "${BUDMON_HOME}/maintenance/on" ]
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
}

@test "TP-15.22 (g2): a readiness timeout reverses the renames (budmon_restore_failed_<ts>), starts v1.2.0 again, keeps maintenance on, exit 16" {
  export READY_EXIT=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 16
  run bash -c "awk -F'\t' '\$1==\"sql\"' '${CALLS}'"
  assert_output --regexp "RENAME TO budmon_restore_failed_[0-9]{8}T[0-9]{6}Z"
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / up -d/' '${CALLS}' | tail -n 1"
  assert_output --partial "releases/v1.2.0/"
  assert [ -e "${BUDMON_HOME}/maintenance/on" ]
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
}

@test "TP-15.22 (h): restore foo.dump exits 12" {
  printf 'x' >"${BUDMON_HOME}/dumps/foo.dump"
  run_restore "${BUDMON_HOME}/dumps/foo.dump"
  assert_failure 12
}

@test "TP-15.22 (h2): a dump whose pg_restore --list fails exits 14 before any database call" {
  export LIST_EXIT=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 14
  run grep -c "^sql" "${CALLS}"
  assert_output "0"
}

@test "TP-15.22 (h3): a dump listing no pgboss table exits 14 before any database call" {
  export LIST_OUTPUT="215; 1259 16390 TABLE public currencies budmon_migrator"
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 14
  run grep -c "^sql" "${CALLS}"
  assert_output "0"
}

@test "TP-15.22 (h4): a failing safety pg_dump exits 19 with no database created" {
  export SAFETY_EXIT=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 19
  run grep -c "CREATE DATABASE" "${CALLS}"
  assert_output "0"
}

@test "TP-15.22 (h5): free space below 3 × the dump size + the database size exits 23 with both sizes and no database created" {
  export DB_SIZE=$((500 * 1024 * 1024)) DF_AVAIL_BYTES=$((100 * 1024 * 1024))
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 23
  assert_output --regexp "not enough disk space: need [0-9]+ MB, have [0-9]+ MB"
  run grep -c "CREATE DATABASE" "${CALLS}"
  assert_output "0"
}

@test "TP-15.22 (h6): the first rename failing twice then succeeding: ALLOW_CONNECTIONS false before terminating, three attempts, ALLOW_CONNECTIONS true on the new budmon, exit 0" {
  export RENAME_FAILS=2
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_success
  [ "$(grep -c 'RENAME TO budmon_old_' "${CALLS}")" -eq 3 ]
  [ "$(grep -c 'pg_terminate_backend' "${CALLS}")" -ge 3 ]
  run bash -c "awk -F'\t' '\$1==\"sql\" { print \$2 }' '${CALLS}' | tr '\n' ' '"
  [[ "${output}" == *"ALLOW_CONNECTIONS false"*"pg_terminate_backend"* ]] || { echo "${output}"; return 1; }
  [[ "${output}" == *"ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true"* ]] || { echo "${output}"; return 1; }
}

@test "TP-15.22 (h7): the rename failing 3 times exits 24 with names unchanged and ALLOW_CONNECTIONS true on budmon" {
  export RENAME_FAILS=99
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 24
  run grep -c "budmon_restore RENAME TO budmon" "${CALLS}"
  assert_output "0"
  run bash -c "awk -F'\t' '\$1==\"sql\" { print \$2 }' '${CALLS}' | tail -n 3 | tr '\n' ' '"
  [[ "${output}" == *"ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true"* ]] || { echo "${output}"; return 1; }
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
}
