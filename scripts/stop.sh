#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

# Determine which compose command to use
COMPOSE_CMD=""
if command -v docker compose &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo "ERROR: Neither 'docker compose' nor 'docker-compose' found."
  exit 1
fi

echo "========================================"
echo "  Stopping All DFSP + UI Services"
echo "========================================"

echo ""
echo "[1/2] Stopping UI dashboard services..."
$COMPOSE_CMD -f docker-compose-ui.yml down 2>/dev/null || true
echo "  ✓ UI services stopped"

echo ""
echo "[2/2] Stopping DFSP services..."
$COMPOSE_CMD down 2>/dev/null || true
echo "  ✓ DFSP services stopped"

echo ""
echo "All services stopped."