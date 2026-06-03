#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

# Source .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Determine which compose command to use
COMPOSE_CMD=""
if command -v docker compose &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo "ERROR: Neither 'docker compose' nor 'docker-compose' found. Please install Docker Compose."
  exit 1
fi

echo "========================================"
echo "  Starting All DFSP + UI Services"
echo "========================================"

# Step 1: Start core DFSP services (sender, receiver, visualizer)
echo ""
echo "[1/2] Starting DFSP services (sender, receiver, visualizer)..."
$COMPOSE_CMD down --remove-orphans 2>/dev/null || true
$COMPOSE_CMD up -d
echo "  ✓ DFSP services started"

# Step 2: Start UI services (sender UI, receiver UI, core monitor)
echo ""
echo "[2/2] Starting UI dashboard services..."
$COMPOSE_CMD -f docker-compose-ui.yml down --remove-orphans 2>/dev/null || true
$COMPOSE_CMD -f docker-compose-ui.yml up -d
echo "  ✓ UI services started"

# Show summary
echo ""
echo "========================================"
echo "  All Services Started!"
echo "========================================"
echo ""
echo "  Service              URL"
echo "  ───────────────────────────────────────"
echo "  Sender DFSP          http://localhost:${SENDER_PORT:-8444}"
echo "  Receiver DFSP        http://localhost:${RECEIVER_PORT:-8445}"
echo "  Custom Sender        http://localhost:${CUSTOM_SENDER_PORT:-3001}"
echo "  Custom Receiver      http://localhost:${CUSTOM_RECEIVER_PORT:-3002}"
echo "  Visualizer           http://localhost:${VISUALIZER_PORT:-3003}"
echo "  Sender UI            http://localhost:4001"
echo "  Receiver UI          http://localhost:4002"
echo "  Core Monitor         http://localhost:4003"
echo ""
echo "  Sender UI → send transfers to: custom-receiver-fsp"
echo ""

# Quick health check
echo "  Running health check..."
sleep 3
if command -v curl &>/dev/null; then
  for svc in 4001 4002 4003; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$svc/api/health" 2>/dev/null || echo "000")
    if [ "$status" = "200" ]; then
      echo "  ✓ UI on :$svc is healthy"
    else
      echo "  ✗ UI on :$svc returned status $status"
    fi
  done
fi
echo ""
echo "  Open http://localhost:4001 to start sending transfers."
echo ""