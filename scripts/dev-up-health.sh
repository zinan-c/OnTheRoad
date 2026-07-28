#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
track="native"
if [[ "${1:-}" == "--track" ]]; then
  track="${2:-}"
  shift 2
fi

case "${track}" in
  native) exec "${SCRIPT_DIR}/dev-up-native-health.sh" "$@" ;;
  compose) exec "${SCRIPT_DIR}/dev-up-compose-health.sh" "$@" ;;
  *)
    echo "Unknown local stack track '${track}'. Expected native or compose." >&2
    exit 2
    ;;
esac
