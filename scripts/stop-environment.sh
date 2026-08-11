#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=local-stack-common.sh
source "${SCRIPT_DIR}/local-stack-common.sh"

track="${1:-native}"
case "${track}" in
  native|compose) ;;
  *) echo "Usage: bash scripts/stop-environment.sh [native|compose]" >&2; exit 2 ;;
esac

stack_validate_runtime_dir

collect_descendants() {
  local parent="$1"
  local child
  while IFS= read -r child; do
    [[ "${child}" =~ ^[0-9]+$ ]] || continue
    collect_descendants "${child}"
    application_descendants+=("${child}")
  done < <(pgrep -P "${parent}" 2>/dev/null || true)
}

stop_application() {
  local service="$1"
  local label="$2"
  local fingerprint="$3"
  local pid attempt
  if ! pid="$(stack_read_owned_pid "${service}" "${fingerprint}")"; then
    echo "${label}: not managed"
    return
  fi

  application_descendants=()
  collect_descendants "${pid}"
  if [[ "${#application_descendants[@]}" -gt 0 ]]; then
    kill -TERM "${application_descendants[@]}" 2>/dev/null || true
  fi
  kill -TERM "${pid}" 2>/dev/null || true
  for attempt in $(seq 1 30); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f -- "$(stack_pid_file "${service}")"
      echo "${label}: stopped"
      return
    fi
    sleep 0.2
  done
  echo "${label}: did not stop after SIGTERM; no stronger signal was sent." >&2
  return 1
}

failed=0
stop_application app-web Web "pnpm run start:web" || failed=1
stop_application app-worker Worker "pnpm run start:worker" || failed=1
stop_application app-api API "pnpm run start:api" || failed=1

if ! bash "${SCRIPT_DIR}/dev-down.sh" --track "${track}"; then
  failed=1
fi

if [[ "${failed}" -eq 0 ]]; then
  echo "OnTheRoad development environment stopped; project data was preserved."
else
  echo "Some OnTheRoad services could not be stopped; inspect the messages above." >&2
fi
exit "${failed}"
