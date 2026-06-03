#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

docker-compose down --remove-orphans
sleep 2
docker-compose up -d

echo "Started DFSP sender, receiver, and visualizer services."
