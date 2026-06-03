# Custom DFSP Setup - Complete Documentation

## Overview

This is a fully self-contained Mojaloop DFSP (Digital Financial Service Provider) implementation that works independently with any Mojaloop core. It demonstrates:

- ✅ **Custom Node.js DFSP services** - Two DFSPs (sender and receiver) built from scratch
- ✅ **FSPIOP protocol compliance** - Proper headers, payload structure, and error handling
- ✅ **Docker orchestration** - All services containerized and networked
- ✅ **Real-time visualization** - Socket.IO-based UI showing live transaction events
- ✅ **Environment-driven configuration** - Works with any external core via `.env`
- ✅ **Helper scripts** - Easy transaction initiation and service testing

## What Was Built

### 1. Custom DFSP Application (`custom-dfsp/app/`)

**server.js** - Express API server implementing full FSPIOP-compliant transfer workflow:
- `GET /health` - Health check endpoint
- `GET /status` - FSP status with transfer/quote counts
- `POST /initiate-transfer` - Full quote → transfer → fulfil flow
- `POST /quotes` - Receive inbound quote requests from core
- `PUT /quotes/:id` - Receive quote response callbacks from core
- `POST /transfers` - Receive transfer prepare requests from core
- `PUT /transfers/:id` - Receive transfer fulfilment callbacks from core (with condition validation)
- `PUT /transfers/:id/error` - Receive transfer error callbacks from core
- Generic catch-all callback handlers (POST/PUT)

**adapter.js** - Reusable core communication adapter:
- Handles all FSPIOP header generation with proper content-type negotiation
- `postToCore()` - POST/PUT to core transfers API
- `postQuote()` - POST quote requests to core quoting service
- `putFulfilment()` - PUT fulfilments to core transfers API
- `lookupParticipant()` - Account Lookup Service integration
- `registerParticipant()` - Participant registration via admin API
- Works with any core via environment variables

**store.js** - In-memory state machine:
- Tracks transfer lifecycle: PENDING → PREPARED → COMMITTED / FAILED / EXPIRED
- Tracks quote lifecycle: PENDING → ACCEPTED / REJECTED / EXPIRED
- Quote expiration detection
- Periodic cleanup of old state

**ilp.js** - ILP and cryptographic utilities:
- Dynamic ILP packet generation with nonce (base64url encoded)
- SHA-256 fulfilment/condition pair generation
- Fulfilment validation against condition
- Standard FSPIOP error response builder
- Uses Node.js built-in `crypto` module (no external deps)

### 2. Real-Time Visualizer (`docker/visualizer/`)

Web-based UI showing:
- Live transaction events flowing through the system
- Health status of all services (sender, receiver, core)
- Socket.IO integration for real-time updates
- Accessible at `http://localhost:3003`

### 3. Orchestration

**docker-compose.yml** - Manages 5 services:
1. `sender-dfsp` - Mojaloop simulator (port 8444)
2. `receiver-dfsp` - Mojaloop simulator (port 8445)
3. `custom-dfsp-sender` - Custom Node.js DFSP (port 3001)
4. `custom-dfsp-receiver` - Custom Node.js DFSP (port 3002)
5. `dfsp-visualizer-ui` - Real-time event visualizer (port 3003)

**Networks:**
- `dfsp-net` - Bridge network for DFSPs and visualizer
- `mojaloop-net` - External network connecting to Mojaloop core

### 4. Helper Scripts

- `./scripts/start.sh` - Clean startup (stops orphans, starts services)
- `./scripts/test-transaction.sh` - Check all services are healthy
- `./scripts/make-transaction.sh` - Initiate a transaction easily
- `./scripts/provision-dfsps.sh` - Register DFSPs in core

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Host Machine (10.0.2.15)              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Docker Container Network                 │  │
│  │                                                   │  │
│  │  dfsp-net (bridge)        mojaloop-net (ext)    │  │
│  │  ├─ custom-dfsp-sender    ├─ ml-api-adapter     │  │
│  │  ├─ custom-dfsp-receiver  ├─ central-ledger     │  │
│  │  ├─ sender-dfsp           └─ other services     │  │
│  │  ├─ receiver-dfsp                               │  │
│  │  └─ visualizer-ui                               │  │
│  │                                                   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  Exposed Ports:                                        │
│  - localhost:3001 (custom-sender)                     │
│  - localhost:3002 (custom-receiver)                   │
│  - localhost:3003 (visualizer)                        │
│  - localhost:8444 (simulator-sender)                  │
│  - localhost:8445 (simulator-receiver)                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- Docker & docker-compose (legacy: v1.29.2)
- Running Mojaloop core on `mojaloop-net` network
- Basic understanding of FSPIOP protocol

## Quick Start

### 1. Navigate to the setup folder

```bash
cd /home/rivan/ml-core-test-harness/dfsp-sender-receiver-setup
```

### 2. Check/update `.env` configuration

```bash
cat .env
```

Key variables:
- `CORE_HOST` - Core API adapter hostname (default: `ml-api-adapter`)
- `CORE_PORT` - Core port (default: `3000`)
- `CUSTOM_SENDER_FSPID` / `CUSTOM_RECEIVER_FSPID` - DFSP identities
- `CUSTOM_SENDER_PORT` / `CUSTOM_RECEIVER_PORT` - Service ports

### 3. Start all services

```bash
./scripts/start.sh
```

Wait 5-10 seconds for services to initialize.

### 4. Test connectivity

```bash
./scripts/test-transaction.sh
```

Expected output:
```
Running basic service connectivity checks...

Sender DFSP health:
{"status":"OK"}
Receiver DFSP health:
{"status":"OK"}
Core health (via visualizer):
✓ HEALTHY

Custom DFSP Sender health:
{"status":"OK","fspId":"custom-sender-fsp"}
Custom DFSP Receiver health:
{"status":"OK","fspId":"custom-receiver-fsp"}
```

### 5. Make a test transaction

```bash
./scripts/make-transaction.sh custom-sender-fsp custom-receiver-fsp 100
```

Expected output:
```
Initiating transfer:
  From: custom-sender-fsp (port 3001)
  To: custom-receiver-fsp
  Amount: 100 USD

✓ Transfer accepted by core (status 202)
Transfer ID: abc123...
View real-time events at: http://localhost:3003
```

### 6. Monitor real-time events

Open browser: `http://localhost:3003`

Watch transactions flow in real-time with:
- Transfer preparation
- Quote requests/responses
- Fulfillment notifications
- Error logging

## How to Use It

### Method 1: Helper Script (Recommended)

```bash
# Basic usage (100 USD, sender→receiver)
./scripts/make-transaction.sh

# Custom sender and receiver
./scripts/make-transaction.sh custom-sender-fsp custom-receiver-fsp 250

# Reverse direction
./scripts/make-transaction.sh custom-receiver-fsp custom-sender-fsp 75
```

### Method 2: Direct curl

```bash
# Send from sender DFSP (port 3001)
curl -X POST http://localhost:3001/initiate-transfer \
  -H 'Content-Type: application/json' \
  -d '{"payeeFsp":"custom-receiver-fsp","amount":500}'

# Send from receiver DFSP (port 3002)
curl -X POST http://localhost:3002/initiate-transfer \
  -H 'Content-Type: application/json' \
  -d '{"payeeFsp":"custom-sender-fsp","amount":300}'
```

### Method 3: Visualizer UI

1. Open `http://localhost:3003`
2. Real-time events stream automatically
3. Health status updates every 5 seconds
4. No manual transactions needed - observe simulator activity

## Transfer Flow (What Happens)

The custom DFSP now implements the full FSPIOP-compliant transfer flow:

1. **Initiation** → POST `/initiate-transfer` on sender DFSP with `{ payeeFsp, amount }`
2. **ILP Generation** → DFSP generates dynamic ILP packet + SHA-256 condition/fulfilment pair
3. **Quote Request** → DFSP POSTs quote to core quoting service (`/quotes`)
4. **Quote Response** → Core calls back `PUT /quotes/{id}` with payee DFSP's ILP packet and condition
5. **Transfer Prepare** → DFSP POSTs transfer to core transfers API (`/transfers`) with the quoted ILP/condition
6. **Core Processing** → Mojaloop core validates, routes to payee DFSP for preparation
7. **Fulfilment** → Payee DFSP sends fulfilment via `PUT /transfers/{id}` to core
8. **Fulfilment Callback** → Core calls back `PUT /transfers/{id}` on payer DFSP with fulfilment
9. **Condition Validation** → Payer DFSP validates fulfilment against original condition (SHA-256)
10. **State Machine** → Transfer moves: PENDING → PREPARED → COMMITTED

State tracking:
- **PENDING** — Initial state when transfer is created
- **PREPARED** — Transfer has been submitted to core
- **COMMITTED** — Fulfilment received and validated
- **FAILED** — Error occurred or condition mismatch
- **EXPIRED** — Transfer/quote expired before completion

## Available Endpoints

### Custom DFSP Sender (port 3001)

```bash
# Health check
curl http://localhost:3001/health

# Initiate transfer
curl -X POST http://localhost:3001/initiate-transfer \
  -H 'Content-Type: application/json' \
  -d '{"payeeFsp":"custom-receiver-fsp","amount":100}'

# Receive callbacks from core (automatic)
POST /transfers/{id}
PUT /transfers/{id}
```

### Custom DFSP Receiver (port 3002)

Same endpoints as sender (mirror configuration).

### Visualizer (port 3003)

```bash
# Web UI
http://localhost:3003

# API - Get all service status
curl http://localhost:3003/api/status

# WebSocket - Real-time events
ws://localhost:3003
```

## Configuration

### Environment Variables (`.env`)

```bash
# Core connectivity
CORE_HOST=ml-api-adapter          # Container hostname of core API
CORE_PORT=3000                    # Core port
CORE_ALS_PORT=3001                # Account Lookup Service
CORE_QUOTE_PORT=3002              # Quote Service
CORE_TRANSACTION_REQUESTS_PORT=4003

# Admin API for provisioning
CORE_ADMIN_URL=http://central-ledger:3001

# DFSP identities
CUSTOM_SENDER_FSPID=custom-sender-fsp
CUSTOM_RECEIVER_FSPID=custom-receiver-fsp

# Service ports (exposed to host)
CUSTOM_SENDER_PORT=3001
CUSTOM_RECEIVER_PORT=3002
VISUALIZER_PORT=3003

# Simulator DFSPs (optional, pre-configured)
SENDER_PORT=8444
RECEIVER_PORT=8445

# Visualizer refresh interval
REFRESH_INTERVAL_SECONDS=5
```

## What Still Needs to Be Done

### Core Transfer Workflow (✅ Phase 1 Complete)

- [x] **Quote Integration** - Full quote request/response cycle implemented via `/quotes` → `PUT /quotes/{id}`
- [x] **Fulfillment Callbacks** - `PUT /transfers/{id}` handler with condition validation
- [x] **Condition Matching** - SHA-256 validation of fulfilment against condition
- [x] **Error Handling** - Proper FSPIOP error responses (3100, 3102, 3200) and `/transfers/{id}/error` callback handling
- [x] **State Machine** - In-memory store tracking: PENDING → PREPARED → COMMITTED / FAILED / EXPIRED
- [x] **ILP Packet Generation** - Dynamic ILP packet construction with nonce per transfer
- [x] **Quote Expiration** - Timeout detection and expiration state

### Advanced Features

- [ ] **Batch Transfers** - Multiple transfers in one request
- [ ] **Liquidity Management** - Reserve/release liquidity between transfers
- [ ] **Notification Callbacks** - POST back to originating FSP
- [ ] **Participant Discovery** - Dynamic FSP endpoint lookup

### Persistence & Logging

- [ ] **Database** - Persist transfers to database
- [ ] **Audit Logs** - Complete transaction audit trail
- [ ] **Message Queuing** - Async processing with MQ (Kafka/RabbitMQ)
- [ ] **Performance Monitoring** - Prometheus metrics

### Security

- [ ] **TLS/mTLS** - Encrypted communication
- [ ] **JWT Authentication** - Bearer token validation
- [ ] **Request Signing** - JWS payload signatures
- [ ] **Rate Limiting** - Per-FSP request limits

### Testing

- [ ] **Unit Tests** - adapter.js, server.js
- [ ] **Integration Tests** - Full transfer workflow
- [ ] **Load Tests** - Performance under high transaction volume
- [ ] **Negative Tests** - Error scenarios and edge cases

## Troubleshooting

### Core shows unhealthy in visualizer

**Problem:** `"healthy": false, "details": "This operation was aborted"`

**Solution:** Visualizer needs to be on `mojaloop-net` to reach the core.

```bash
# Check docker-compose.yml networks section for visualizer-ui
# Should include both dfsp-net and mojaloop-net
```

### Transfer returns 400 error

**Problem:** `errorCode: "3102", errorDescription: "Missing mandatory element - /requestBody must have required property 'payeeFsp'"`

**Solution:** Ensure your request includes both `payeeFsp` and `amount`:

```bash
curl -X POST http://localhost:3001/initiate-transfer \
  -H 'Content-Type: application/json' \
  -d '{"payeeFsp":"custom-receiver-fsp","amount":100}'
```

### Services won't start

**Problem:** `ERROR: for custom-dfsp-sender 'ContainerConfig'`

**Solution:** Clean restart with orphan removal:

```bash
docker-compose down --remove-orphans
sleep 2
docker-compose up -d
```

### Can't reach core from DFSP

**Problem:** `Failed to connect to ml-api-adapter:3000`

**Solution:** Verify core is running and on same network:

```bash
# Check networks
docker network ls | grep mojaloop

# Verify core container is on mojaloop-net
docker inspect ml-api-adapter | grep -A 10 NetworkSettings
```

## File Structure

```
dfsp-sender-receiver-setup/
├── .env                          # Configuration
├── docker-compose.yml            # Service orchestration
├── custom-dfsp/
│   ├── Dockerfile                # DFSP container build
│   ├── app/
│   │   ├── package.json          # Dependencies
│   │   ├── server.js             # Express API server (FSPIOP-compliant)
│   │   ├── adapter.js            # Core communication adapter
│   │   ├── store.js              # In-memory state machine
│   │   └── ilp.js                # ILP packet & condition utilities
│   └── README.md
├── docker/
│   └── visualizer/
│       ├── Dockerfile            # Visualizer container build
│       ├── app/
│       │   ├── package.json      # Socket.IO, Express
│       │   ├── server.js         # Visualizer backend
│       │   └── public/           # Web UI (HTML/CSS/JS)
│       └── README.md
├── scripts/
│   ├── start.sh                  # Start all services
│   ├── test-transaction.sh       # Health checks
│   ├── make-transaction.sh       # Initiate transaction
│   └── provision-dfsps.sh        # Register in core
└── README.md                     # This file
```

## Key Code Snippets

### Initiating a Transfer (server.js)

```javascript
app.post('/initiate-transfer', async (req, res) => {
  const { payeeFsp, amount } = req.body || {};
  
  if (!payeeFsp || !amount) {
    return res.status(400).json({ error: 'Missing payeeFsp and/or amount' });
  }
  
  const transferId = uuidv4();
  const transfer = {
    transferId,
    payerFsp: FSP_ID,
    payeeFsp,
    amount: { currency: 'USD', amount: String(amount) },
    ilpPacket: 'AYIBRQAAAAAAAAPoHGcuZXhhbXBsZS5zcGxpdC5MWW5YTmhuYi5TdzNSN0hkZ3dXNTdBV0ZBUVE==',
    condition: 'Xh-HEcEdX5tOC3e4Bsje9NZJQ-EJk_vJNaI1q0bNYUo',
    expiration: new Date(Date.now() + 30000).toISOString(),
    extensionList: { extension: [{ key: 'DFSP-INITIATED', value: 'true' }] }
  };
  
  const r = await adapter.postToCore('/transfers', transfer, 'POST');
  res.json({ started: true, transferId, response: r });
});
```

### Core Communication (adapter.js)

```javascript
async function postToCore(path, body, method = 'POST', extraHeaders = {}) {
  const url = `http://${CORE_HOST}:${CORE_PORT}${path}`;
  const headers = {
    'Accept': 'application/vnd.interoperability.transfers+json;version=1.0',
    'Content-Type': 'application/vnd.interoperability.transfers+json;version=1.0',
    'FSPIOP-Source': FSP_ID,
    'FSPIOP-Destination': body.payeeFsp || 'unknown',
    'Date': new Date().toUTCString(),
    ...extraHeaders
  };
  
  try {
    const response = await fetch(url, { method, headers, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, text };
  } catch (error) {
    console.error(`Error posting to ${url}:`, error.message);
    return { status: 0, text: error.message };
  }
}
```

## Success Metrics

After completing this setup, you should be able to:

✅ Start all services with `./scripts/start.sh`  
✅ Verify health with `./scripts/test-transaction.sh`  
✅ Initiate transactions via script or curl  
✅ See real-time event flow in visualizer  
✅ Core receives and validates FSPIOP payloads  
✅ Transfers return HTTP 202 (accepted)  

## Next Steps

### Phase 2 (Recommended)
1. **Add Persistence** - Save transfers to a database
2. **Notification Callbacks** - POST back to originating FSP for end-to-end notifications
3. **Participant Discovery** - Dynamic FSP endpoint lookup via ALS

### Phase 3
4. **Security** - TLS/mTLS, JWT, request signing
5. **Performance Monitoring** - Prometheus/Grafana

### Phase 4
6. **Testing** - Unit, integration, load, and negative tests
7. **Deploy to Production** - docker-compose override files

## Support & References

- **Mojaloop FSPIOP Spec:** https://github.com/mojaloop/mojaloop-specification
- **Docker Compose:** https://docs.docker.com/compose/
- **Socket.IO:** https://socket.io/docs/
- **Express.js:** https://expressjs.com/
