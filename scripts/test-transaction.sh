#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

if [[ ! -f .env ]]; then
  echo "Missing .env. Run ./scripts/setup.sh first."
  exit 1
fi

source .env

echo "Running basic service connectivity checks..."
echo ""

echo "Sender DFSP health:"
curl --max-time 5 -fsS "http://localhost:${SENDER_PORT}/health" 
echo ""

echo "Receiver DFSP health:"
curl --max-time 5 -fsS "http://localhost:${RECEIVER_PORT}/health"
echo ""

echo "Core health (via visualizer):"
curl --max-time 5 -fsS "http://localhost:${VISUALIZER_PORT}/api/status" | python3 -c "import sys, json; data = json.load(sys.stdin); core = next((r for r in data['results'] if r['name'] == 'core'), None); print('✓ HEALTHY' if core and core['healthy'] else '✗ UNHEALTHY')" || echo "FAILED"
echo ""

echo "Custom DFSP Sender health:"
curl --max-time 5 -fsS "http://localhost:${CUSTOM_SENDER_PORT}/health"
echo ""

echo "Custom DFSP Receiver health:"
curl --max-time 5 -fsS "http://localhost:${CUSTOM_RECEIVER_PORT}/health"
echo ""
