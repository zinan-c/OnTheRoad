#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
profile="${1:-dev}"
track="${2:-native}"
runtime_profile="${profile}"
[[ "${profile}" == "prod" ]] && runtime_profile="release"

bash "${SCRIPT_DIR}/prepare-environment.sh" "${profile}" "${track}"
profile_file="${REPO_ROOT}/config/profiles/${profile}.env"
if [[ -f "${profile_file}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${profile_file}"
  set +a
fi
DATABASE_URL="${OTR_ENV_DATABASE_URL:-${DATABASE_URL:-}}"
REDIS_URL="${OTR_ENV_REDIS_URL:-${REDIS_URL:-}}"
OBJECT_STORAGE_ENDPOINT="${OTR_ENV_OBJECT_STORAGE_ENDPOINT:-${OBJECT_STORAGE_ENDPOINT:-}}"
OBJECT_STORAGE_ACCESS_KEY="${OTR_ENV_OBJECT_STORAGE_ACCESS_KEY:-${OBJECT_STORAGE_ACCESS_KEY:-}}"
OBJECT_STORAGE_SECRET_KEY="${OTR_ENV_OBJECT_STORAGE_SECRET_KEY:-${OBJECT_STORAGE_SECRET_KEY:-}}"
OBJECT_STORAGE_BUCKET="${OTR_ENV_OBJECT_STORAGE_BUCKET:-${OBJECT_STORAGE_BUCKET:-}}"
CLAMAV_HOST="${OTR_ENV_CLAMAV_HOST:-${CLAMAV_HOST:-}}"
CLAMAV_PORT="${OTR_ENV_CLAMAV_PORT:-${CLAMAV_PORT:-3310}}"
export DATABASE_URL REDIS_URL OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_ACCESS_KEY
export OBJECT_STORAGE_SECRET_KEY OBJECT_STORAGE_BUCKET CLAMAV_HOST CLAMAV_PORT
pnpm --filter @on-the-road/api build
pnpm --filter @on-the-road/worker build
pnpm --filter @on-the-road/web build

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do kill "${pid}" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bash "${SCRIPT_DIR}/run-profile.sh" "${runtime_profile}" -- pnpm run start:api & pids+=("$!")
bash "${SCRIPT_DIR}/run-profile.sh" "${runtime_profile}" -- pnpm run start:worker & pids+=("$!")
bash "${SCRIPT_DIR}/run-profile.sh" "${runtime_profile}" -- pnpm run start:web & pids+=("$!")

api_origin="${API_BASE_URL:-http://127.0.0.1:3001/api/v1}"
api_origin="${api_origin%/api/v1}"
web_origin="${APP_ORIGIN:-http://127.0.0.1:3000}"
for attempt in $(seq 1 60); do
  api_ok=false
  web_ok=false
  worker_ok=false
  curl -fsS "${api_origin}/health/ready" >/dev/null 2>&1 && api_ok=true
  curl -fsS "${web_origin}/" >/dev/null 2>&1 && web_ok=true
  if [[ -n "${REDIS_URL:-}" ]] && redis-cli -u "${REDIS_URL}" --scan --pattern 'otr:worker:heartbeat:*' 2>/dev/null | grep -q .; then worker_ok=true; fi
  if [[ "${api_ok}" == true && "${web_ok}" == true && "${worker_ok}" == true ]]; then
    echo "${profile} environment ready: API, Web and Worker heartbeat passed."
    wait
  fi
  sleep 1
done
echo "Environment startup timed out; inspect the child process logs." >&2
exit 1
