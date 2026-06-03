const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 4001;
const CUSTOM_DFSP_URL = process.env.CUSTOM_DFSP_URL || 'http://localhost:3001';
const CORE_ADMIN_URL = process.env.CORE_ADMIN_URL || 'http://central-ledger:3001';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory account data (would be persistent in real app)
const accountData = {
  fspId: 'custom-sender-fsp',
  accountHolder: 'Sender Bank',
  accounts: {
    'XXX': { balance: 180000, currency: 'XXX', status: 'active' }
  },
  transactions: [],
  pendingTransfers: new Map()
};

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
    pendingTransfersCount: accountData.pendingTransfers.size
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Initiate Transfer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/transfer', async (req, res) => {
  const { payeeFsp, amount, currency, description } = req.body;

  if (!payeeFsp || !amount || !currency) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const account = accountData.accounts[currency];
  if (!account) {
    return res.status(400).json({ error: `Currency ${currency} not supported` });
  }

  if (account.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  try {
    // Call custom DFSP backend
    const response = await axios.post(`${CUSTOM_DFSP_URL}/initiate-transfer`, {
      payeeFsp,
      amount,
      currency: currency || 'XXX'
    }, { timeout: 10000 });

    const transferId = response.data.transferId;

    // Deduct from balance immediately (optimistic)
    account.balance -= amount;

    // Record transaction
    const transaction = {
      id: transferId,
      type: 'TRANSFER_SENT',
      fromFsp: accountData.fspId,
      toFsp: payeeFsp,
      amount,
      currency,
      description: description || 'Transfer',
      timestamp: new Date().toISOString(),
      status: 'PENDING',
      quoteId: response.data.quoteId
    };

    accountData.transactions.push(transaction);
    accountData.pendingTransfers.set(transferId, transaction);

    res.json({
      success: true,
      transferId,
      quoteId: response.data.quoteId,
      message: 'Transfer initiated successfully',
      transaction
    });
  } catch (error) {
    console.error('Transfer initiation error:', error.message);
    // Restore balance if transfer failed
    account.balance += amount;
    res.status(500).json({ error: 'Failed to initiate transfer', details: error.message });
  }
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
// Update Transfer Status (Callback from Backend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/api/update-transfer', (req, res) => {
  const { transferId, status } = req.body;
  if (!transferId || !status) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const transaction = accountData.transactions.find(t => t.id === transferId);
  if (transaction) {
    const oldStatus = transaction.status;
    transaction.status = status;
    console.log(`[Transfer Update] Transfer ${transferId} status updated: ${oldStatus} -> ${status}`);

    // If a pending transfer fails or is expired, we need to refund the optimistic debit
    if (oldStatus === 'PENDING' && (status === 'FAILED' || status === 'EXPIRED')) {
      const account = accountData.accounts[transaction.currency];
      if (account) {
        account.balance += transaction.amount;
        console.log(`[Refund] Refunded ${transaction.amount} ${transaction.currency} for transfer ${transferId}. New balance: ${account.balance}`);
      }
    }
    
    // Also remove from pending if no longer pending
    if (status !== 'PENDING') {
      accountData.pendingTransfers.delete(transferId);
    }
  }

  res.json({ success: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Transaction History
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/api/transactions', (req, res) => {
  const { currency, status, limit = 20 } = req.query;
  let transactions = accountData.transactions;

  if (currency) {
    transactions = transactions.filter(t => t.currency === currency);
  }
  if (status) {
    transactions = transactions.filter(t => t.status === status);
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
  console.log(`\n✓ Sender DFSP Banking UI running on http://localhost:${PORT}`);
  console.log(`✓ Backend DFSP: ${CUSTOM_DFSP_URL}`);
  console.log(`✓ Core Admin: ${CORE_ADMIN_URL}\n`);
});
