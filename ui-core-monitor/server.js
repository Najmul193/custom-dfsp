const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 4003;
const CENTRAL_LEDGER_URL = process.env.CENTRAL_LEDGER_URL || 'http://central-ledger:3001';
const ML_API_ADAPTER_URL = process.env.ML_API_ADAPTER_URL || 'http://ml-api-adapter:3000';
const QUOTING_SERVICE_URL = process.env.QUOTING_SERVICE_URL || 'http://quoting-service:3002';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory settlement ledger
const settlementLedger = {
  participants: new Map(),
  transfers: [],
  transfersMap: new Map(),
  settlements: [],
  positions: new Map()
};

// Initialize sample participants
function initializeParticipants() {
  const participants = [
    { id: 'custom-sender-fsp', name: 'Sender Bank', status: 'active' },
    { id: 'custom-receiver-fsp', name: 'Receiver Bank', status: 'active' },
    { id: 'mojaloop-hub', name: 'Mojaloop Hub', status: 'active' }
  ];

  participants.forEach(p => {
    settlementLedger.participants.set(p.id, p);
    // Initialize positions for XXX currency only
    settlementLedger.positions.set(`${p.id}:XXX`, { fspId: p.id, currency: 'XXX', position: 0 });
  });
}

initializeParticipants();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Settlement Ledger API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/settlement/positions', (req, res) => {
  const positions = Array.from(settlementLedger.positions.values());
  res.json({ positions });
});

app.get('/api/settlement/positions/:fspId', (req, res) => {
  const fspId = req.params.fspId;
  const positions = Array.from(settlementLedger.positions.values())
    .filter(p => p.fspId === fspId);
  res.json({ fspId, positions });
});

app.post('/api/settlement/record-transfer', (req, res) => {
  const { transferId, payerFsp, payeeFsp, amount, currency, status } = req.body;

  if (!transferId || !payerFsp || !payeeFsp || !amount || !currency) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const newStatus = status || 'PENDING';
  const existingTransfer = settlementLedger.transfersMap.get(transferId);

  const payerKey = `${payerFsp}:${currency}`;
  const payeeKey = `${payeeFsp}:${currency}`;
  const payerPos = settlementLedger.positions.get(payerKey);
  const payeePos = settlementLedger.positions.get(payeeKey);

  if (!existingTransfer) {
    // New transfer
    const transfer = {
      transferId,
      payerFsp,
      payeeFsp,
      amount,
      currency,
      status: newStatus,
      timestamp: new Date().toISOString()
    };

    settlementLedger.transfers.push(transfer);
    settlementLedger.transfersMap.set(transferId, transfer);

    // Update positions if it's an active status
    if (newStatus !== 'FAILED' && newStatus !== 'EXPIRED') {
      if (payerPos) payerPos.position -= amount;
      if (payeePos) payeePos.position += amount;
      console.log(`[Ledger] New transfer ${transferId} (${amount} ${currency}): ${payerFsp} -> ${payeeFsp}. Status: ${newStatus}`);
    }
  } else {
    // Existing transfer
    const oldStatus = existingTransfer.status;
    existingTransfer.status = newStatus;
    
    // Update the status of the transfer in the array too
    const arrayTx = settlementLedger.transfers.find(t => t.transferId === transferId);
    if (arrayTx) {
      arrayTx.status = newStatus;
    }

    const wasActive = oldStatus !== 'FAILED' && oldStatus !== 'EXPIRED';
    const isActive = newStatus !== 'FAILED' && newStatus !== 'EXPIRED';

    if (wasActive && !isActive) {
      // Revert position updates
      if (payerPos) payerPos.position += amount;
      if (payeePos) payeePos.position -= amount;
      console.log(`[Ledger] Reverted positions for failed/expired transfer ${transferId}.`);
    } else if (!wasActive && isActive) {
      // Apply position updates if transitioning from inactive to active
      if (payerPos) payerPos.position -= amount;
      if (payeePos) payeePos.position += amount;
      console.log(`[Ledger] Applied positions for reactivated transfer ${transferId}.`);
    } else {
      console.log(`[Ledger] Transfer ${transferId} status updated: ${oldStatus} -> ${newStatus}`);
    }
  }

  res.json({
    success: true,
    message: 'Transfer recorded in settlement ledger'
  });
});

app.put('/api/settlement/finalize', (req, res) => {
  const { settlementId } = req.body;

  const settlement = {
    id: settlementId || `SETTLEMENT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    status: 'COMPLETED',
    transfers: settlementLedger.transfers.length,
    totalAmount: settlementLedger.transfers.reduce((sum, t) => sum + t.amount, 0),
    positions: Array.from(settlementLedger.positions.values())
  };

  settlementLedger.settlements.push(settlement);

  // Clear transfers after settlement
  settlementLedger.transfers = [];
  settlementLedger.transfersMap.clear();

  res.json({
    success: true,
    settlement,
    message: 'Settlement finalized'
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Health Endpoint (UI Container check)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', ui: 'healthy', timestamp: new Date().toISOString() });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Core Services Health
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/core/health', async (req, res) => {
  const services = {
    'central-ledger': { url: CENTRAL_LEDGER_URL, port: 3001 },
    'ml-api-adapter': { url: ML_API_ADAPTER_URL, port: 3000 },
    'quoting-service': { url: QUOTING_SERVICE_URL, port: 3002 }
  };

  const health = {};

  for (const [name, service] of Object.entries(services)) {
    try {
      const response = await axios.get(`${service.url}/health`, { timeout: 2000 });
      health[name] = { status: 'healthy', statusCode: response.status };
    } catch (error) {
      health[name] = { status: 'unhealthy', error: error.message };
    }
  }

  res.json({ services: health, timestamp: new Date().toISOString() });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Transfer Ledger
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/transfers', (req, res) => {
  const { status, limit = 50 } = req.query;
  let transfers = settlementLedger.transfers;

  if (status) {
    transfers = transfers.filter(t => t.status === status);
  }

  res.json({
    total: transfers.length,
    transfers: transfers.slice(-limit).reverse()
  });
});

app.get('/api/settlements', (req, res) => {
  res.json({
    total: settlementLedger.settlements.length,
    settlements: settlementLedger.settlements.slice(-10).reverse()
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Participants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/participants', (req, res) => {
  const participants = Array.from(settlementLedger.participants.values());
  res.json({
    total: participants.length,
    participants
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Dashboard Stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/dashboard', (req, res) => {
  const pendingTransfers = settlementLedger.transfers.filter(t => t.status === 'PENDING').length;
  const committedTransfers = settlementLedger.transfers.filter(t => t.status === 'COMMITTED').length;
  const totalAmount = settlementLedger.transfers.reduce((sum, t) => sum + t.amount, 0);

  res.json({
    pendingTransfers,
    committedTransfers,
    totalTransfers: settlementLedger.transfers.length,
    totalAmount,
    completedSettlements: settlementLedger.settlements.length,
    activeParticipants: settlementLedger.participants.size,
    positions: Array.from(settlementLedger.positions.values())
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Serve HTML
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✓ Mojaloop Core Monitor running on http://localhost:${PORT}`);
  console.log(`✓ Central Ledger: ${CENTRAL_LEDGER_URL}`);
  console.log(`✓ ML API Adapter: ${ML_API_ADAPTER_URL}`);
  console.log(`✓ Quoting Service: ${QUOTING_SERVICE_URL}\n`);
});
