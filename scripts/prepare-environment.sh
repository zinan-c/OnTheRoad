#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
profile="${1:-dev}"
track="${2:-native}"

case "${profile}" in
  dev|qa|prod) ;;
  *) echo "Usage: bash scripts/prepare-environment.sh {dev|qa|prod} [native|compose]" >&2; exit 2 ;;
esac
case "${track}" in
  native|compose) ;;
  *) echo "Track must be native or compose." >&2; exit 2 ;;
esac

if [[ "${profile}" == "prod" ]]; then
  : "${OTR_ENV_DATABASE_URL:?OTR_ENV_DATABASE_URL is required for prod}"
  : "${OTR_ENV_REDIS_URL:?OTR_ENV_REDIS_URL is required for prod}"
  : "${OTR_ENV_OBJECT_STORAGE_ENDPOINT:?OTR_ENV_OBJECT_STORAGE_ENDPOINT is required for prod}"
  : "${OTR_ENV_OBJECT_STORAGE_ACCESS_KEY:?OTR_ENV_OBJECT_STORAGE_ACCESS_KEY is required for prod}"
  : "${OTR_ENV_OBJECT_STORAGE_SECRET_KEY:?OTR_ENV_OBJECT_STORAGE_SECRET_KEY is required for prod}"
  : "${OTR_ENV_OBJECT_STORAGE_BUCKET:?OTR_ENV_OBJECT_STORAGE_BUCKET is required for prod}"
  : "${OTR_ENV_CLAMAV_HOST:?OTR_ENV_CLAMAV_HOST is required for prod}"
  : "${OTR_ENV_CLAMAV_PORT:?OTR_ENV_CLAMAV_PORT is required for prod}"
  : "${OTR_ENV_SESSION_SECRET:?OTR_ENV_SESSION_SECRET is required for prod}"
  echo "Production prepare validates injected OTR_ENV_* only; it does not start services or write release.env."
  exit 0
fi

STACK_ENV_FILE="${OTR_LOCAL_STACK_ENV:-${REPO_ROOT}/infra/local-stack.env}"
if [[ ! -f "${STACK_ENV_FILE}" ]]; then
  echo "Missing ${STACK_ENV_FILE}; the dependency bootstrap creates it from infra/local-stack.env.example." >&2
fi
start_attempt=1
until bash "${SCRIPT_DIR}/dev-up.sh" --track "${track}"; do
  if [[ "${start_attempt}" -ge 3 ]]; then
    echo "Dependency startup failed after ${start_attempt} attempts; refusing to continue." >&2
    exit 5
  fi
  echo "Dependency startup attempt ${start_attempt} failed; retrying in 3 seconds." >&2
  start_attempt=$((start_attempt + 1))
  sleep 3
done

set -a
# shellcheck disable=SC1090
source "${STACK_ENV_FILE}"
set +a
export DATABASE_URL
export REDIS_URL
export OBJECT_STORAGE_ENDPOINT="${S3_ENDPOINT}"
export OBJECT_STORAGE_REGION="${S3_REGION}"
export OBJECT_STORAGE_ACCESS_KEY="${S3_ACCESS_KEY}"
export OBJECT_STORAGE_SECRET_KEY="${S3_SECRET_KEY}"
export OBJECT_STORAGE_BUCKET="${MINIO_BUCKET}"
export CLAMAV_HOST CLAMAV_PORT
export OTR_ENV_DATABASE_URL="${DATABASE_URL}"
export OTR_ENV_REDIS_URL="${REDIS_URL}"
export OTR_ENV_OBJECT_STORAGE_ENDPOINT="${OBJECT_STORAGE_ENDPOINT}"
export OTR_ENV_OBJECT_STORAGE_REGION="${OBJECT_STORAGE_REGION}"
export OTR_ENV_OBJECT_STORAGE_ACCESS_KEY="${OBJECT_STORAGE_ACCESS_KEY}"
export OTR_ENV_OBJECT_STORAGE_SECRET_KEY="${OBJECT_STORAGE_SECRET_KEY}"
export OTR_ENV_OBJECT_STORAGE_BUCKET="${OBJECT_STORAGE_BUCKET}"
export OTR_ENV_CLAMAV_HOST="${CLAMAV_HOST}"
export OTR_ENV_CLAMAV_PORT="${CLAMAV_PORT}"
export OTR_ENV_SESSION_SECRET="${OTR_ENV_SESSION_SECRET:-local-session-secret-change-me-32-bytes}"

bash -c 'set -euo pipefail; export DATABASE_URL; pnpm run db:migrate; pnpm run db:seed; pnpm run db:status -- --check'

profile_file="${REPO_ROOT}/config/profiles/${profile}.env"
temporary_file="${profile_file}.tmp.$$"
umask 077
mkdir -p "$(dirname -- "${profile_file}")"
cat >"${temporary_file}" <<EOF
OTR_RUNTIME_PROFILE=${profile}
NODE_ENV=development
OTR_ENV_DATABASE_URL=${OTR_ENV_DATABASE_URL}
OTR_ENV_REDIS_URL=${OTR_ENV_REDIS_URL}
OTR_ENV_OBJECT_STORAGE_ENDPOINT=${OTR_ENV_OBJECT_STORAGE_ENDPOINT}
OTR_ENV_OBJECT_STORAGE_REGION=${OTR_ENV_OBJECT_STORAGE_REGION}
OTR_ENV_OBJECT_STORAGE_ACCESS_KEY=${OTR_ENV_OBJECT_STORAGE_ACCESS_KEY}
OTR_ENV_OBJECT_STORAGE_SECRET_KEY=${OTR_ENV_OBJECT_STORAGE_SECRET_KEY}
OTR_ENV_OBJECT_STORAGE_BUCKET=${OTR_ENV_OBJECT_STORAGE_BUCKET}
OTR_ENV_CLAMAV_HOST=${OTR_ENV_CLAMAV_HOST}
OTR_ENV_CLAMAV_PORT=${OTR_ENV_CLAMAV_PORT}
OTR_ENV_SESSION_SECRET=${OTR_ENV_SESSION_SECRET}
EOF
mv -f -- "${temporary_file}" "${profile_file}"
echo "Environment prepared: ${profile_file}"
