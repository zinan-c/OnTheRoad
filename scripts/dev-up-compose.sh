#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"
COMPOSE_FILE="${STACK_REPO_ROOT}/infra/compose/docker-compose.yml"
ENV_FILE="${STACK_ENV_FILE}"

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

stack_create_env
stack_load_env
stack_validate_env

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "docker compose --env-file infra/local-stack.env -f infra/compose/docker-compose.yml up -d --wait postgres redis minio clamav"
  echo "docker compose --env-file infra/local-stack.env -f infra/compose/docker-compose.yml run --rm minio-init"
  echo "pnpm run db:migrate && pnpm run db:seed && pnpm run db:status -- --check"
  echo "bash scripts/dev-up-health.sh --track compose"
  exit 0
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

echo "Starting PostGIS, Redis, MinIO, and ClamAV (Compose Track)..."
if ! compose up -d --wait postgres redis minio clamav; then
  echo "Compose Track failed to become healthy. Check port conflicts and run:" >&2
  echo "  docker compose --env-file infra/local-stack.env -f infra/compose/docker-compose.yml ps" >&2
  exit 5
fi

echo "Ensuring the MinIO bucket exists..."
compose run --rm minio-init

stack_apply_database_schema
"${SCRIPT_DIR}/dev-up-health.sh" --track compose
