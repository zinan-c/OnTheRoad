#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"
COMPOSE_FILE="${STACK_REPO_ROOT}/infra/compose/docker-compose.yml"
ENV_FILE="${STACK_ENV_FILE}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Compose Track is not configured. Run: bash scripts/dev-up.sh --track compose" >&2
  exit 2
fi

stack_load_env
stack_validate_env

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

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
  compose exec -T postgres \
    psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc \
    "SELECT 1 FROM pg_extension WHERE extname='postgis'" |
    grep -qx '[[:space:]]*1[[:space:]]*'
}

redis_ready() {
  compose exec -T redis \
    redis-cli --no-auth-warning -a "${REDIS_PASSWORD}" ping |
    grep -qx 'PONG'
}

check postgres postgres_ready
check redis redis_ready
check minio compose run --rm --no-deps minio-init \
  "mc alias set local http://minio:9000 \"${MINIO_ROOT_USER}\" \"${MINIO_ROOT_PASSWORD}\" >/dev/null && mc stat \"local/${MINIO_BUCKET}\""
check clamav compose exec -T clamav clamdscan --ping 1 --wait 5

if [[ "${failed}" -ne 0 ]]; then
  echo "Compose Track readiness failed; media processing must remain fail-closed." >&2
  exit 1
fi

echo "Local stack: Compose Ready"
