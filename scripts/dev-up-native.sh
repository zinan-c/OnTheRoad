#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"

stack_validate_runtime_dir
stack_create_env
stack_load_env
stack_validate_env

select_postgres_toolchain() {
  local current candidate shared
  if [[ -n "${POSTGRES_BIN:-}" || -n "${PG_CONFIG_BIN:-}" ]]; then
    return
  fi
  current="$(command -v postgres 2>/dev/null || true)"
  for candidate in \
    "${current:+$(dirname -- "${current}")}" \
    /opt/homebrew/opt/postgresql@17/bin \
    /opt/homebrew/opt/postgresql@18/bin \
    /usr/local/opt/postgresql@17/bin \
    /usr/local/opt/postgresql@18/bin; do
    [[ -n "${candidate}" && -x "${candidate}/pg_config" ]] || continue
    shared="$("${candidate}/pg_config" --sharedir 2>/dev/null || true)"
    if [[ -f "${shared}/extension/postgis.control" ]]; then
      POSTGRES_BIN="${candidate}/postgres"
      INITDB_BIN="${candidate}/initdb"
      PG_CTL_BIN="${candidate}/pg_ctl"
      PG_CONFIG_BIN="${candidate}/pg_config"
      CREATEDB_BIN="${candidate}/createdb"
      PSQL_BIN="${candidate}/psql"
      export POSTGRES_BIN INITDB_BIN PG_CTL_BIN PG_CONFIG_BIN CREATEDB_BIN PSQL_BIN
      return
    fi
  done
}

select_postgres_toolchain

preflight_failed=0
POSTGRES_CMD="$(stack_binary POSTGRES_BIN postgres)" || preflight_failed=1
INITDB_CMD="$(stack_binary INITDB_BIN initdb)" || preflight_failed=1
PG_CTL_CMD="$(stack_binary PG_CTL_BIN pg_ctl)" || preflight_failed=1
PG_CONFIG_CMD="$(stack_binary PG_CONFIG_BIN pg_config)" || preflight_failed=1
CREATEDB_CMD="$(stack_binary CREATEDB_BIN createdb)" || preflight_failed=1
PSQL_CMD="$(stack_binary PSQL_BIN psql)" || preflight_failed=1
REDIS_SERVER_CMD="$(stack_binary REDIS_SERVER_BIN redis-server)" ||
  preflight_failed=1
REDIS_CLI_CMD="$(stack_binary REDIS_CLI_BIN redis-cli)" || preflight_failed=1
MINIO_CMD="$(stack_binary MINIO_BIN minio)" || preflight_failed=1
MC_CMD="$(stack_binary MC_BIN mc)" || preflight_failed=1
CLAMD_CMD="$(stack_binary CLAMD_BIN clamd)" || preflight_failed=1
CLAMDSCAN_CMD="$(stack_binary CLAMDSCAN_BIN clamdscan)" || preflight_failed=1
CLAMSCAN_CMD="$(stack_binary CLAMSCAN_BIN clamscan)" || preflight_failed=1
if [[ "${preflight_failed}" -ne 0 ]]; then
  echo "Native Track preflight failed; no service was started." >&2
  exit 3
fi

postgres_major="$("${POSTGRES_CMD}" --version | sed -E 's/.* ([0-9]+).*/\1/')"
redis_major="$("${REDIS_SERVER_CMD}" --version | sed -E 's/.*v=([0-9]+).*/\1/')"
clamav_version="$("${CLAMSCAN_CMD}" --version | head -n 1)"
minio_version="$("${MINIO_CMD}" --version | head -n 1)"
mc_version="$("${MC_CMD}" --version | head -n 1)"
if [[ ! "${postgres_major}" =~ ^[0-9]+$ || "${postgres_major}" -lt 16 ]]; then
  echo "Incompatible PostgreSQL: detected $(${POSTGRES_CMD} --version); require major version 16 or newer." >&2
  exit 3
fi
if [[ ! "${redis_major}" =~ ^[0-9]+$ || "${redis_major}" -lt 7 ]]; then
  echo "Incompatible Redis: detected $(${REDIS_SERVER_CMD} --version); require major version 7 or newer." >&2
  exit 3
fi
clamav_major="$(printf '%s' "${clamav_version}" | sed -E 's/.* ([0-9]+)\.([0-9]+).*/\1/')"
clamav_minor="$(printf '%s' "${clamav_version}" | sed -E 's/.* ([0-9]+)\.([0-9]+).*/\2/')"
if [[ ! "${clamav_major}" =~ ^[0-9]+$ ||
      ! "${clamav_minor}" =~ ^[0-9]+$ ||
      "${clamav_major}" -lt 1 ||
      ( "${clamav_major}" -eq 1 && "${clamav_minor}" -lt 4 ) ]]; then
  echo "Incompatible ClamAV: detected ${clamav_version}; require version 1.4 or newer." >&2
  exit 3
fi
if [[ ! "${minio_version}" =~ RELEASE\.20[2-9][0-9]- ||
      ! "${mc_version}" =~ RELEASE\.20[2-9][0-9]- ]]; then
  echo "Unable to verify compatible MinIO server/client releases: ${minio_version}; ${mc_version}." >&2
  exit 3
fi

postgres_shared_dir="$("${PG_CONFIG_CMD}" --sharedir)"
if [[ ! -f "${postgres_shared_dir}/extension/postgis.control" ]]; then
  echo "PostGIS is not available for PostgreSQL ${postgres_major}: missing ${postgres_shared_dir}/extension/postgis.control. Install a matching PostGIS build explicitly." >&2
  exit 3
fi

effective_clamav_database_dir="${CLAMAV_DATABASE_DIR:-${STACK_RUNTIME_DIR}/clamav/signatures}"
if ! find "${effective_clamav_database_dir}" -type f \
  \( -name '*.cvd' -o -name '*.cld' -o -name '*.cud' \) -print -quit \
  2>/dev/null | grep -q .; then
  echo "ClamAV signatures are missing in ${effective_clamav_database_dir}. Prepare signatures explicitly; Native Track will not download them automatically." >&2
  exit 3
fi

echo "Native versions:"
echo "  $(${POSTGRES_CMD} --version)"
echo "  $(${REDIS_SERVER_CMD} --version)"
echo "  ${minio_version}"
echo "  ${mc_version}"
echo "  ${clamav_version}"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Native Track preflight passed; no service was started."
  exit 0
fi

mkdir -p "${STACK_RUNTIME_DIR}/"{clamav,logs,minio-data,pids,postgres,redis}

postgres_server_probe() {
  PGPASSWORD="${POSTGRES_PASSWORD}" "${PSQL_CMD}" \
    -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d postgres -tAc "SELECT 1" | grep -qx '[[:space:]]*1[[:space:]]*'
}

redis_probe() {
  REDISCLI_AUTH="${REDIS_PASSWORD}" \
    "${REDIS_CLI_CMD}" -h "${REDIS_HOST}" -p "${REDIS_PORT}" \
    --no-auth-warning ping | grep -qx 'PONG'
}

minio_probe() {
  "${MC_CMD}" alias set otr-native "http://${MINIO_HOST}:${MINIO_API_PORT}" \
    "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null &&
    "${MC_CMD}" ready otr-native >/dev/null
}

clamav_probe() {
  "${CLAMDSCAN_CMD}" --config-file="${STACK_RUNTIME_DIR}/clamav/clamd.conf" \
    --ping=1 >/dev/null
}

start_postgres() {
  local data_dir="${STACK_RUNTIME_DIR}/postgres"
  if stack_read_owned_pid postgres "${data_dir}" >/dev/null; then
    echo "postgres: already managed"
  else
    stack_assert_port_free postgres "${POSTGRES_PORT}"
    if [[ ! -f "${data_dir}/PG_VERSION" ]]; then
      local password_file="${STACK_RUNTIME_DIR}/postgres-password"
      umask 077
      printf '%s\n' "${POSTGRES_PASSWORD}" >"${password_file}"
      trap 'rm -f -- "${password_file}"' EXIT
      trap 'rm -f -- "${password_file}"; exit 130' INT TERM
      "${INITDB_CMD}" -D "${data_dir}" --username="${POSTGRES_USER}" \
        --pwfile="${password_file}" --auth-host=scram-sha-256 --auth-local=trust \
        >"${STACK_RUNTIME_DIR}/logs/postgres-init.log"
      rm -f "${password_file}"
      trap - EXIT INT TERM
    fi
    "${PG_CTL_CMD}" -D "${data_dir}" -l "${STACK_RUNTIME_DIR}/logs/postgres.log" \
      -o "-h ${POSTGRES_HOST} -p ${POSTGRES_PORT}" start >/dev/null
    stack_record_pid postgres "$(head -n 1 "${data_dir}/postmaster.pid")" "${data_dir}"
  fi
  stack_wait_until postgres postgres_server_probe
  if ! PGPASSWORD="${POSTGRES_PASSWORD}" "${PSQL_CMD}" \
    -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" |
    grep -qx '[[:space:]]*1[[:space:]]*'; then
    PGPASSWORD="${POSTGRES_PASSWORD}" "${CREATEDB_CMD}" \
      -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
      "${POSTGRES_DB}"
  fi
  PGPASSWORD="${POSTGRES_PASSWORD}" "${PSQL_CMD}" \
    -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 \
    -f "${STACK_REPO_ROOT}/infra/compose/init/postgres/001-postgis.sql" \
    >"${STACK_RUNTIME_DIR}/logs/postgis-init.log"
}

start_redis() {
  local data_dir="${STACK_RUNTIME_DIR}/redis"
  local config="${data_dir}/redis.conf"
  if stack_read_owned_pid redis "${REDIS_HOST}:${REDIS_PORT}" >/dev/null; then
    echo "redis: already managed"
    return
  fi
  stack_assert_port_free redis "${REDIS_PORT}"
  cat >"${config}" <<EOF
bind ${REDIS_HOST}
protected-mode yes
port ${REDIS_PORT}
dir ${data_dir}
pidfile ${data_dir}/redis.pid
logfile ${STACK_RUNTIME_DIR}/logs/redis.log
daemonize yes
appendonly yes
requirepass ${REDIS_PASSWORD}
EOF
  chmod 600 "${config}"
  "${REDIS_SERVER_CMD}" "${config}"
  stack_wait_until redis redis_probe
  stack_record_pid redis "$(cat "${data_dir}/redis.pid")" "${REDIS_HOST}:${REDIS_PORT}"
}

start_minio() {
  local data_dir="${STACK_RUNTIME_DIR}/minio-data"
  if stack_read_owned_pid minio "${data_dir}" >/dev/null; then
    echo "minio: already managed"
  else
    stack_assert_port_free minio "${MINIO_API_PORT}"
    stack_assert_port_free minio-console "${MINIO_CONSOLE_PORT}"
    MINIO_ROOT_USER="${MINIO_ROOT_USER}" \
      MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}" \
      "${MINIO_CMD}" server --address "${MINIO_HOST}:${MINIO_API_PORT}" \
      --console-address "${MINIO_HOST}:${MINIO_CONSOLE_PORT}" "${data_dir}" \
      >"${STACK_RUNTIME_DIR}/logs/minio.log" 2>&1 &
    stack_record_pid minio "$!" "${data_dir}"
  fi
  stack_wait_until minio minio_probe
  "${MC_CMD}" mb --ignore-existing "otr-native/${MINIO_BUCKET}" >/dev/null
  "${MC_CMD}" anonymous set none "otr-native/${MINIO_BUCKET}" >/dev/null
}

start_clamav() {
  local config="${STACK_RUNTIME_DIR}/clamav/clamd.conf"
  local database_dir="${effective_clamav_database_dir}"
  if stack_read_owned_pid clamav "${config}" >/dev/null; then
    echo "clamav: already managed"
    return
  fi
  stack_assert_port_free clamav "${CLAMAV_PORT}"
  mkdir -p "${database_dir}"
  if ! find "${database_dir}" -type f \
    \( -name '*.cvd' -o -name '*.cld' -o -name '*.cud' \) -print -quit |
    grep -q .; then
    echo "ClamAV signatures are missing in ${database_dir}. Prepare signatures explicitly; Native Track will not download them automatically." >&2
    return 1
  fi
  cat >"${config}" <<EOF
Foreground false
PidFile ${STACK_RUNTIME_DIR}/clamav/clamd.pid
LogFile ${STACK_RUNTIME_DIR}/logs/clamav.log
DatabaseDirectory ${database_dir}
TCPSocket ${CLAMAV_PORT}
TCPAddr ${CLAMAV_HOST}
EOF
  "${CLAMD_CMD}" --config-file="${config}"
  stack_record_pid clamav "$(cat "${STACK_RUNTIME_DIR}/clamav/clamd.pid")" "${config}"
  stack_wait_until clamav clamav_probe
}

mkdir -p "${STACK_RUNTIME_DIR}/mc"
chmod 700 "${STACK_RUNTIME_DIR}/mc"
export MC_CONFIG_DIR="${STACK_RUNTIME_DIR}/mc"

start_postgres
start_redis
start_minio
start_clamav
"${SCRIPT_DIR}/dev-up-native-health.sh"
