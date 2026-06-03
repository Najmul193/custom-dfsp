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

cat <<EOF
Provisioning helper for your external Mojaloop core.
This script does not automatically provision the core because each core deployment may require different admin endpoints.

Register these two DFSPs in your core's participant registry:

- Sender FSPID: ${SENDER_FSPID}
  Callback URL: http://<PC1_HOST>:${SENDER_PORT}

- Receiver FSPID: ${RECEIVER_FSPID}
  Callback URL: http://<PC1_HOST>:${RECEIVER_PORT}

Then configure your core to route:
- PARTIES => http://${CORE_HOST}:${CORE_ALS_PORT}
- QUOTES => http://${CORE_HOST}:${CORE_QUOTE_PORT}
- TRANSFERS => http://${CORE_HOST}:${CORE_PORT}
- TRANSACTION_REQUESTS => http://${CORE_HOST}:${CORE_TRANSACTION_REQUESTS_PORT}

Example generic curl payload (replace with your core admin URL):

curl -X POST "http://<core-admin-host>:<admin-port>/participants" \
  -H 'Content-Type: application/json' \
  -d '{
    "fspId": "${SENDER_FSPID}",
    "currency": "USD",
    "partyType": "BANK",
    "endpoint": "http://<PC1_HOST>:${SENDER_PORT}"
  }'

curl -X POST "http://<core-admin-host>:<admin-port>/participants" \
  -H 'Content-Type: application/json' \
  -d '{
    "fspId": "${RECEIVER_FSPID}",
    "currency": "USD",
    "partyType": "BANK",
    "endpoint": "http://<PC1_HOST>:${RECEIVER_PORT}"
  }'

If you are using the custom DFSPs included in this folder, register them as well:

curl -X POST "http://<core-admin-host>:<admin-port>/participants" \
  -H 'Content-Type: application/json' \
  -d '{
    "fspId": "${CUSTOM_SENDER_FSPID}",
    "currency": "USD",
    "partyType": "BANK",
    "endpoint": "http://<PC1_HOST>:${CUSTOM_SENDER_PORT}"
  }'

curl -X POST "http://<core-admin-host>:<admin-port>/participants" \
  -H 'Content-Type: application/json' \
  -d '{
    "fspId": "${CUSTOM_RECEIVER_FSPID}",
    "currency": "USD",
    "partyType": "BANK",
    "endpoint": "http://<PC1_HOST>:${CUSTOM_RECEIVER_PORT}"
  }'

# Optional: if CORE_ADMIN_URL is set in .env you can attempt to register automatically
if [[ -n "${CORE_ADMIN_URL:-}" ]]; then
  echo "Attempting automatic registration against ${CORE_ADMIN_URL}"
  if [[ -n "${CUSTOM_SENDER_FSPID:-}" ]]; then
    curl -s -X PUT "${CORE_ADMIN_URL}/participants/${CUSTOM_SENDER_FSPID}" -H 'Content-Type: application/json' -d "{\"fspId\": \"${CUSTOM_SENDER_FSPID}\", \"endpoint\": \"http://$(hostname -I | awk '{print $1}'):${CUSTOM_SENDER_PORT}\"}"
    echo
  fi
  if [[ -n "${CUSTOM_RECEIVER_FSPID:-}" ]]; then
    curl -s -X PUT "${CORE_ADMIN_URL}/participants/${CUSTOM_RECEIVER_FSPID}" -H 'Content-Type: application/json' -d "{\"fspId\": \"${CUSTOM_RECEIVER_FSPID}\", \"endpoint\": \"http://$(hostname -I | awk '{print $1}'):${CUSTOM_RECEIVER_PORT}\"}"
    echo
  fi
fi
EOF
