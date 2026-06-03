#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

source .env

check_service() {
  local name="$1"
  local url="$2"
  echo -n "Checking ${name}... "
  if curl --max-time 5 -fsS "${url}" >/dev/null; then
    echo "OK"
  else
    echo "FAILED"
  fi
}

check_service "Sender DFSP" "http://localhost:${SENDER_PORT}/health"
check_service "Receiver DFSP" "http://localhost:${RECEIVER_PORT}/health"
check_service "Visualizer UI" "http://localhost:${VISUALIZER_PORT}"
check_service "Core health" "http://${CORE_HOST}:${CORE_PORT}/health"

echo "Health check complete. If any checks failed, verify that services are running and network settings are correct."