#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-179 gcp-bootstrap.sh. TP-15.26.
#
# gcloud is a stub: `describe`/`list`/`get-iam-policy` calls exit 0 when EXISTING=1 and 1 otherwise;
# `kms keys versions get-public-key` prints a PEM; everything is recorded. budmon-local is a stub on
# PATH recording `secret set` calls with the length of their stdin only.

load helpers

GCP="${ROOT}/infra/local/gcp-bootstrap.sh"

setup() {
  common_setup
  cat >"${STUB_DIR}/budmon-local" <<'REC'
#!/usr/bin/env bash
len="$(cat | wc -c)"
printf 'budmon-local\t%s\tstdin=%s\n' "$*" "${len}" >>"${CALLS}"
exit 0
REC
  chmod +x "${STUB_DIR}/budmon-local"
  cat >"${STUB_CONFIG}" <<'CONF'
stub_gcloud() {
  local all="$*"
  case "${all}" in
    *get-public-key*) printf -- '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n'; return 0 ;;
    *" describe"*|*" list"*|*get-iam-policy*) [ "${EXISTING:-0}" = 1 ] && return 0 || return 1 ;;
  esac
  return 0
}
CONF
}

ready_home() {
  mkdir -p "${BUDMON_HOME}/secrets"
  : >"${BUDMON_HOME}/secrets/.initialised"
  printf 'PUBLIC_ORIGIN=https://l.t.ts.net\nCAPTURE_KEY_VERSION=__FILL_ME__\n' >"${BUDMON_HOME}/site.env"
}

creates() { awk -F'\t' '$1=="gcloud" && $3 ~ / create( |$)|add-iam-policy-binding|set-iam-policy/' "${CALLS}"; }

@test "TP-15.26 (a): without secrets/.initialised: exit 2, run budmon-local install <tag> first, no gcloud calls" {
  run "${GCP}" --project p
  assert_failure 2
  assert_output --partial "run budmon-local install <tag> first"
  run calls_of gcloud
  assert_output ""
}

@test "TP-15.26 (b): nothing existing: creates key ring, key (ASYMMETRIC_DECRYPT, RSA_DECRYPT_OAEP_3072_SHA256), service account, IAM on the key only, topic, subscription, audit config; three CAPTURE_PUBLIC_KEY writes; CAPTURE_KEY_VERSION in site.env" {
  ready_home
  run "${GCP}" --project p
  assert_success
  run creates
  assert_output --regexp "kms keyrings create budmon .*--location[= ]europe-west3"
  assert_output --regexp "kms keys create capture-credentials"
  assert_output --partial "asymmetric-decryption"
  assert_output --partial "rsa-decrypt-oaep-3072-sha256"
  assert_output --regexp "iam service-accounts create budmon-capture"
  assert_output --regexp "kms keys add-iam-policy-binding capture-credentials.*roles/cloudkms.cryptoKeyDecrypter"
  assert_output --regexp "pubsub topics create gmail-push"
  assert_output --regexp "pubsub subscriptions create gmail-push-capture"
  run bash -c "awk -F'\t' '\$1==\"gcloud\" && \$3 ~ /projects add-iam-policy-binding/ && \$3 ~ /cryptoKeyDecrypter/' '${CALLS}'"
  assert_output ""
  run calls_of budmon-local
  assert_output --partial "secret set main/api/CAPTURE_PUBLIC_KEY"
  assert_output --partial "secret set main/worker-general/CAPTURE_PUBLIC_KEY"
  assert_output --partial "secret set capture/worker-capture/CAPTURE_PUBLIC_KEY"
  run grep -c "CAPTURE_PUBLIC_KEY" "${CALLS}"
  assert_output "3"
  run cat "${BUDMON_HOME}/site.env"
  assert_line "CAPTURE_KEY_VERSION=projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/1"
}

@test "TP-15.26 (b): prints the keys create | secret set GCP_CREDENTIALS command and never runs keys create" {
  ready_home
  run "${GCP}" --project p
  assert_success
  assert_output --partial "gcloud iam service-accounts keys create /dev/stdout --iam-account=budmon-capture@p.iam.gserviceaccount.com | budmon-local secret set capture/worker-capture/GCP_CREDENTIALS"
  run bash -c "awk -F'\t' '\$1==\"gcloud\" && \$3 ~ /keys create/ && \$3 ~ /service-accounts/' '${CALLS}'"
  assert_output ""
}

@test "TP-15.26 (c): everything existing: no create calls, the same writes" {
  ready_home
  export EXISTING=1
  run "${GCP}" --project p
  assert_success
  run creates
  refute_output --regexp " create( |$)"
  run grep -c "CAPTURE_PUBLIC_KEY" "${CALLS}"
  assert_output "3"
  run cat "${BUDMON_HOME}/site.env"
  assert_line --partial "CAPTURE_KEY_VERSION=projects/p/"
}
