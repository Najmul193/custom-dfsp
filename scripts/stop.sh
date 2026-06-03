#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

if command -v docker compose >/dev/null 2>&1; then
  docker compose down
else
  docker-compose down
fi

echo "Stopped DFSP sender, receiver, and visualizer services."
