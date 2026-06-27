# Custom DFSP API & Function Reference

## Overview

The custom DFSP is a Node.js/Express application (`custom-dfsp/app/`) that implements a FSPIOP-compliant DFSP. It can run as either a **sender** (payer) or **receiver** (payee) based on `FSP_ID`.

---

## 1. Core Modules

### `server.js` — Express API & Transfer Workflow

#### Constants

| Constant | Env Variable | Default | Description |
|----------|-------------|---------|-------------|
| `PORT` | `PORT` | `3000` | HTTP listen port |
| `FSP_ID` | `FSP_ID` | `customfsp` | This DFSP's FSPIOP identifier |
| `VISUALIZER_URL` | `VISUALIZER_URL` | — | Socket.IO event URL for visualizer |
| `AUTO_FULFIL` | `AUTO_FULFIL` | `true` | Auto-fulfil incoming transfers |
| `RECEIVER_CALLBACK_URL` | `RECEIVER_CALLBACK_URL` | — | Direct receiver transfer URL (fallback) |

#### Endpoints

| Method | Path | Direction | Description |
|--------|------|-----------|-------------|
| `GET` | `/` | — | Root info (FSP ID, status, endpoints) |
| `GET` | `/health` | — | Health check |
| `GET` | `/status` | — | Uptime, transfer/quote counts |
| `POST` | `/initiate-transfer` | Outgoing | Full FSPIOP transfer (quote → prepare → fulfil) |
| `POST` | `/quotes` | Inbound | Receive inbound quote |
| `PUT` | `/quotes/:id` | Inbound | Quote response callback |
| `PUT` | `/quotes/:id/error` | Inbound | Quote error callback |
| `POST` | `/transfers` | Inbound | Transfer prepare |
| `PUT` | `/transfers/:id` | Inbound | Transfer fulfilment callback |
| `PUT` | `/transfers/:id/error` | Inbound | Transfer error callback |

---

### `adapter.js` — Core Communication

| Function | Arguments | Description |
|----------|-----------|-------------|
| `postToCore(path, body, method, extraHeaders)` | Core path, body, HTTP method, extra headers | Send transfer/fulfil to core API |
| `postQuote(quoteRequest)` | Quote request | Submit quote to quoting service |
| `putQuote(quoteId, quoteResponse, destFspId)` | Quote ID, response, dest | Respond to quote (receiver) |
| `putFulfilment(transferId, fulfilmentBody, destFspId)` | Transfer ID, fulfilment, dest | Submit fulfilment (receiver → core) |
| `registerParticipant(participantFspId, callbackUrl)` | FSP ID, callback URL | Register in core admin API |
| `lookupParticipant(partyIdType, partyIdentifier)` | Party type, identifier | ALS participant lookup |
| `fspiopHeaders(source, destination, contentType, extra)` | — | Build standard FSPIOP headers |

#### Adapter Env Variables

| Variable | Default | Used By |
|----------|---------|---------|
| `CORE_HOST` | `ml-api-adapter` | `postToCore`, `putFulfilment` |
| `CORE_PORT` | `3000` | `postToCore`, `putFulfilment` |
| `CORE_QUOTE_HOST` | `ml-api-adapter` | `postQuote`, `putQuote` |
| `CORE_QUOTE_PORT` | `3002` | `postQuote`, `putQuote` |
| `CORE_ALS_HOST` | `account-lookup-service` | `lookupParticipant` |
| `CORE_ALS_PORT` | `3001` | `lookupParticipant` |
| `ADMIN_API_URL` | — | `registerParticipant` |

---

### `store.js` — State Machine

| Function | Description |
|----------|-------------|
| `createTransfer(id, data)` | Create transfer |
| `getTransfer(id)` | Get by ID |
| `updateTransfer(id, updates)` | Update state |
| `getAllTransfers()` | List all |
| `createQuote(data)` | Create quote |
| `getQuote(id)` | Get by ID |
| `updateQuote(id, updates)` | Update quote |
| `isTransferExpired(transferId)` | Check expiry |
| `cleanup()` | Remove expired entries |

#### Transfer States
```
PENDING → PREPARED → COMMITTED
                   → FAILED
                   → EXPIRED
```

#### Quote States
```
PENDING → ACCEPTED → (transfer prepares)
       → REJECTED
       → EXPIRED
```

---

### `ilp.js` — ILP & Crypto

| Function | Description |
|----------|-------------|
| `generateIlpPacket(data)` | Dynamic ILP packet with nonce |
| `generateCondition(fulfilment)` | SHA-256 → condition |
| `generateFulfilment()` | Random 32-byte fulfilment |
| `validateFulfilment(fulfilment, condition)` | Validate fulfilment vs condition |
| `fspiopError(code, message)` | Standard FSPIOP error response |


---

## 2. Transfer Lifecycle

### On a Real ML Core (Full Handler Stack)

```
SENDER                          CORE                     RECEIVER
  │                              │                          │
  │── POST /quotes ────────────►│                          │
  │                              │── POST /quotes ────────►│
  │                              │◄── PUT /quotes/{id} ────│
  │◄─── PUT /quotes/{id} ──────│                          │
  │                              │                          │
  │── POST /transfers ─────────►│                          │
  │                              │── POST /transfers ─────►│  (notification handler)
  │                              │◄── PUT /transfers/{id} ─│  (receiver fulfils)
  │◄─── PUT /transfers/{id} ────│                          │  (notification handler)
  │                    TRANSFER COMMITTED                   │
```

### With Fallback (Test Harness without Notification Handler)

```
SENDER                          CORE                     RECEIVER
  │                              │                          │
  │── POST /quotes ────────────►│                          │
  │                              │── POST /quotes ────────►│
  │                              │◄── PUT /quotes/{id} ────│
  │◄─── PUT /quotes/{id} ──────│                          │
  │                              │                          │
  │── POST /transfers ─────────►│                          │
  │─── [FALLBACK] POST /transfers──────────────────────────►│  (sender calls receiver)
  │                              │◄── PUT /transfers/{id} ─│  (receiver fulfils → core)
  │◄── [FALLBACK] PUT /transfers/{id}───────────────────────│  (receiver calls sender)
  │                    TRANSFER COMMITTED                   │
```

---

## 3. Fallback Mechanism

Designed for test harnesses missing the core's notification/fulfil handler:

### Sender → Receiver (after prepare accepted)
- **Env**: `RECEIVER_CALLBACK_URL=http://custom-dfsp-receiver:3002/transfers`
- **Trigger**: Core returns 202 on POST /transfers
- **Action**: Sender POSTs transfer directly to receiver
- **Production**: Remove — the real ML core handles this

### Receiver → Sender (after fulfil committed)
- **Env**: `SENDER_CALLBACK_URL=http://custom-dfsp-sender:3001`
- **Trigger**: Core returns 200 on PUT /transfers/{id}
- **Action**: Receiver PUTs fulfilment directly to sender
- **Production**: Remove — the real ML core handles this

---

## 4. Error Handling

| Scenario | HTTP | Response |
|----------|------|----------|
| Missing fields | 400 | `{"error":"Missing required fields..."}` |
| Quote not found | 404 | FSPIOP error `3200` |
| Transfer not found | 404 | FSPIOP error `3200` |
| Invalid JSON | 400 | FSPIOP error `3102` |
| Condition mismatch | 400 | FSPIOP error `3100` |
| Core unreachable | — | `{status: 0, error: ...}` logged |
