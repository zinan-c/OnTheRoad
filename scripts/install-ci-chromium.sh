#!/usr/bin/env bash
set -euo pipefail

attempts="${OTR_PLAYWRIGHT_INSTALL_ATTEMPTS:-2}"
attempt_timeout="${OTR_PLAYWRIGHT_INSTALL_TIMEOUT:-5m}"
last_status=1

for attempt in $(seq 1 "${attempts}"); do
  echo "Installing Chromium and its system dependencies (attempt ${attempt}/${attempts})..."
  if timeout --signal=TERM --kill-after=30s "${attempt_timeout}" \
    pnpm exec playwright install --with-deps chromium; then
    exit 0
  else
    last_status=$?
  fi
  echo "Chromium installation attempt ${attempt} failed with status ${last_status}." >&2
done

echo "Chromium installation failed after ${attempts} attempts." >&2
exit "${last_status}"
