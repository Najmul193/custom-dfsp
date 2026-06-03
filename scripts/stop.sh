#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

echo "========================================"
echo "  Stopping All DFSP + UI Services"
echo "========================================"

echo ""
echo "[1/2] Stopping UI dashboard services..."
docker compose -f docker-compose-ui.yml down 2>/dev/null || true
echo "  ✓ UI services stopped"

echo ""
echo "[2/2] Stopping DFSP services..."
if command -v docker compose >/dev/null 2>&1; then
  docker compose down
else
  docker-compose down
fi
echo "  ✓ DFSP services stopped"

echo ""
echo "All services stopped."