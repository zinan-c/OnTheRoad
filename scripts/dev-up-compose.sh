#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"
COMPOSE_FILE="${STACK_REPO_ROOT}/infra/compose/docker-compose.yml"
ENV_FILE="${STACK_ENV_FILE}"
COMPOSE_WAIT_TIMEOUT_SECONDS="${OTR_COMPOSE_WAIT_TIMEOUT_SECONDS:-900}"

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

stack_create_env
stack_load_env
stack_validate_env

if [[ ! "${COMPOSE_WAIT_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "OTR_COMPOSE_WAIT_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "docker compose --env-file infra/local-stack.env -f infra/compose/docker-compose.yml up -d --wait --wait-timeout ${COMPOSE_WAIT_TIMEOUT_SECONDS} postgres redis minio clamav"
  echo "docker compose --env-file infra/local-stack.env -f infra/compose/docker-compose.yml run --rm minio-init"
  echo "pnpm run db:migrate && pnpm run db:seed && pnpm run db:status -- --check"
  echo "bash scripts/dev-up-health.sh --track compose"
  exit 0
fi

if [[ -n "${OTR_COMPOSE_PULL_POLICY:-}" ]]; then
  case "${OTR_COMPOSE_PULL_POLICY}" in
    always|missing|never) ;;
    *)
      echo "OTR_COMPOSE_PULL_POLICY must be always, missing or never." >&2
      exit 2
      ;;
  esac
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is missing. Install Docker Desktop or Docker Engine." >&2
  exit 3
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required, but 'docker compose' is unavailable." >&2
  exit 3
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not reachable. Start Docker before running this script." >&2
  exit 4
fi

compose_diagnostics() {
  local service
  echo "Compose service state:" >&2
  compose ps -a >&2 || true
  for service in postgres redis minio clamav; do
    echo "---- ${service} health ----" >&2
    compose ps "${service}" >&2 || true
    compose logs --no-color --tail 100 "${service}" >&2 || true
  done
}

echo "Starting PostGIS, Redis, MinIO, and ClamAV (Compose Track)..."
compose_up() {
  if [[ -n "${OTR_COMPOSE_PULL_POLICY:-}" ]]; then
    compose up -d --pull "${OTR_COMPOSE_PULL_POLICY}" \
      --wait --wait-timeout "${COMPOSE_WAIT_TIMEOUT_SECONDS}" \
      postgres redis minio clamav
  else
    compose up -d --wait --wait-timeout "${COMPOSE_WAIT_TIMEOUT_SECONDS}" \
      postgres redis minio clamav
  fi
}

if ! compose_up; then
  echo "Compose Track failed to become healthy within ${COMPOSE_WAIT_TIMEOUT_SECONDS}s." >&2
  compose_diagnostics
  echo "After resolving the reported service error, run:" >&2
  echo "  docker compose --env-file infra/local-stack.env -f infra/compose/docker-compose.yml ps" >&2
  exit 5
fi

echo "Ensuring the MinIO bucket exists..."
compose run --rm minio-init

"${SCRIPT_DIR}/dev-up-health.sh" --track compose
