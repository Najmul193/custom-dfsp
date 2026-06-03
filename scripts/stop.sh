#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

# Check for docker compose
if ! docker compose version &>/dev/null && ! docker-compose --version &>/dev/null; then
  echo "ERROR: Neither 'docker compose' nor 'docker-compose' found."
  exit 1
fi

echo "========================================"
echo "  Stopping All DFSP + UI Services"
echo "========================================"

echo ""
echo "[1/2] Stopping UI dashboard services..."
if docker compose version &>/dev/null; then
  docker compose -f docker-compose-ui.yml down 2>/dev/null || true
else
  docker-compose -f docker-compose-ui.yml down 2>/dev/null || true
fi
echo "  ✓ UI services stopped"

echo ""
echo "[2/2] Stopping DFSP services..."
if docker compose version &>/dev/null; then
  docker compose down 2>/dev/null || true
else
  docker-compose down 2>/dev/null || true
fi
echo "  ✓ DFSP services stopped"

echo ""
echo "All services stopped."