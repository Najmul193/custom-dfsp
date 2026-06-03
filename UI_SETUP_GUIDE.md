# UI Banking Portals & Core Monitor Setup

## Overview

Three independent banking UIs have been created alongside your existing DFSP setup. **Your working system is untouched.** Each UI runs on a separate port with isolated resources.

## Available UIs

### 1. **Sender DFSP Banking UI** (Port 4001)
**Location:** `ui-sender-dfsp/`
**URL:** `http://localhost:4001`

Features:
- 💰 Account dashboard with multi-currency balance display
- 📤 Transfer initiation form
- 📋 Transaction history with status tracking
- 🔄 Real-time balance updates (3s refresh)
- ✅ Direct integration with custom-dfsp-sender backend

**Accounts Available:**
- USD: 50,000
- XXX: 100,000
- EUR: 30,000

---

### 2. **Receiver DFSP Banking UI** (Port 4002)
**Location:** `ui-receiver-dfsp/`
**URL:** `http://localhost:4002`

Features:
- 💰 Account dashboard with incoming transfers display
- 📥 Real-time incoming transfer notifications
- 📊 Activity summary with received transfer counts
- 🔄 Automatic balance updates (3s refresh)
- ✅ Direct integration with custom-dfsp-receiver backend

**Accounts Available:**
- USD: 75,000
- XXX: 150,000
- EUR: 45,000

---

### 3. **Mojaloop Core Monitor & Settlement** (Port 4003)
**Location:** `ui-core-monitor/`
**URL:** `http://localhost:4003`

Features:
- 🔍 Real-time settlement position monitoring
- 💼 Multi-currency position ledger (USD, XXX, EUR)
- 📊 Transfer ledger with status tracking
- 🟢 Core service health dashboard
- 👥 Registered participants list
- 📑 Settlement batch finalization
- 🔄 Auto-refresh (2s for transfers, dashboard)

**Monitored Services:**
- Central Ledger (port 3001)
- ML API Adapter (port 3000)
- Quoting Service (port 3002)

---

## Quick Start - Local Development

### Option 1: Run UIs Without Docker (Fastest)

```bash
cd dfsp-sender-receiver-setup

# Install dependencies for all UIs
cd ui-sender-dfsp && npm install && cd ..
cd ui-receiver-dfsp && npm install && cd ..
cd ui-core-monitor && npm install && cd ..

# Run in separate terminals
cd ui-sender-dfsp && npm start      # http://localhost:4001
cd ui-receiver-dfsp && npm start    # http://localhost:4002
cd ui-core-monitor && npm start     # http://localhost:4003
```

### Option 2: Run with Docker Compose (With existing setup)

```bash
# Start new UIs alongside existing DFSP services
docker-compose -f docker-compose.yml -f docker-compose-ui.yml up -d

# Verify all services
docker ps | grep -E "(custom-dfsp|ui-|visualizer)"
```

### Option 3: Start UIs Only

```bash
# Only UI services
docker-compose -f docker-compose-ui.yml up -d
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (Host)                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Sender UI         Receiver UI        Core Monitor         │
│  :4001             :4002              :4003                │
│    │                  │                   │                │
│    ↓                  ↓                   ↓                │
├────────────────────────────────────────────────────────────┤
│                   Docker Network                           │
│                                                             │
│  custom-dfsp-sender  custom-dfsp-receiver  Core Services   │
│  :3001              :3002              :3000-3002          │
│    │                  │                   │                │
│    ↓                  ↓                   ↓                │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  Mojaloop Core (external network: mojaloop-net)           │
│  - ml-api-adapter, quoting-service, central-ledger        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Features

### Sender UI (4001)
1. **Dashboard** - View total balance across all currencies
2. **Send Transfer** - Create transfers to any DFSP
   - Recipient FSP ID: `custom-receiver-fsp`
   - Amount and currency selection
   - Optional description
3. **Recent Transactions** - View sent transfers with status
   - PENDING: Awaiting processing
   - COMMITTED: Successfully transferred

### Receiver UI (4002)
1. **Account Overview** - View received balance
2. **Incoming Transfers** - Auto-populated when transfers arrive
3. **Activity Summary** - Total count and amount of transfers
4. **No action required** - Automatically fulfills transfers

### Core Monitor (4003)
1. **KPI Dashboard**
   - Pending transfers count
   - Committed transfers count
   - Total transfer amount
   - Active participant count

2. **Settlement Positions**
   - Real-time position tracking per currency
   - Positive/negative balance display
   - All participant positions

3. **Service Health**
   - Central Ledger health
   - ML API Adapter status
   - Quoting Service status

4. **Transfer Ledger**
   - All recorded transfers
   - Payer/payee information
   - Amount and currency
   - Transfer status

5. **Settlement Batch**
   - Finalize settlements with one click
   - Clears transfer ledger
   - Records settlement entry

---

## Testing Workflow

### Test 1: Send a Transfer
1. Open **Sender UI** (http://localhost:4001)
2. Fill form:
   - Recipient: `custom-receiver-fsp`
   - Amount: `100`
   - Currency: `XXX`
3. Click "Send Transfer"
4. Check status changes: PENDING → COMMITTED

### Test 2: Receive the Transfer
1. Open **Receiver UI** (http://localhost:4002)
2. Watch for incoming transfer in "Incoming Transfers" section
3. Verify balance increases

### Test 3: Monitor Settlement
1. Open **Core Monitor** (http://localhost:4003)
2. Observe transfer in "Transfer Ledger"
3. Check participant positions update
4. Click "Finalize Settlement Batch" to settle

---

## Environment Variables

All UIs are pre-configured to connect to the local DFSP/Core. You can override:

**Sender UI (4001)**
```bash
CUSTOM_DFSP_URL=http://custom-dfsp-sender:3001
CORE_ADMIN_URL=http://central-ledger:3001
```

**Receiver UI (4002)**
```bash
CUSTOM_DFSP_URL=http://custom-dfsp-receiver:3002
```

**Core Monitor (4003)**
```bash
CENTRAL_LEDGER_URL=http://central-ledger:3001
ML_API_ADAPTER_URL=http://ml-api-adapter:3000
QUOTING_SERVICE_URL=http://quoting-service:3002
```

---

## API Endpoints

### Sender UI APIs
- `GET /api/dashboard` - Account overview
- `GET /api/accounts` - All accounts
- `POST /api/transfer` - Send transfer
- `GET /api/transactions` - Transaction history
- `GET /api/health` - Health check

### Receiver UI APIs
- `GET /api/dashboard` - Account overview
- `POST /api/receive-transfer` - Receive transfer (internal)
- `GET /api/transactions` - Transaction history
- `GET /api/health` - Health check

### Core Monitor APIs
- `GET /api/dashboard` - KPI stats
- `GET /api/settlement/positions` - All participant positions
- `POST /api/settlement/record-transfer` - Record transfer
- `PUT /api/settlement/finalize` - Finalize settlement batch
- `GET /api/core/health` - Core services health
- `GET /api/transfers` - Transfer ledger
- `GET /api/participants` - Registered participants

---

## Important Notes

⚠️ **Your existing system remains unchanged:**
- Original `docker-compose.yml` unchanged
- All existing containers (sender-dfsp, receiver-dfsp, etc.) still work
- New UIs run independently

✅ **Safe to run alongside:**
- UIs use new ports (4001-4003)
- Separate node services
- No modifications to core DFSP code

🔄 **Data persistence:**
- UI data is in-memory for now
- Ideal for prototype/demo
- Can be extended with database backend

---

## Troubleshooting

**UI not connecting to DFSP?**
```bash
# Check DFSP is running
docker ps | grep custom-dfsp

# Check network connectivity
docker network inspect dfsp-net
```

**Transfers not showing up?**
- Ensure sender and receiver UIs are both running
- Check Core Monitor for transfer ledger entry
- Verify Mojaloop core services are healthy

**Settlement won't finalize?**
- Ensure at least one transfer exists
- Check Core Monitor → Core Services health
- Review browser console for errors

---

## Next Steps

1. Test the system with multiple transfers
2. Monitor settlement batch processing
3. Implement persistent database for production
4. Add user authentication
5. Enhance UI with charts and analytics
6. Integrate with real Mojaloop core endpoints

---

Created: June 3, 2026
System: Fully isolated, non-breaking UI additions
Status: Ready for testing and integration
