#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"

stack_validate_runtime_dir
stack_load_env
stack_validate_env

PG_CTL_CMD="$(stack_binary PG_CTL_BIN pg_ctl)"
failed=0

stop_signal_service() {
  local service="$1"
  local fingerprint="$2"
  local pid
  if ! pid="$(stack_read_owned_pid "${service}" "${fingerprint}")"; then
    echo "${service}: not managed"
    return
  fi
  kill -TERM "${pid}"
  local attempt
  for attempt in $(seq 1 30); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "$(stack_pid_file "${service}")"
      echo "${service}: stopped"
      return
    fi
    sleep 1
  done
  echo "${service}: did not stop after SIGTERM; no stronger signal was sent." >&2
  return 1
}

stop_signal_service clamav "${STACK_RUNTIME_DIR}/clamav/clamd.conf" || failed=1
stop_signal_service minio "${STACK_RUNTIME_DIR}/minio-data" || failed=1
stop_signal_service redis "${REDIS_HOST}:${REDIS_PORT}" || failed=1

if postgres_pid="$(stack_read_owned_pid postgres "${STACK_RUNTIME_DIR}/postgres")"; then
  if "${PG_CTL_CMD}" -D "${STACK_RUNTIME_DIR}/postgres" -m fast stop >/dev/null; then
    rm -f "$(stack_pid_file postgres)"
    echo "postgres: stopped"
  else
    echo "postgres: failed to stop" >&2
    failed=1
  fi
else
  echo "postgres: not managed"
fi

echo "Native Track stopped; project data was preserved."
exit "${failed}"
