#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"
ENV_FILE="${STACK_ENV_FILE}"
COMPOSE_FILE="${STACK_REPO_ROOT}/infra/compose/docker-compose.yml"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Compose Track is not configured; nothing to stop."
  exit 0
fi

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" stop
echo "Compose Track stopped; named volumes were preserved."
