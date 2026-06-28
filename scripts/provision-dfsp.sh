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

# ── Arguments ──────────────────────────────────────────────────────────────

FSP_ID="${1:-}"
AMOUNT="${2:-}"
CURRENCY="${3:-XXX}"
CALLBACK_ARG="${4:-3000}"

if [[ -z "$FSP_ID" || -z "$AMOUNT" ]]; then
  echo "Usage: $0 <fsp-id> <amount> [currency=XXX] [callback-url-or-port=3000]"
  echo ""
  echo "Examples:"
  echo "  $0 my-new-fsp 5000000"
  echo "  $0 my-new-fsp 10000000 USD 4000"
  echo "  $0 my-new-fsp 5000000 XXX http://10.0.0.5:3000"
  exit 1
fi

if ! [[ "$AMOUNT" =~ ^[0-9]+$ ]]; then
  echo "Error: Amount must be a positive integer."
  exit 1
fi

# ── Config ─────────────────────────────────────────────────────────────────

CORE_ADMIN="${CORE_ADMIN_URL:-http://central-ledger:3001}"
CONTAINER="ml-api-adapter"
INTERNAL_ADMIN="http://central-ledger:3001"

# ── Helpers ────────────────────────────────────────────────────────────────

api_call() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local url="${CORE_ADMIN}${path}"
  local internal_url="${INTERNAL_ADMIN}${path}"
  local response=""

  # Try direct
  if [[ -n "$data" ]]; then
    response=$(curl -s -X "$method" "$url" \
      -H 'Content-Type: application/json' \
      -d "$data" 2>/dev/null || true)
  else
    response=$(curl -s -X "$method" "$url" \
      -H 'Content-Type: application/json' 2>/dev/null || true)
  fi

  if [[ -n "$response" ]] && ! echo "$response" | grep -qi '<html'; then
    echo "$response"
    return 0
  fi

  # Fallback via docker exec
  echo "" >&2
  echo "  [info] Direct curl failed. Trying 'docker exec $CONTAINER'..." >&2
  if [[ -n "$data" ]]; then
    response=$(echo "$data" | docker exec -i "$CONTAINER" curl -s -X "$method" \
      "$internal_url" \
      -H 'Content-Type: application/json' \
      -d '@-' 2>/dev/null || true)
  else
    response=$(docker exec "$CONTAINER" curl -s -X "$method" \
      "$internal_url" \
      -H 'Content-Type: application/json' 2>/dev/null || true)
  fi

  if [[ -n "$response" ]]; then
    echo "$response"
    return 0
  fi

  echo "" >&2
  echo "  [error] Cannot reach core admin API at $CORE_ADMIN" >&2
  echo "  [error] Also tried docker exec on $CONTAINER" >&2
  return 1
}

generate_uuid() {
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif [[ -f /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  elif command -v python3 &>/dev/null; then
    python3 -c "import uuid; print(uuid.uuid4())"
  elif command -v python &>/dev/null; then
    python -c "import uuid; print(uuid.uuid4())"
  else
    echo "fallback-$(date +%s)-$$"
  fi
}

get_host_ip() {
  case "$(uname -s)" in
    Darwin)
      if command -v ipconfig &>/dev/null; then
        ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "host.docker.internal"
      else
        echo "host.docker.internal"
      fi
      ;;
    Linux)
      if command -v hostname &>/dev/null; then
        hostname -I 2>/dev/null | awk '{print $1}'
      elif command -v ip &>/dev/null; then
        ip route get 1 2>/dev/null | awk '{print $7; exit}'
      else
        echo "127.0.0.1"
      fi
      ;;
    *)
      echo "127.0.0.1"
      ;;
  esac
}

# ── Resolve callback URL ──────────────────────────────────────────────────

if echo "$CALLBACK_ARG" | grep -q '://'; then
  CALLBACK_URL="$CALLBACK_ARG"
else
  HOST_IP=$(get_host_ip)
  CALLBACK_URL="http://${HOST_IP}:${CALLBACK_ARG}"
fi

# ── Summary ────────────────────────────────────────────────────────────────

echo "============================================"
echo "  Provision DFSP in Mojaloop Core"
echo "============================================"
echo "  FSP ID:       $FSP_ID"
echo "  Amount:       $AMOUNT $CURRENCY"
echo "  Callback URL: $CALLBACK_URL"
echo "  Core Admin:   $CORE_ADMIN"
echo "============================================"
echo ""

# ── Step 1: Register participant ──────────────────────────────────────────

echo "[1/3] Registering participant '$FSP_ID'..."

REG_DATA=$(cat <<EOF
{
  "fspId": "$FSP_ID",
  "endpoint": "$CALLBACK_URL"
}
EOF
)

REG_RESPONSE=$(api_call PUT "/participants/${FSP_ID}" "$REG_DATA") || {
  echo "  ✗ Failed to register participant"
  exit 1
}

if echo "$REG_RESPONSE" | grep -qiE '(error|"errorInformation")'; then
  echo "  ⚠ Registration returned an error:"
  echo "    $REG_RESPONSE"
  echo "  Continuing (participant may already exist)..."
else
  echo "  ✓ Participant '$FSP_ID' registered"
fi

# ── Step 2: Discover account ID ───────────────────────────────────────────

echo ""
echo "[2/3] Discovering account ID for '$FSP_ID'..."

ACCOUNT_ID=""
ACCOUNTS_JSON=$(api_call GET "/participants/${FSP_ID}/accounts") || true

if [[ -n "$ACCOUNTS_JSON" ]] && ! echo "$ACCOUNTS_JSON" | grep -qiE '(error|"errorInformation")'; then
  ACCOUNT_ID=$(echo "$ACCOUNTS_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        for acct in data:
            if acct.get('ledgerAccountType') in ('POSITION', 'SETTLEMENT'):
                print(acct.get('id', acct.get('accountId', '17')))
                sys.exit(0)
        if data:
            print(data[0].get('id', data[0].get('accountId', '17')))
        else:
            print('17')
    elif isinstance(data, dict):
        accts = data.get('accounts', data.get('participantAccounts', data.get('participantAccountList', [])))
        if isinstance(accts, list) and accts:
            for acct in accts:
                if acct.get('ledgerAccountType') in ('POSITION', 'SETTLEMENT'):
                    print(acct.get('id', acct.get('accountId', '17')))
                    sys.exit(0)
            print(accts[0].get('id', accts[0].get('accountId', '17')))
        else:
            print('17')
    else:
        print('17')
except Exception:
    print('17')
" 2>/dev/null || echo "")
fi

if [[ -z "$ACCOUNT_ID" ]]; then
  echo "  ⚠ Account discovery failed, using default account ID 17"
  ACCOUNT_ID="17"
fi

echo "  ✓ Using account ID: $ACCOUNT_ID"

# ── Step 3: Deposit initial balance ───────────────────────────────────────

echo ""
echo "[3/3] Depositing $AMOUNT $CURRENCY to '$FSP_ID' (account $ACCOUNT_ID)..."

TRANSFER_ID=$(generate_uuid)
FUNDS_DATA=$(cat <<EOF
{
  "transferId": "$TRANSFER_ID",
  "externalReference": "provision-dfsp-initial-funding",
  "action": "recordFundsIn",
  "reason": "Initial balance for DFSP $FSP_ID",
  "amount": {
    "amount": $AMOUNT,
    "currency": "$CURRENCY"
  },
  "extensionList": {
    "extension": [
      {"key": "provisioning", "value": "custom-dfsp-setup"}
    ]
  }
}
EOF
)

FUNDS_RESPONSE=$(api_call POST "/participants/${FSP_ID}/accounts/${ACCOUNT_ID}" "$FUNDS_DATA") || {
  echo "  ✗ Failed to deposit initial balance"
  exit 1
}

if echo "$FUNDS_RESPONSE" | grep -qiE '(error|"errorInformation")'; then
  echo "  ✗ Funds-in request returned an error:"
  echo "    $FUNDS_RESPONSE"
  exit 1
fi

echo "  ✓ $AMOUNT $CURRENCY deposited"
echo "    Transfer ID: $TRANSFER_ID"

# ── Done ───────────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo "  DFSP '$FSP_ID' provisioned successfully!"
echo "============================================"
echo "  FSP ID:       $FSP_ID"
echo "  Balance:      $AMOUNT $CURRENCY"
echo "  Callback URL: $CALLBACK_URL"
echo "  Account ID:   $ACCOUNT_ID"
echo "  Funding TX:   $TRANSFER_ID"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Deploy your DFSP with FSP_ID='$FSP_ID'"
echo "  2. Ensure it's reachable at $CALLBACK_URL"
echo "  3. Send a test transfer via:"
echo "     curl -X POST http://localhost:3001/initiate-transfer \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"payeeFsp\":\"$FSP_ID\",\"amount\":100}'"
echo ""
