#!/usr/bin/env bash
set -euo pipefail

STACK_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STACK_REPO_ROOT="$(cd -- "${STACK_SCRIPT_DIR}/.." && pwd)"
STACK_ENV_FILE="${OTR_LOCAL_STACK_ENV:-${STACK_REPO_ROOT}/infra/local-stack.env}"
STACK_ENV_EXAMPLE="${STACK_REPO_ROOT}/infra/local-stack.env.example"
STACK_RUNTIME_DIR="${OTR_NATIVE_RUNTIME_DIR:-${STACK_REPO_ROOT}/infra/native/.runtime}"

stack_validate_runtime_dir() {
  local parent base canonical_parent canonical_runtime
  if [[ "${STACK_RUNTIME_DIR}" != /* ]]; then
    echo "Native runtime directory must be an absolute path." >&2
    exit 2
  fi
  base="$(basename -- "${STACK_RUNTIME_DIR}")"
  if [[ "${base}" != "runtime" && "${base}" != ".runtime" ]]; then
    echo "Native runtime directory must end in /runtime or /.runtime." >&2
    exit 2
  fi
  parent="$(dirname -- "${STACK_RUNTIME_DIR}")"
  if [[ ! -d "${parent}" ]]; then
    echo "Native runtime parent does not exist: ${parent}" >&2
    exit 2
  fi
  canonical_parent="$(cd -P -- "${parent}" && pwd)"
  canonical_runtime="${canonical_parent}/${base}"
  if [[ -L "${STACK_RUNTIME_DIR}" ||
        "${canonical_runtime}" == "/" ||
        "${canonical_runtime}" == "${HOME}" ||
        "${canonical_runtime}" == "${STACK_REPO_ROOT}" ||
        "${canonical_runtime}" == "/tmp" ||
        "${canonical_runtime}" == "/private/tmp" ]]; then
    echo "Refusing unsafe native runtime directory: ${STACK_RUNTIME_DIR}" >&2
    exit 2
  fi
  STACK_RUNTIME_DIR="${canonical_runtime}"
  export STACK_RUNTIME_DIR
}

stack_create_env() {
  if [[ ! -f "${STACK_ENV_FILE}" ]]; then
    cp "${STACK_ENV_EXAMPLE}" "${STACK_ENV_FILE}"
    chmod 600 "${STACK_ENV_FILE}"
    echo "Created infra/local-stack.env from the local-only example."
  fi
}

stack_load_env() {
  if [[ ! -f "${STACK_ENV_FILE}" ]]; then
    echo "Local stack is not configured. Run: bash scripts/dev-up.sh --track native" >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1090
  source "${STACK_ENV_FILE}"
  set +a
}

stack_validate_env() {
  local variable value normalized port
  for variable in POSTGRES_PASSWORD REDIS_PASSWORD MINIO_ROOT_PASSWORD; do
    value="${!variable:-}"
    normalized="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
    if [[ -z "${value}" || "${normalized}" =~ ^(password|changeme|minioadmin|admin)$ ]]; then
      echo "Invalid ${variable}: set a non-default local credential in ${STACK_ENV_FILE}." >&2
      exit 2
    fi
  done
  for variable in POSTGRES_DB POSTGRES_USER POSTGRES_HOST POSTGRES_PORT \
    REDIS_HOST REDIS_PORT MINIO_ROOT_USER MINIO_BUCKET MINIO_HOST \
    MINIO_API_PORT MINIO_CONSOLE_PORT CLAMAV_HOST CLAMAV_PORT CLAMAV_REQUIRED; do
    if [[ -z "${!variable:-}" ]]; then
      echo "Missing ${variable} in ${STACK_ENV_FILE}." >&2
      exit 2
    fi
  done
  if [[ "${POSTGRES_HOST}" != "127.0.0.1" ||
        "${REDIS_HOST}" != "127.0.0.1" ||
        "${MINIO_HOST}" != "127.0.0.1" ||
        "${CLAMAV_HOST}" != "127.0.0.1" ]]; then
    echo "Native Track endpoints must bind to 127.0.0.1." >&2
    exit 2
  fi
  if [[ "${CLAMAV_REQUIRED}" != "true" ]]; then
    echo "Native Track requires CLAMAV_REQUIRED=true (fail-closed)." >&2
    exit 2
  fi
  for variable in POSTGRES_PORT REDIS_PORT MINIO_API_PORT \
    MINIO_CONSOLE_PORT CLAMAV_PORT; do
    port="${!variable}"
    if [[ ! "${port}" =~ ^[0-9]+$ || "${port}" -lt 1 || "${port}" -gt 65535 ]]; then
      echo "Invalid ${variable}: expected an integer from 1 through 65535." >&2
      exit 2
    fi
  done
  if [[ ! "${POSTGRES_DB}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ||
        ! "${POSTGRES_USER}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "POSTGRES_DB and POSTGRES_USER must be plain PostgreSQL identifiers." >&2
    exit 2
  fi
  if [[ ! "${MINIO_BUCKET}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
    echo "MINIO_BUCKET must be a valid 3-63 character S3 bucket name." >&2
    exit 2
  fi
}

stack_apply_database_schema() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required to apply the application database schema." >&2
    return 1
  fi
  (
    cd "${STACK_REPO_ROOT}"
    pnpm run db:migrate
    pnpm run db:seed
    pnpm run db:status -- --check
  )
}

stack_binary() {
  local variable="$1"
  local fallback="$2"
  local configured="${!variable:-}"
  if [[ -n "${configured}" ]]; then
    if [[ ! -x "${configured}" ]]; then
      echo "Required ${variable} is not executable: ${configured}" >&2
      return 1
    fi
    printf '%s\n' "${configured}"
    return
  fi
  command -v "${fallback}" 2>/dev/null || {
    echo "Missing native binary '${fallback}' (${variable}). Install it explicitly, then rerun; this script never installs software." >&2
    return 1
  }
}

stack_pid_file() {
  printf '%s/pids/%s.pid\n' "${STACK_RUNTIME_DIR}" "$1"
}

stack_read_owned_pid() {
  local service="$1"
  local fingerprint="$2"
  local pid_file pid recorded_fingerprint recorded_start command current_start
  pid_file="$(stack_pid_file "${service}")"
  [[ -f "${pid_file}" ]] || return 1
  {
    IFS= read -r pid
    IFS= read -r recorded_fingerprint
    IFS= read -r recorded_start
  } <"${pid_file}" || return 1
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
  if ! kill -0 "${pid}" 2>/dev/null; then
    rm -f "${pid_file}"
    return 1
  fi
  command="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  current_start="$(ps -p "${pid}" -o lstart= 2>/dev/null || true)"
  if [[ "${recorded_fingerprint}" != "${fingerprint}" ||
        "${recorded_start}" != "${current_start}" ||
        "${command}" != *"${fingerprint}"* ]]; then
    echo "Ignoring stale ${service} PID ${pid}: ownership fingerprint does not match ${fingerprint}." >&2
    rm -f "${pid_file}"
    return 1
  fi
  printf '%s\n' "${pid}"
}

stack_record_pid() {
  local service="$1"
  local pid="$2"
  local fingerprint="$3"
  local start
  start="$(ps -p "${pid}" -o lstart= 2>/dev/null || true)"
  if [[ -z "${start}" ]]; then
    echo "Cannot record ${service} PID ${pid}: process start time is unavailable." >&2
    return 1
  fi
  mkdir -p "${STACK_RUNTIME_DIR}/pids"
  umask 077
  printf '%s\n%s\n%s\n' "${pid}" "${fingerprint}" "${start}" \
    >"$(stack_pid_file "${service}")"
}

stack_assert_port_free() {
  local service="$1"
  local port="$2"
  if command -v lsof >/dev/null 2>&1 &&
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "${service} cannot start: 127.0.0.1:${port} is already in use. No process was terminated." >&2
    return 1
  fi
}

stack_wait_until() {
  local label="$1"
  shift
  local attempt
  for attempt in $(seq 1 60); do
    if "$@" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "Timed out waiting for ${label}; inspect ${STACK_RUNTIME_DIR}/logs." >&2
  return 1
}
