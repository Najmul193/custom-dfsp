# Deployment Gap Analysis: Custom DFSP → Real Mojaloop Core

## Executive Summary

Lists every change needed to move from the local `ml-core-test-harness` to a real Mojaloop core.

**Current Status (Test Harness):**
- ✅ Quote/prepare/fulfil flow works through real core
- ⚠️ Core-to-DFSP callbacks use **direct fallbacks**

**Target Status (Real ML Core):**
- Remove fallbacks
- Rely only on core handlers
- Production security + persistence

---

## 1. Core Services Gap

### Missing Notification Handler

The test harness only runs `central-handler-position-batch`. It does **not** run handlers that send:
- `POST /transfers` to the receiver
- `PUT /transfers/{id}` fulfilment to the sender

**Required:** Deploy notification/fulfil handlers:
```text
central-handler-transfer-notification
central-handler-fulfil
```

**Current Code Change:** Direct fallbacks in `custom-dfsp/app/server.js`.

---

## 2. Participant Registration Gap

### Manual DB Insertion vs. Admin API

Participants were inserted directly into MySQL because the admin API didn't persist in the test harness.

**Required:** Use core provisioning/admin API:
```bash
POST {CENTRAL_LEDGER_ADMIN_URL}/participants
{
  "name": "custom-sender-fsp",
  "currency": "XXX"
}
POST {CENTRAL_LEDGER_ADMIN_URL}/participants/{fspId}/endpoints
{
  "type": "FSPIOP_CALLBACK_URL_TRANSFER_POST",
  "value": "https://dfsp-host/custom-dfsp-receiver/transfers"
}
```

Callback base URLs must be reachable from the core network.

---

## 3. Network/Connectivity Gap

### 3.1 Docker Internal Names vs. Real Host

**Current `.env`:**
```text
CORE_HOST=ml-api-adapter
CORE_QUOTE_HOST=quoting-service
CORE_ALS_HOST=account-lookup-service
```

**Required:** Use real addresses:
```text
CORE_HOST=ml-api-adapter.mojaloop.svc.cluster.local
CORE_QUOTE_HOST=quoting-service.mojaloop.svc.cluster.local
CORE_ALS_HOST=account-lookup-service.mojaloop.svc.cluster.local
```

Or public IP/DNS if DFSP containers run outside the core cluster.

### 3.2 DFSP Callback URLs

**Current:** Internal Docker hostnames.

**Required:** External/LAN reachable URLs:
```text
https://sender-dfsp.mycompany.com/transfers
https://receiver-dfsp.mycompany.com/transfers
```

---

## 4. Security Gap

| Area | Current (Test) | Required (Production) |
|------|---------------|-----------------------|
| Transport | HTTP | HTTPS/TLS |
| FSPIOP signatures | Disabled | JWS signing |
| mTLS | None | Recommended |
| Secrets | Mounted file | Vault/K8s secrets |

**