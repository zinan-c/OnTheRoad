#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"

stack_validate_runtime_dir
stack_load_env
stack_validate_env
mkdir -p "${STACK_RUNTIME_DIR}/mc"
chmod 700 "${STACK_RUNTIME_DIR}/mc"
export MC_CONFIG_DIR="${STACK_RUNTIME_DIR}/mc"

PSQL_CMD="$(stack_binary PSQL_BIN psql)"
REDIS_CLI_CMD="$(stack_binary REDIS_CLI_BIN redis-cli)"
MC_CMD="$(stack_binary MC_BIN mc)"
CLAMDSCAN_CMD="$(stack_binary CLAMDSCAN_BIN clamdscan)"

failed=0
check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "${name}: ready"
  else
    echo "${name}: not ready" >&2
    failed=1
  fi
}

postgres_ready() {
  PGPASSWORD="${POSTGRES_PASSWORD}" "${PSQL_CMD}" \
    -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" -tAc \
    "SELECT 1 FROM pg_extension WHERE extname='postgis'" |
    grep -qx '[[:space:]]*1[[:space:]]*'
}

redis_ready() {
  REDISCLI_AUTH="${REDIS_PASSWORD}" \
    "${REDIS_CLI_CMD}" -h "${REDIS_HOST}" -p "${REDIS_PORT}" \
    --no-auth-warning ping |
    grep -qx 'PONG'
}

minio_ready() {
  local probe="a02-health-$PPID-$$"
  local payload="on-the-road-native-health"
  "${MC_CMD}" alias set otr-native "http://${MINIO_HOST}:${MINIO_API_PORT}" \
    "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null
  printf '%s' "${payload}" |
    "${MC_CMD}" pipe "otr-native/${MINIO_BUCKET}/${probe}" >/dev/null
  [[ "$("${MC_CMD}" cat "otr-native/${MINIO_BUCKET}/${probe}")" == "${payload}" ]]
  "${MC_CMD}" rm "otr-native/${MINIO_BUCKET}/${probe}" >/dev/null
}

clamav_ready() {
  "${CLAMDSCAN_CMD}" --config-file="${STACK_RUNTIME_DIR}/clamav/clamd.conf" \
    --ping=1
}

check postgres postgres_ready
check redis redis_ready
check minio minio_ready
check clamav clamav_ready

if [[ "${failed}" -ne 0 ]]; then
  echo "Native Track readiness failed; media processing must remain fail-closed." >&2
  exit 1
fi

echo "Local stack: Native Ready"
