/**
 * In-memory state machine for transfers and quotes.
 * Tracks lifecycle: PENDING -> PREPARED -> COMMITTED / FAILED
 */

const state = {
  quotes: new Map(),
  transfers: new Map(),
};

const TRANSFER_STATES = {
  PENDING: 'PENDING',
  PREPARED: 'PREPARED',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
};

const QUOTE_STATES = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
};

function createQuote(id, data) {
  state.quotes.set(id, {
    ...data,
    id,
    state: QUOTE_STATES.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return state.quotes.get(id);
}

function getQuote(id) {
  return state.quotes.get(id);
}

function updateQuote(id, updates) {
  const q = state.quotes.get(id);
  if (!q) return null;
  Object.assign(q, updates, { updatedAt: new Date().toISOString() });
  return q;
}

function createTransfer(id, data) {
  state.transfers.set(id, {
    ...data,
    id,
    state: TRANSFER_STATES.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return state.transfers.get(id);
}

function getTransfer(id) {
  return state.transfers.get(id);
}

function updateTransfer(id, updates) {
  const t = state.transfers.get(id);
  if (!t) return null;
  Object.assign(t, updates, { updatedAt: new Date().toISOString() });
  return t;
}

function getAllTransfers() {
  return Array.from(state.transfers.values());
}

function getAllQuotes() {
  return Array.from(state.quotes.values());
}

function isQuoteExpired(id) {
  const q = state.quotes.get(id);
  if (!q || !q.expiration) return false;
  return new Date(q.expiration) < new Date();
}

function isTransferExpired(id) {
  const t = state.transfers.get(id);
  if (!t || !t.expiration) return false;
  return new Date(t.expiration) < new Date();
}

// Cleanup expired entries older than 1 hour
function cleanup() {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, q] of state.quotes) {
    if (new Date(q.createdAt).getTime() < oneHourAgo) state.quotes.delete(id);
  }
  for (const [id, t] of state.transfers) {
    if (new Date(t.createdAt).getTime() < oneHourAgo) state.transfers.delete(id);
  }
}

module.exports = {
  TRANSFER_STATES,
  QUOTE_STATES,
  createQuote,
  getQuote,
  updateQuote,
  createTransfer,
  getTransfer,
  updateTransfer,
  getAllTransfers,
  getAllQuotes,
  isQuoteExpired,
  isTransferExpired,
  cleanup,
};