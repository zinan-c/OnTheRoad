#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PROFILE_FILE="${REPO_ROOT}/config/profiles/dev.env"
STACK_FILE="${REPO_ROOT}/infra/local-stack.env"
E2E_DATABASE_NAME="on_the_road_playwright_e2e"
E2E_WRITE_TOKEN="${OTR_E2E_WRITE_TOKEN:-e2e-local-write-token-change-per-run-123456}"
E2E_USERNAME="${OTR_E2E_USERNAME:-e2e_playwright}"
E2E_PASSWORD="${OTR_E2E_PASSWORD:-E2e_Playwright_1234!}"

if [[ ! -f "${PROFILE_FILE}" ]]; then
  echo "Missing ${PROFILE_FILE}; run pnpm run dev:prepare once before the browser suite." >&2
  exit 2
fi

# shellcheck disable=SC1090
source "${STACK_FILE}"
export PGPASSWORD="${POSTGRES_PASSWORD}"

# Keep browser acceptance self-contained instead of relying on a developer's
# separately running dependency stack. Project ownership checks make this
# idempotently reuse healthy services and refuse unrelated port owners.
bash "${SCRIPT_DIR}/dev-up.sh" --track native

dropdb --if-exists --force --host "${POSTGRES_HOST}" --port "${POSTGRES_PORT}" --username "${POSTGRES_USER}" "${E2E_DATABASE_NAME}"
createdb --host "${POSTGRES_HOST}" --port "${POSTGRES_PORT}" --username "${POSTGRES_USER}" "${E2E_DATABASE_NAME}"
E2E_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${E2E_DATABASE_NAME}"
psql "${E2E_DATABASE_URL}" --set ON_ERROR_STOP=1 --command "CREATE EXTENSION IF NOT EXISTS postgis"
env OTR_ENV_DATABASE_URL="${E2E_DATABASE_URL}" DATABASE_URL="${E2E_DATABASE_URL}" pnpm run db:migrate
env OTR_ENV_DATABASE_URL="${E2E_DATABASE_URL}" DATABASE_URL="${E2E_DATABASE_URL}" \
  OTR_BOOTSTRAP_ADMIN_USERNAME="${E2E_USERNAME}" \
  OTR_BOOTSTRAP_ADMIN_PASSWORD="${E2E_PASSWORD}" \
  OTR_BOOTSTRAP_ADMIN_FORCE_PASSWORD_CHANGE=false \
  pnpm run db:seed

export NEXT_PUBLIC_API_ORIGIN="http://127.0.0.1:3101"
export OTR_E2E_MODE=1
export OTR_E2E_WRITE_TOKEN="${E2E_WRITE_TOKEN}"
export OTR_E2E_USERNAME="${E2E_USERNAME}"
export OTR_E2E_PASSWORD="${E2E_PASSWORD}"
pnpm exec turbo run build --force \
  --filter=@on-the-road/api \
  --filter=@on-the-road/worker \
  --filter=@on-the-road/web

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do kill "${pid}" 2>/dev/null || true; done
  wait 2>/dev/null || true
  dropdb --if-exists --force --host "${POSTGRES_HOST}" --port "${POSTGRES_PORT}" --username "${POSTGRES_USER}" "${E2E_DATABASE_NAME}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bash "${SCRIPT_DIR}/run-profile.sh" dev -- env OTR_ENV_DATABASE_URL="${E2E_DATABASE_URL}" DATABASE_URL="${E2E_DATABASE_URL}" OTR_E2E_MODE=1 OTR_E2E_WRITE_TOKEN="${E2E_WRITE_TOKEN}" API_PORT=3101 APP_ORIGIN=http://127.0.0.1:3100 API_BASE_URL=http://127.0.0.1:3101/api/v1 pnpm run start:api & pids+=("$!")
bash "${SCRIPT_DIR}/run-profile.sh" dev -- env OTR_ENV_DATABASE_URL="${E2E_DATABASE_URL}" DATABASE_URL="${E2E_DATABASE_URL}" APP_ORIGIN=http://127.0.0.1:3100 API_BASE_URL=http://127.0.0.1:3101/api/v1 pnpm run start:worker & pids+=("$!")
bash "${SCRIPT_DIR}/run-profile.sh" dev -- env PORT=3100 WEB_PORT=3100 APP_ORIGIN=http://127.0.0.1:3100 API_BASE_URL=http://127.0.0.1:3101/api/v1 pnpm run start:web & pids+=("$!")
wait
