#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"
profile="${1:-dev}"
if [[ "$#" -gt 0 ]]; then
  shift
fi
if [[ "${1:-}" == "--" ]]; then
  shift
fi
track="native"
track_argument="${1:-}"
case "${track_argument}" in
  ""|native|-native|--native)
    track="native"
    ;;
  # Keep the requested misspelling as an alias while documenting -compose.
  compose|componse|-compose|--compose|-componse|--componse)
    track="compose"
    ;;
  --track)
    if [[ "$#" -lt 2 ]]; then
      echo "Usage: bash scripts/run-environment.sh [dev|qa|prod] [-native|-compose]" >&2
      exit 2
    fi
    track="${2}"
    if [[ "${track}" != "native" && "${track}" != "compose" ]]; then
      echo "Track must be native or compose." >&2
      exit 2
    fi
    shift
    ;;
  *)
    echo "Usage: bash scripts/run-environment.sh [dev|qa|prod] [-native|-compose]" >&2
    exit 2
    ;;
esac
if [[ "$#" -gt 0 ]]; then
  shift
fi
if [[ "$#" -gt 0 ]]; then
  echo "Usage: bash scripts/run-environment.sh [dev|qa|prod] [-native|-compose]" >&2
  exit 2
fi
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

port_is_available() {
  node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.unref();
    server.once("error", () => process.exit(1));
    server.listen(Number(process.argv[1]), "0.0.0.0", () => {
      server.close(() => process.exit(0));
    });
  ' "$1"
}

select_dev_ports() {
  local preferred_web="${OTR_DEV_WEB_PORT:-18100}"
  local preferred_api="${OTR_DEV_API_PORT:-18101}"
  local offset candidate_web candidate_api
  if [[ ! "${preferred_web}" =~ ^[0-9]+$ || ! "${preferred_api}" =~ ^[0-9]+$ ||
        "${preferred_web}" -lt 1024 || "${preferred_api}" -lt 1024 ||
        "${preferred_web}" -gt 65000 || "${preferred_api}" -gt 65000 ]]; then
    echo "OTR_DEV_WEB_PORT and OTR_DEV_API_PORT must be available ports from 1024 through 65000." >&2
    exit 2
  fi
  for offset in $(seq 0 99); do
    candidate_web=$((preferred_web + offset * 10))
    candidate_api=$((preferred_api + offset * 10))
    if [[ "${candidate_web}" -gt 65535 || "${candidate_api}" -gt 65535 ]]; then
      break
    fi
    if port_is_available "${candidate_web}" && port_is_available "${candidate_api}"; then
      WEB_PORT="${candidate_web}"
      API_PORT="${candidate_api}"
      PORT="${WEB_PORT}"
      APP_ORIGIN="http://127.0.0.1:${WEB_PORT}"
      API_BASE_URL="http://127.0.0.1:${API_PORT}/api/v1"
      NEXT_PUBLIC_API_ORIGIN="http://127.0.0.1:${API_PORT}"
      export WEB_PORT API_PORT PORT APP_ORIGIN API_BASE_URL NEXT_PUBLIC_API_ORIGIN
      echo "Development endpoints selected: Web ${APP_ORIGIN}; API ${API_BASE_URL}"
      return
    fi
  done
  echo "Unable to reserve a free Web/API port pair near ${preferred_web}/${preferred_api}." >&2
  exit 1
}

if [[ "${profile}" == "dev" ]]; then
  select_dev_ports
fi

application_environment=()
if [[ "${profile}" == "dev" ]]; then
  application_environment=(
    env
    "WEB_PORT=${WEB_PORT}"
    "PORT=${PORT}"
    "API_PORT=${API_PORT}"
    "APP_ORIGIN=${APP_ORIGIN}"
    "API_BASE_URL=${API_BASE_URL}"
    "NEXT_PUBLIC_API_ORIGIN=${NEXT_PUBLIC_API_ORIGIN}"
  )
fi

pnpm exec turbo run build \
  --filter=@on-the-road/api \
  --filter=@on-the-road/worker \
  --filter=@on-the-road/web

pids=()
child_names=()
child_services=()
cleanup() {
  local index pid pid_file recorded_pid
  for pid in "${pids[@]:-}"; do kill "${pid}" 2>/dev/null || true; done
  wait 2>/dev/null || true
  for index in "${!pids[@]}"; do
    pid_file="$(stack_pid_file "${child_services[${index}]}")"
    if [[ -f "${pid_file}" ]]; then
      IFS= read -r recorded_pid <"${pid_file}" || true
      if [[ "${recorded_pid}" == "${pids[${index}]}" ]]; then
        rm -f -- "${pid_file}"
      fi
    fi
  done
}
trap cleanup EXIT INT TERM

stack_validate_runtime_dir
mkdir -p "${STACK_RUNTIME_DIR}/pids"
bash "${SCRIPT_DIR}/run-profile.sh" "${runtime_profile}" -- "${application_environment[@]}" pnpm run start:api & application_pid="$!"; pids+=("${application_pid}"); child_names+=("API"); child_services+=("app-api")
stack_record_pid "app-api" "${application_pid}" "pnpm run start:api"
bash "${SCRIPT_DIR}/run-profile.sh" "${runtime_profile}" -- "${application_environment[@]}" pnpm run start:worker & application_pid="$!"; pids+=("${application_pid}"); child_names+=("Worker"); child_services+=("app-worker")
stack_record_pid "app-worker" "${application_pid}" "pnpm run start:worker"
bash "${SCRIPT_DIR}/run-profile.sh" "${runtime_profile}" -- "${application_environment[@]}" pnpm run start:web & application_pid="$!"; pids+=("${application_pid}"); child_names+=("Web"); child_services+=("app-web")
stack_record_pid "app-web" "${application_pid}" "pnpm run start:web"

assert_children_running() {
  local index status
  for index in "${!pids[@]}"; do
    if ! kill -0 "${pids[${index}]}" 2>/dev/null; then
      status=0
      wait "${pids[${index}]}" 2>/dev/null || status=$?
      echo "${child_names[${index}]} exited during startup (status ${status}); inspect its log above." >&2
      exit 1
    fi
  done
}

api_origin="${API_BASE_URL:-http://127.0.0.1:3001/api/v1}"
api_origin="${api_origin%/api/v1}"
web_origin="${APP_ORIGIN:-http://127.0.0.1:3000}"
for attempt in $(seq 1 60); do
  assert_children_running
  api_ok=false
  web_ok=false
  worker_ok=false
  curl -fsS "${api_origin}/health/ready" >/dev/null 2>&1 && api_ok=true
  curl -fsS "${web_origin}/" >/dev/null 2>&1 && web_ok=true
  if [[ -n "${REDIS_URL:-}" ]] && redis-cli -u "${REDIS_URL}" --scan --pattern 'otr:worker:heartbeat:*' 2>/dev/null | grep -q .; then worker_ok=true; fi
  if [[ "${api_ok}" == true && "${web_ok}" == true && "${worker_ok}" == true ]]; then
    assert_children_running
    echo "${profile} environment ready: API, Web and Worker heartbeat passed."
    echo "Access addresses (${track}):"
    echo "  Web: ${web_origin}/"
    echo "  API live: ${api_origin}/health/live"
    echo "  API ready: ${api_origin}/health/ready"
    echo "  API base: ${API_BASE_URL:-${api_origin}/api/v1}"
    wait
  fi
  sleep 1
done
echo "Environment startup timed out; inspect the child process logs." >&2
exit 1
