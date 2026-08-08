#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
profile="${1:-}"
requested_profile_env="${OTR_RUNTIME_PROFILE:-}"
shift || true

case "${profile}" in
  dev|qa|release) ;;
  *)
    echo "Usage: bash scripts/run-profile.sh {dev|qa|release} -- command [args...]" >&2
    exit 2
    ;;
esac
if [[ "${1:-}" != "--" ]]; then
  echo "Expected '--' before the command." >&2
  exit 2
fi
shift
if [[ "$#" -eq 0 ]]; then
  echo "A command is required." >&2
  exit 2
fi

set -a
if [[ "${profile}" == "dev" && -f "${REPO_ROOT}/.env.example" ]]; then
  # Safe development defaults; local-stack.env and explicit .env override these.
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env.example"
fi
if [[ -f "${REPO_ROOT}/infra/local-stack.env" ]]; then
  # Native service defaults are useful for dev and qa. Explicit profile files
  # and .env values loaded below may override them.
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/infra/local-stack.env"
  # Map the selected stack into the canonical profile namespace here. Without
  # this step, OTR_ENV_* placeholders loaded from .env.example win over the
  # authenticated local-stack values in a clean checkout such as CI.
  if [[ "${profile}" == "dev" ]]; then
    OTR_ENV_DATABASE_URL="${DATABASE_URL}"
    OTR_ENV_REDIS_URL="${REDIS_URL}"
    OTR_ENV_OBJECT_STORAGE_ENDPOINT="${S3_ENDPOINT}"
    OTR_ENV_OBJECT_STORAGE_ACCESS_KEY="${S3_ACCESS_KEY}"
    OTR_ENV_OBJECT_STORAGE_SECRET_KEY="${S3_SECRET_KEY}"
    OTR_ENV_OBJECT_STORAGE_BUCKET="${MINIO_BUCKET}"
    OTR_ENV_OBJECT_STORAGE_REGION="${S3_REGION}"
    OTR_ENV_CLAMAV_HOST="${CLAMAV_HOST}"
    OTR_ENV_CLAMAV_PORT="${CLAMAV_PORT}"
  else
    # QA/release may be supplied by remote injected configuration. Use the
    # local stack only as a fallback so those explicit credentials keep their
    # precedence.
    OTR_ENV_DATABASE_URL="${OTR_ENV_DATABASE_URL:-${DATABASE_URL}}"
    OTR_ENV_REDIS_URL="${OTR_ENV_REDIS_URL:-${REDIS_URL}}"
    OTR_ENV_OBJECT_STORAGE_ENDPOINT="${OTR_ENV_OBJECT_STORAGE_ENDPOINT:-${S3_ENDPOINT}}"
    OTR_ENV_OBJECT_STORAGE_ACCESS_KEY="${OTR_ENV_OBJECT_STORAGE_ACCESS_KEY:-${S3_ACCESS_KEY}}"
    OTR_ENV_OBJECT_STORAGE_SECRET_KEY="${OTR_ENV_OBJECT_STORAGE_SECRET_KEY:-${S3_SECRET_KEY}}"
    OTR_ENV_OBJECT_STORAGE_BUCKET="${OTR_ENV_OBJECT_STORAGE_BUCKET:-${MINIO_BUCKET}}"
    OTR_ENV_OBJECT_STORAGE_REGION="${OTR_ENV_OBJECT_STORAGE_REGION:-${S3_REGION}}"
    OTR_ENV_CLAMAV_HOST="${OTR_ENV_CLAMAV_HOST:-${CLAMAV_HOST}}"
    OTR_ENV_CLAMAV_PORT="${OTR_ENV_CLAMAV_PORT:-${CLAMAV_PORT}}"
  fi
  export OTR_ENV_DATABASE_URL OTR_ENV_REDIS_URL
  export OTR_ENV_OBJECT_STORAGE_ENDPOINT OTR_ENV_OBJECT_STORAGE_ACCESS_KEY
  export OTR_ENV_OBJECT_STORAGE_SECRET_KEY OTR_ENV_OBJECT_STORAGE_BUCKET
  export OTR_ENV_OBJECT_STORAGE_REGION OTR_ENV_CLAMAV_HOST OTR_ENV_CLAMAV_PORT
fi
if [[ -f "${REPO_ROOT}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
fi
profile_file="${REPO_ROOT}/config/profiles/${profile}.env"
if [[ -f "${profile_file}" ]]; then
  # shellcheck disable=SC1090
  source "${profile_file}"
elif [[ "${profile}" != "dev" && "${requested_profile_env}" != "${profile}" ]]; then
  if [[ -z "${OTR_ENV_DATABASE_URL:-}" ]]; then
    echo "Missing ${profile_file} and no injected OTR_ENV_* release configuration was found." >&2
    exit 3
  fi
fi
set +a

# Application-facing connection values use an OTR_ENV_ prefix. Exporting the
# unprefixed aliases keeps existing database/worker harnesses compatible.
DATABASE_URL="${OTR_ENV_DATABASE_URL:-${DATABASE_URL:-}}"
REDIS_URL="${OTR_ENV_REDIS_URL:-${REDIS_URL:-}}"
OBJECT_STORAGE_ENDPOINT="${OTR_ENV_OBJECT_STORAGE_ENDPOINT:-${OBJECT_STORAGE_ENDPOINT:-}}"
OBJECT_STORAGE_ACCESS_KEY="${OTR_ENV_OBJECT_STORAGE_ACCESS_KEY:-${OBJECT_STORAGE_ACCESS_KEY:-}}"
OBJECT_STORAGE_SECRET_KEY="${OTR_ENV_OBJECT_STORAGE_SECRET_KEY:-${OBJECT_STORAGE_SECRET_KEY:-}}"
OBJECT_STORAGE_BUCKET="${OTR_ENV_OBJECT_STORAGE_BUCKET:-${OBJECT_STORAGE_BUCKET:-}}"
OBJECT_STORAGE_REGION="${OTR_ENV_OBJECT_STORAGE_REGION:-${OBJECT_STORAGE_REGION:-${S3_REGION:-us-east-1}}}"
CLAMAV_HOST="${OTR_ENV_CLAMAV_HOST:-${CLAMAV_HOST:-}}"
CLAMAV_PORT="${OTR_ENV_CLAMAV_PORT:-${CLAMAV_PORT:-3310}}"
SESSION_SECRET="${OTR_ENV_SESSION_SECRET:-${SESSION_SECRET:-}}"
export DATABASE_URL REDIS_URL OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_ACCESS_KEY
export OBJECT_STORAGE_SECRET_KEY OBJECT_STORAGE_BUCKET OBJECT_STORAGE_REGION
export CLAMAV_HOST CLAMAV_PORT SESSION_SECRET

export OTR_RUNTIME_PROFILE="${profile}"

if [[ "${profile}" == "qa" ]]; then
  for service in POSTGRES REDIS MINIO CLAMAV API WEB WORKER; do
    field="OTR_QA_${service}_MODE"
    mode="${!field:-native}"
    case "${mode}" in
      native|container|remote) ;;
      *) echo "${field} must be native, container or remote (got '${mode}')." >&2; exit 3 ;;
    esac
  done
fi

exec "$@"
