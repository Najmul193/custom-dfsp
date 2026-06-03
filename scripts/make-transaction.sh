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

# Parse arguments
SENDER_FSPID="${1:-custom-sender-fsp}"
RECEIVER_FSPID="${2:-custom-receiver-fsp}"
AMOUNT="${3:-100}"

# Determine sender port based on FSPID
if [[ "$SENDER_FSPID" == "custom-receiver-fsp" ]]; then
  SENDER_PORT=$CUSTOM_RECEIVER_PORT
else
  SENDER_PORT=$CUSTOM_SENDER_PORT
fi

echo "Initiating transfer:"
echo "  From: $SENDER_FSPID (port $SENDER_PORT)"
echo "  To: $RECEIVER_FSPID"
echo "  Amount: $AMOUNT USD"
echo ""

RESPONSE=$(curl -s -X POST "http://localhost:${SENDER_PORT}/initiate-transfer" \
  -H 'Content-Type: application/json' \
  -d "{\"payeeFsp\":\"${RECEIVER_FSPID}\",\"amount\":${AMOUNT}}")

TRANSFER_ID=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['transferId'])" 2>/dev/null || echo "ERROR")
STATUS=$(echo "$RESPONSE" | python3 -c "import sys, json; r = json.load(sys.stdin); print(r.get('quoteResponse', {}).get('status', 'FAILED'))" 2>/dev/null || echo "FAILED")

if [[ "$STATUS" == "202" ]]; then
  echo "✓ Quote accepted by quoting service (status 202)"
  echo "Transfer ID: $TRANSFER_ID"
  echo ""
  echo "View real-time events at: http://localhost:${VISUALIZER_PORT}"
else
  echo "✗ Transfer failed (status: $STATUS)"
  echo "Response: $RESPONSE"
  exit 1
fi