#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="test-results/local-m0-m4-required.json"
STACK_STARTED=0
API_PID=""
WORKER_PID=""
PDF_WORKER_PID=""
WEB_PID=""
LOCAL_CI_STACK_ENV=""
LOCAL_CI_COMPOSE_PROJECT=""

stop_runtime() {
  local runtime_pid="$1"
  if [[ -z "${runtime_pid}" ]]; then
    return
  fi
  kill "${runtime_pid}" 2>/dev/null || true
  wait "${runtime_pid}" 2>/dev/null || true
}

cleanup() {
  stop_runtime "${API_PID}"
  stop_runtime "${WORKER_PID}"
  stop_runtime "${PDF_WORKER_PID}"
  stop_runtime "${WEB_PID}"
  if [[ "${STACK_STARTED}" -eq 1 ]]; then
    docker compose \
      --env-file "${LOCAL_CI_STACK_ENV}" \
      -f "${REPO_ROOT}/infra/compose/docker-compose.yml" \
      -p "${LOCAL_CI_COMPOSE_PROJECT}" \
      down --volumes --remove-orphans
  fi
  if [[ -n "${LOCAL_CI_STACK_ENV}" ]]; then
    rm -f -- "${LOCAL_CI_STACK_ENV}"
  fi
}
trap cleanup EXIT

cd "${REPO_ROOT}"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Local CI requires a clean committed worktree so it validates the exact SHA that will be pushed." >&2
  echo "Commit or stash the current changes, then rerun: pnpm run ci:local" >&2
  exit 2
fi

echo "Validating local commit $(git rev-parse --short HEAD)..."
pnpm run toolchain:check
pnpm install --frozen-lockfile

for required_command in \
  docker minio mc psql redis-cli magick identify convert montage \
  pdffonts pdfinfo pdftoppm pdftotext; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Local CI prerequisite is missing from PATH: ${required_command}" >&2
    exit 3
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  echo "Local CI requires Docker Compose v2 ('docker compose')." >&2
  exit 3
fi
if ! docker info >/dev/null 2>&1; then
  echo "Local CI requires a running Docker daemon." >&2
  exit 3
fi
node -e '
  const { existsSync } = require("node:fs");
  const { chromium } = require("@playwright/test");
  if (!existsSync(chromium.executablePath())) {
    console.error("Local CI requires the matching Playwright Chromium: pnpm exec playwright install chromium");
    process.exit(3);
  }
'

echo "Running the same aggregate quality gate used by CI..."
pnpm run quality

echo "Initializing the required-case diagnostic report..."
OTR_REQUIRED_CASE_REPORT="${REPORT_PATH}" \
  node scripts/initialize-required-case-report.mjs

LOCAL_CI_STACK_ENV="$(mktemp "${TMPDIR:-/tmp}/otr-local-ci-stack.XXXXXX")"
source_stack_env="${OTR_LOCAL_STACK_ENV:-${REPO_ROOT}/infra/local-stack.env}"
if [[ ! -f "${source_stack_env}" ]]; then
  source_stack_env="${REPO_ROOT}/infra/local-stack.env.example"
fi
local_ci_database="on_the_road_e2e_local"
while IFS= read -r line || [[ -n "${line}" ]]; do
  case "${line}" in
    POSTGRES_DB=*) printf 'POSTGRES_DB=%s\n' "${local_ci_database}" ;;
    DATABASE_URL=*)
      source_database_url="${line#DATABASE_URL=}"
      local_ci_database_url="$(node -e '
        const url = new URL(process.argv[1]);
        url.pathname = `/${process.argv[2]}`;
        process.stdout.write(url.href);
      ' "${source_database_url}" "${local_ci_database}")"
      printf 'DATABASE_URL=%s\n' "${local_ci_database_url}"
      ;;
    *) printf '%s\n' "${line}" ;;
  esac
done < "${source_stack_env}" > "${LOCAL_CI_STACK_ENV}"
chmod 600 "${LOCAL_CI_STACK_ENV}"
export OTR_LOCAL_STACK_ENV="${LOCAL_CI_STACK_ENV}"
LOCAL_CI_COMPOSE_PROJECT="on-the-road-ci-$(git rev-parse --short HEAD)-$$"
export COMPOSE_PROJECT_NAME="${LOCAL_CI_COMPOSE_PROJECT}"

STACK_STARTED=1
export OTR_COMPOSE_PULL_POLICY="${OTR_COMPOSE_PULL_POLICY:-never}"
bash scripts/dev-up.sh --track compose

set -a
# shellcheck disable=SC1091
source "${OTR_LOCAL_STACK_ENV}"
set +a

: "${DATABASE_URL:?infra/local-stack.env must define DATABASE_URL}"
: "${REDIS_URL:?infra/local-stack.env must define REDIS_URL}"
export OTR_E2E_MODE="1"
export OTR_E2E_WRITE_TOKEN="${OTR_E2E_WRITE_TOKEN:-e2e-local-write-token-change-per-run-123456}"
export OTR_E2E_USERNAME="${OTR_E2E_USERNAME:-e2e_playwright}"
export OTR_E2E_PASSWORD="${OTR_E2E_PASSWORD:-E2e_Playwright_1234!}"
export OTR_BOOTSTRAP_ADMIN_USERNAME="${OTR_E2E_USERNAME}"
export OTR_BOOTSTRAP_ADMIN_PASSWORD="${OTR_E2E_PASSWORD}"
export OTR_BOOTSTRAP_ADMIN_FORCE_PASSWORD_CHANGE="false"

echo "Applying and verifying the unified database schema..."
pnpm run db:migrate
pnpm run db:seed
pnpm run db:status -- --check --json
OTR_DATABASE_MIGRATION_TEST_URL="${DATABASE_URL}" \
  pnpm --filter @on-the-road/database exec vitest run \
    test/migration-runner.spec.ts test/migration-runner.integration.spec.ts

export OTR_TRIP_DATABASE_URL="${DATABASE_URL}"
export OTR_M1_DATABASE_URL="${DATABASE_URL}"
export OTR_M1_REDIS_URL="${REDIS_URL}"
export OTR_B05_DATABASE_URL="${DATABASE_URL}"
export OTR_B07_DATABASE_URL="${DATABASE_URL}"
export OTR_C03_DATABASE_URL="${DATABASE_URL}"
export OTR_D01_DATABASE_URL="${DATABASE_URL}"
export OTR_D02_DATABASE_URL="${DATABASE_URL}"
export OTR_D04_DATABASE_URL="${DATABASE_URL}"
export OTR_E02_DATABASE_URL="${DATABASE_URL}"
export OTR_C07_DATABASE_URL="${DATABASE_URL}"
export OTR_E04_DATABASE_URL="${DATABASE_URL}"
export OTR_M3_DATABASE_URL="${DATABASE_URL}"
export OTR_SCHEMA_IMMUTABILITY_DATABASE_URL="${DATABASE_URL}"
export OTR_RUN_CLAMAV_INTEGRATION="1"
export OTR_REQUIRED_CASE_REPORT="${REPORT_PATH}"
export OTR_COMMIT_SHA="$(git rev-parse HEAD)"

echo "Starting M4 API, Worker, PDF Worker, and Web runtimes..."
pnpm exec turbo run build \
  --filter=@on-the-road/api \
  --filter=@on-the-road/worker \
  --filter=@on-the-road/pdf-worker \
  --filter=@on-the-road/web
bash scripts/run-profile.sh dev -- node apps/api/dist/main.js \
  > test-results/m4-api.log 2>&1 &
API_PID=$!
bash scripts/run-profile.sh dev -- node apps/worker/dist/main.js \
  > test-results/m4-worker.log 2>&1 &
WORKER_PID=$!
bash scripts/run-profile.sh dev -- node apps/pdf-worker/dist/main.js \
  > test-results/m4-pdf-worker.log 2>&1 &
PDF_WORKER_PID=$!
API_ORIGIN="$(bash scripts/run-profile.sh dev -- node -e \
  'process.stdout.write(new URL(process.env.API_BASE_URL).origin)')"
WEB_ORIGIN="$(bash scripts/run-profile.sh dev -- node -e \
  'process.stdout.write(new URL(process.env.APP_ORIGIN).origin)')"
WEB_PORT="$(bash scripts/run-profile.sh dev -- node -e '
  const url = new URL(process.env.APP_ORIGIN);
  process.stdout.write(url.port || (url.protocol === "https:" ? "443" : "80"));
')"
export NEXT_PUBLIC_API_ORIGIN="${API_ORIGIN}"
export OTR_PLAYWRIGHT_API_ORIGIN="${API_ORIGIN}"
export OTR_PLAYWRIGHT_WEB_ORIGIN="${WEB_ORIGIN}"
export OTR_PLAYWRIGHT_EXTERNAL_STACK="1"
export OTR_PRODUCT_E2E_JSON="test-results/local-product-e2e-results.json"
export OTR_PRODUCT_E2E_JUNIT="test-results/local-product-e2e-results.xml"
export OTR_PRODUCT_E2E_EVIDENCE="test-results/local-product-e2e-evidence.json"
print_runtime_diagnostics() {
  echo "Application runtime readiness response:"
  cat test-results/m4-readiness.json 2>/dev/null || true
  echo "API runtime log:"
  cat test-results/m4-api.log 2>/dev/null || true
  echo "Worker runtime log:"
  cat test-results/m4-worker.log 2>/dev/null || true
  echo "PDF Worker runtime log:"
  cat test-results/m4-pdf-worker.log 2>/dev/null || true
  echo "Web runtime log:"
  cat test-results/m4-web.log 2>/dev/null || true
  echo "Compose dependency health:"
  bash scripts/dev-up-health.sh --track compose || true
}
fail_if_runtime_exited() {
  local runtime_name="$1"
  local runtime_pid="$2"
  local runtime_status=0
  if ! kill -0 "${runtime_pid}" 2>/dev/null; then
    wait "${runtime_pid}" || runtime_status=$?
    echo "${runtime_name} application runtime exited before readiness (status ${runtime_status})." >&2
    print_runtime_diagnostics
    exit 1
  fi
}
echo "Compose dependencies ready; waiting for application runtimes..."
for attempt in $(seq 1 60); do
  fail_if_runtime_exited "API" "${API_PID}"
  fail_if_runtime_exited "Worker" "${WORKER_PID}"
  fail_if_runtime_exited "PDF Worker" "${PDF_WORKER_PID}"
  if curl --fail --silent "${API_ORIGIN}/health/ready" \
    > test-results/m4-readiness.json; then
    fail_if_runtime_exited "API" "${API_PID}"
    fail_if_runtime_exited "Worker" "${WORKER_PID}"
    fail_if_runtime_exited "PDF Worker" "${PDF_WORKER_PID}"
    if redis-cli -u "${REDIS_URL}" --scan --pattern 'otr:worker:heartbeat:*' 2>/dev/null | grep -q . \
      && redis-cli -u "${REDIS_URL}" --scan --pattern 'otr:pdf-worker:heartbeat:*' 2>/dev/null | grep -q .; then
      echo "Application runtimes ready: API, Worker, and PDF Worker heartbeat passed"
      break
    fi
  fi
  if [ "${attempt}" -eq 60 ]; then
    echo "Application runtime readiness timed out at ${API_ORIGIN}." >&2
    print_runtime_diagnostics
    exit 1
  fi
  sleep 1
done

echo "Running every required M0-M4 case without skips..."
OTR_LOCAL_STACK_ENV="" COMPOSE_PROJECT_NAME="" pnpm run test:cases:required
pnpm run test:cases:evidence

echo "Running the real PDF Worker queue round-trip smoke..."
if ! pnpm run test:pdf-worker-smoke > test-results/m4-pdf-worker-smoke.log 2>&1; then
  cat test-results/m4-pdf-worker-smoke.log
  exit 1
fi
cat test-results/m4-pdf-worker-smoke.log

echo "Starting Web runtime for the required product E2E suite..."
bash scripts/run-profile.sh dev -- env \
  PORT="${WEB_PORT}" \
  WEB_PORT="${WEB_PORT}" \
  APP_ORIGIN="${WEB_ORIGIN}" \
  API_BASE_URL="${API_ORIGIN}/api/v1" \
  NEXT_PUBLIC_API_ORIGIN="${API_ORIGIN}" \
  pnpm run start:web \
  > test-results/m4-web.log 2>&1 &
WEB_PID=$!
for attempt in $(seq 1 60); do
  fail_if_runtime_exited "Web" "${WEB_PID}"
  if curl --fail --silent "${WEB_ORIGIN}/" > test-results/m4-web-readiness.html; then
    echo "Web runtime ready: ${WEB_ORIGIN}"
    break
  fi
  if [ "${attempt}" -eq 60 ]; then
    echo "Web runtime readiness timed out at ${WEB_ORIGIN}." >&2
    print_runtime_diagnostics
    exit 1
  fi
  sleep 1
done

echo "Running the required 22-case product E2E suite..."
product_e2e_status=0
pnpm run test:e2e > test-results/local-product-e2e.log 2>&1 || product_e2e_status=$?
cat test-results/local-product-e2e.log
product_e2e_evidence_status=0
pnpm run test:e2e:evidence || product_e2e_evidence_status=$?
if [[ "${product_e2e_status}" -ne 0 || "${product_e2e_evidence_status}" -ne 0 ]]; then
  echo "Required product E2E did not produce passing 22/22 evidence." >&2
  exit 1
fi

echo "Running the clean-checkout smoke gate..."
pnpm run ci:smoke

git diff --exit-code
echo "Local push CI passed for $(git rev-parse --short HEAD)."
