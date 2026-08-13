#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="test-results/local-m0-m3-required.json"
STACK_STARTED=0
API_PID=""
WORKER_PID=""

cleanup() {
  if [[ -n "${API_PID}" ]]; then
    kill "${API_PID}" 2>/dev/null || true
  fi
  if [[ -n "${WORKER_PID}" ]]; then
    kill "${WORKER_PID}" 2>/dev/null || true
  fi
  if [[ "${STACK_STARTED}" -eq 1 ]]; then
    bash "${SCRIPT_DIR}/dev-down.sh" --track compose
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

STACK_STARTED=1
bash scripts/dev-up.sh --track compose

set -a
# shellcheck disable=SC1091
source infra/local-stack.env
set +a

: "${DATABASE_URL:?infra/local-stack.env must define DATABASE_URL}"
: "${REDIS_URL:?infra/local-stack.env must define REDIS_URL}"

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

echo "Starting M3 API and Worker runtimes..."
pnpm exec turbo run build \
  --filter=@on-the-road/api \
  --filter=@on-the-road/worker
pnpm run profile:dev -- pnpm --filter @on-the-road/api start \
  > test-results/m3-api.log 2>&1 &
API_PID=$!
pnpm run profile:dev -- pnpm --filter @on-the-road/worker start \
  > test-results/m3-worker.log 2>&1 &
WORKER_PID=$!
API_ORIGIN="$(bash scripts/run-profile.sh dev -- node -e \
  'process.stdout.write(new URL(process.env.API_BASE_URL).origin)')"
WEB_ORIGIN="$(bash scripts/run-profile.sh dev -- node -e \
  'process.stdout.write(new URL(process.env.APP_ORIGIN).origin)')"
export NEXT_PUBLIC_API_ORIGIN="${API_ORIGIN}"
export OTR_PLAYWRIGHT_WEB_ORIGIN="${WEB_ORIGIN}"
print_runtime_diagnostics() {
  echo "Application runtime readiness response:"
  cat test-results/m3-readiness.json 2>/dev/null || true
  echo "API runtime log:"
  cat test-results/m3-api.log 2>/dev/null || true
  echo "Worker runtime log:"
  cat test-results/m3-worker.log 2>/dev/null || true
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
  if curl --fail --silent "${API_ORIGIN}/health/ready" \
    > test-results/m3-readiness.json; then
    fail_if_runtime_exited "API" "${API_PID}"
    fail_if_runtime_exited "Worker" "${WORKER_PID}"
    echo "Application runtimes ready: API and Worker are running"
    break
  fi
  if [ "${attempt}" -eq 60 ]; then
    echo "Application runtime readiness timed out at ${API_ORIGIN}." >&2
    print_runtime_diagnostics
    exit 1
  fi
  sleep 1
done

echo "Running every required M0-M3 case without skips..."
pnpm run test:cases:required
pnpm run test:cases:evidence

echo "Running the clean-checkout smoke gate..."
pnpm run ci:smoke

git diff --exit-code
echo "Local push CI passed for $(git rev-parse --short HEAD)."
