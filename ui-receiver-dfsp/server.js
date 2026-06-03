const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 4002;
const CUSTOM_DFSP_URL = process.env.CUSTOM_DFSP_URL || 'http://localhost:3002';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory account data
const accountData = {
  fspId: 'custom-receiver-fsp',
  accountHolder: 'Receiver Bank',
  accounts: {
    'XXX': { balance: 270000, currency: 'XXX', status: 'active' }
  },
  transactions: [],
  incomingTransfers: new Map()
};

// Simulate incoming transfers
setInterval(() => {
  // Check DFSP status periodically
}, 5000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Dashboard API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/dashboard', (req, res) => {
  const totalBalance = Object.values(accountData.accounts).reduce((sum, acc) => sum + acc.balance, 0);
  res.json({
    fspId: accountData.fspId,
    accountHolder: accountData.accountHolder,
    totalBalance,
    accounts: accountData.accounts,
    recentTransactions: accountData.transactions.slice(-5).reverse(),
    incomingTransfersCount: accountData.incomingTransfers.size
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Receive Incoming Transfer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/receive-transfer', (req, res) => {
  const { transferId, fromFsp, amount, currency, description } = req.body;

  if (!transferId || !fromFsp || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Idempotency check: if transfer is already processed, return success without double-crediting
  if (accountData.incomingTransfers.has(transferId)) {
    console.log(`[Idempotency] Incoming transfer ${transferId} already processed, ignoring duplicate.`);
    return res.json({
      success: true,
      transferId,
      message: 'Transfer already processed (duplicate ignored)'
    });
  }

  const account = accountData.accounts[currency];
  if (!account) {
    return res.status(400).json({ error: `Currency ${currency} not supported` });
  }

  // Add to balance
  account.balance += amount;

  // Record transaction
  const transaction = {
    id: transferId,
    type: 'TRANSFER_RECEIVED',
    fromFsp,
    toFsp: accountData.fspId,
    amount,
    currency,
    description: description || 'Incoming Transfer',
    timestamp: new Date().toISOString(),
    status: 'COMMITTED'
  };

  accountData.transactions.push(transaction);
  accountData.incomingTransfers.set(transferId, transaction);

  res.json({
    success: true,
    transferId,
    message: 'Transfer received and credited'
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Transfer Status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/transfer/:transferId', (req, res) => {
  const transfer = accountData.transactions.find(t => t.id === req.params.transferId);
  if (!transfer) {
    return res.status(404).json({ error: 'Transfer not found' });
  }
  res.json(transfer);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Transaction History
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/transactions', (req, res) => {
  const { currency, type, limit = 20 } = req.query;
  let transactions = accountData.transactions;

  if (currency) {
    transactions = transactions.filter(t => t.currency === currency);
  }
  if (type) {
    transactions = transactions.filter(t => t.type === type);
  }

  res.json({
    total: transactions.length,
    transactions: transactions.slice(-limit).reverse()
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Accounts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/accounts', (req, res) => {
  res.json({
    fspId: accountData.fspId,
    accounts: Object.entries(accountData.accounts).map(([curr, data]) => ({
      currency: curr,
      ...data
    }))
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Health & Status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/health', async (req, res) => {
  try {
    const dfspStatus = await axios.get(`${CUSTOM_DFSP_URL}/health`, { timeout: 2000 });
    res.json({
      ui: 'healthy',
      dfspBackend: dfspStatus.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      ui: 'healthy',
      dfspBackend: 'unreachable',
      error: error.message
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Serve HTML
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✓ Receiver DFSP Banking UI running on http://localhost:${PORT}`);
  console.log(`✓ Backend DFSP: ${CUSTOM_DFSP_URL}\n`);
});
