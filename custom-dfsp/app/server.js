const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const adapter = require('./adapter');
const store = require('./store');
const ilp = require('./ilp');

const app = express();
app.use(cors());
// Accept all content types as JSON since FSPIOP uses vendor-specific types
app.use(express.json({ type: '*/*' }));
app.use((err, req, res, next) => {
  if (!err) return next();
  console.error('[Request Parse Error]', req.method, req.path, err.type || err.name, err.message);
  return res.status(400).json(ilp.fspiopError('3102', `Invalid JSON request body: ${err.message}`));
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const FSP_ID = process.env.FSP_ID || 'customfsp';
const VISUALIZER_URL = process.env.VISUALIZER_URL; // e.g. http://visualizer:3000/events
const AUTO_FULFIL = (process.env.AUTO_FULFIL || 'true') === 'true';

// ── Event broadcasting to visualizer ──────────────────────────────────────

async function sendEvent(event) {
  if (!VISUALIZER_URL) return;
  try {
    await fetch(VISUALIZER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch (err) {
    console.error('Failed to send event to visualizer', err.message);
  }
}

// ── Health check ──────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'OK', fspId: FSP_ID });
});

// ── Status endpoint (for visualizer) ─────────────────────────────────────

app.get('/status', (req, res) => {
  res.json({
    fspId: FSP_ID,
    uptime: process.uptime(),
    transferCount: store.getAllTransfers().length,
    quoteCount: store.getAllQuotes().length,
  });
});

// ── Initiate a full FSPIOP-compliant transfer ────────────────────────────
// Step 1: Generate ILP packet + condition
// Step 2: POST quote request to core quoting service
// Step 3: Wait for quote callback (PUT /quotes/{id})
// Step 4: POST transfer prepare to core transfers API
// Step 5: Wait for fulfilment callback (PUT /transfers/{id})

app.post('/initiate-transfer', async (req, res) => {
  const { payeeFsp, amount, currency } = req.body || {};

  if (!payeeFsp || !amount) {
    return res.status(400).json(ilp.fspiopError('3102', 'Missing required fields: payeeFsp and/or amount'));
  }

  const transferId = uuidv4();
  const quoteId = uuidv4();
  const cur = currency || 'XXX';
  const { fulfilment, condition } = ilp.generateFulfilmentAndCondition();
  const ilpPacket = ilp.generateIlpPacket(String(amount), cur, FSP_ID, payeeFsp);
  const expiration = new Date(Date.now() + 60000).toISOString(); // 60s expiry

  // Create quote in store
  store.createQuote(quoteId, {
    transferId,
    payerFsp: FSP_ID,
    payeeFsp,
    amount: { currency: cur, amount: String(amount) },
    expiration,
    condition,
    ilpPacket,
    fulfilment, // stored locally for later validation
  });

  // Create transfer in store (PENDING)
  store.createTransfer(transferId, {
    quoteId,
    payerFsp: FSP_ID,
    payeeFsp,
    amount: { currency: cur, amount: String(amount) },
    expiration,
    condition,
    fulfilment,
    ilpPacket,
  });

  // Build the quote request per FSPIOP spec
  const quoteRequest = {
    quoteId,
    transactionId: transferId,
    amountType: 'SEND',
    amount: { currency: cur, amount: String(amount) },
    expiration,
    transactionType: { scenario: 'TRANSFER', initiator: 'PAYER', initiatorType: 'CONSUMER' },
    payer: {
      partyIdInfo: {
        partyIdType: 'MSISDN',
        partyIdentifier: '1234567890',
        fspId: FSP_ID,
      },
    },
    payee: {
      partyIdInfo: {
        partyIdType: 'MSISDN',
        partyIdentifier: '9876543210',
        fspId: payeeFsp,
      },
    },
  };

  console.log(`[Initiate] Quote ${quoteId} for transfer ${transferId}: ${amount} ${cur} ${FSP_ID} -> ${payeeFsp}`);
  sendEvent({
    id: transferId,
    fspId: FSP_ID,
    type: 'quote-request',
    body: quoteRequest,
  });

  // Send quote request to core
  const quoteRes = await adapter.postQuote(quoteRequest);
  store.updateQuote(quoteId, { coreResponse: quoteRes });

  // If core accepted the quote (HTTP 202), we can proceed
  // The quote response comes asynchronously via PUT /quotes/{id} callback
  res.json({
    started: true,
    transferId,
    quoteId,
    quoteResponse: quoteRes,
    message: 'Quote submitted to core. Awaiting async quote callback and transfer fulfilment.',
  });
});

// ── Receive quote request from another DFSP (inbound) ────────────────────

app.post('/quotes', async (req, res) => {
  const quote = req.body;
  const quoteId = quote.quoteId || uuidv4();
  const payerFsp = quote.payer?.partyIdInfo?.fspId || quote.payerFsp || 'unknown';

  console.log(`[Inbound Quote] Received quote ${quoteId} from ${payerFsp}`);
  console.log(`[DEBUG] Full quote body:`, JSON.stringify(quote));
  sendEvent({
    id: quoteId,
    fspId: FSP_ID,
    type: 'inbound-quote',
    body: quote,
  });

  // Respond immediately with 202 Accepted (per FSPIOP spec, body should be empty)
  res.sendStatus(202);

  // Asynchronously generate the quote response and send it back to the switch via PUT /quotes/{id}
  setTimeout(async () => {
    try {
      const { fulfilment, condition } = ilp.generateFulfilmentAndCondition();
      const ilpPacket = ilp.generateIlpPacket(
        quote.amount?.amount || '0',
        quote.amount?.currency || 'USD',
        payerFsp,
        FSP_ID
      );
      const expiration = new Date(Date.now() + 60000).toISOString();

      store.createQuote(quoteId, {
        ...quote,
        state: store.QUOTE_STATES.ACCEPTED,
        condition,
        ilpPacket,
        fulfilment,
        expiration,
      });

      const quoteResponse = {
        transferAmount: {
          currency: quote.amount?.currency || 'USD',
          amount: quote.amount?.amount || '0',
        },
        ilpPacket,
        condition,
        expiration,
      };

      console.log(`[Inbound Quote] Sending PUT /quotes/${quoteId} to core for payer ${payerFsp}`);
      const putRes = await adapter.putQuote(quoteId, quoteResponse, payerFsp);

      sendEvent({
        id: quoteId,
        fspId: FSP_ID,
        type: 'quote-response-sent',
        body: quoteResponse,
        response: putRes,
      });
    } catch (err) {
      console.error(`[Inbound Quote] Error processing quote response for ${quoteId}:`, err);
    }
  }, 1000);
});

// ── Receive quote response callback (PUT /quotes/{id}) from core ─────────

app.put('/quotes/:id', async (req, res) => {
  const quoteId = req.params.id;
  const quoteResponse = req.body;

  console.log(`[Quote Callback] PUT /quotes/${quoteId}`, JSON.stringify(quoteResponse));
  sendEvent({
    id: quoteId,
    fspId: FSP_ID,
    type: 'quote-callback',
    body: quoteResponse,
  });

  const quote = store.getQuote(quoteId);
  if (!quote) {
    return res.status(404).json(ilp.fspiopError('3200', 'Quote not found'));
  }

  store.updateQuote(quoteId, {
    state: store.QUOTE_STATES.ACCEPTED,
    callbackBody: quoteResponse,
  });

  // If the quote was accepted (has ilpPacket + condition from payee DFSP),
  // proceed to prepare the transfer
  if (quoteResponse.ilpPacket && quoteResponse.condition) {
    const transferBody = {
      transferId: quote.transferId,
      payerFsp: quote.payerFsp,
      payeeFsp: quote.payeeFsp,
      amount: quote.amount,
      ilpPacket: quoteResponse.ilpPacket,
      condition: quoteResponse.condition,
      expiration: quote.expiration,
      extensionList: {
        extension: [{ key: 'QUOTE_ACCEPTED', value: 'true' }],
      },
    };

    console.log(`[Transfer Prepare] Sending transfer ${quote.transferId} to core`);
    const transferRes = await adapter.postToCore('/transfers', transferBody, 'POST');

    store.updateTransfer(quote.transferId, {
      state: store.TRANSFER_STATES.PREPARED,
      ilpPacket: quoteResponse.ilpPacket,
      condition: quoteResponse.condition,
      coreTransferResponse: transferRes,
    });

    sendEvent({
      id: quote.transferId,
      fspId: FSP_ID,
      type: 'transfer-prepare',
      body: transferBody,
      response: transferRes,
    });
  }

  res.status(200).json({ received: true, quoteId });
});

// ── Receive transfer prepare request from core (inbound) ─────────────────

app.post('/transfers', async (req, res) => {
  const transfer = req.body;
  const transferId = transfer.transferId || uuidv4();
  const matchingQuote = store.getAllQuotes().find((quote) => (
    quote.transactionId === transferId ||
    quote.transferId === transferId ||
    quote.condition === transfer.condition
  ));

  console.log(`[Inbound Transfer] Received transfer ${transferId} from ${transfer.payerFsp}`);
  sendEvent({
    id: transferId,
    fspId: FSP_ID,
    type: 'inbound-transfer',
    body: transfer,
  });

  store.createTransfer(transferId, {
    ...transfer,
    state: store.TRANSFER_STATES.PREPARED,
    fulfilment: matchingQuote?.fulfilment,
  });

  // Auto-fulfil: simulate fulfilling the transfer after a short delay
  if (AUTO_FULFIL) {
    res.sendStatus(202);

    setTimeout(async () => {
      if (store.isTransferExpired(transferId)) {
        console.log(`[Fulfil] Transfer ${transferId} expired, skipping`);
        store.updateTransfer(transferId, { state: store.TRANSFER_STATES.EXPIRED });
        return;
      }

      const fulfilment = matchingQuote?.fulfilment || store.getTransfer(transferId)?.fulfilment;
      if (!fulfilment) {
        console.error(`[Fulfil] No fulfilment found for transfer ${transferId}`);
        store.updateTransfer(transferId, {
          state: store.TRANSFER_STATES.FAILED,
          fulfilmentError: 'Missing fulfilment for quoted condition',
        });
        return;
      }

      const fulfilmentBody = {
        fulfilment,
        completedTimestamp: new Date().toISOString(),
        transferState: 'COMMITTED',
      };

      console.log(`[Fulfil] Sending fulfilment for transfer ${transferId}`);
      const fulfilRes = await adapter.putFulfilment(transferId, fulfilmentBody, transfer.payerFsp);

      store.updateTransfer(transferId, {
        state: store.TRANSFER_STATES.COMMITTED,
        fulfilment,
        fulfilmentResponse: fulfilRes,
      });

      sendEvent({
        id: transferId,
        fspId: FSP_ID,
        type: 'fulfil',
        body: fulfilmentBody,
        response: fulfilRes,
      });
    }, 2000);
  } else {
    res.sendStatus(202);
  }
});

// ── Receive transfer fulfilment callback from core (PUT /transfers/{id}) ─

app.put('/transfers/:id', async (req, res) => {
  const transferId = req.params.id;
  const fulfilBody = req.body;

  console.log(`[Fulfil Callback] PUT /transfers/${transferId}`, JSON.stringify(fulfilBody));
  sendEvent({
    id: transferId,
    fspId: FSP_ID,
    type: 'fulfil-callback',
    body: fulfilBody,
  });

  const transfer = store.getTransfer(transferId);
  if (!transfer) {
    return res.status(404).json(ilp.fspiopError('3200', 'Transfer not found'));
  }

  // Validate fulfilment against stored condition
  if (fulfilBody.fulfilment && transfer.condition) {
    const isValid = ilp.validateFulfilment(fulfilBody.fulfilment, transfer.condition);
    console.log(`[Fulfil Validation] Transfer ${transferId}: ${isValid ? 'VALID' : 'INVALID'}`);

    if (!isValid) {
      store.updateTransfer(transferId, {
        state: store.TRANSFER_STATES.FAILED,
        fulfilmentError: 'Condition mismatch',
      });
      sendEvent({
        id: transferId,
        fspId: FSP_ID,
        type: 'fulfil-error',
        body: { error: 'Condition mismatch' },
      });
      return res.status(400).json(ilp.fspiopError('3100', 'Fulfilment does not match condition'));
    }
  }

  store.updateTransfer(transferId, {
    state: store.TRANSFER_STATES.COMMITTED,
    fulfilment: fulfilBody.fulfilment,
    completedTimestamp: fulfilBody.completedTimestamp,
  });

  res.status(200).json({ received: true, transferId });
});

// ── Receive transfer error callback from core ────────────────────────────

app.put('/transfers/:id/error', async (req, res) => {
  const transferId = req.params.id;
  const errorBody = req.body;

  console.log(`[Transfer Error] PUT /transfers/${transferId}/error`, JSON.stringify(errorBody));
  sendEvent({
    id: transferId,
    fspId: FSP_ID,
    type: 'transfer-error',
    body: errorBody,
  });

  store.updateTransfer(transferId, {
    state: store.TRANSFER_STATES.FAILED,
    errorInfo: errorBody.errorInformation,
  });

  res.status(200).json({ received: true, transferId });
});

// ── Generic catch-all callback handler ──────────────────────────────────

app.post('*', async (req, res) => {
  const payload = { path: req.path, method: req.method, body: req.body, fspId: FSP_ID };
  console.log('Callback POST:', payload);
  sendEvent({ ...payload, type: 'callback' });
  res.status(200).json({ ok: true });
});

app.put('*', async (req, res) => {
  const payload = { path: req.path, method: req.method, body: req.body, fspId: FSP_ID };
  console.log('Callback PUT:', payload);
  sendEvent({ ...payload, type: 'callback' });
  res.status(200).json({ ok: true });
});

// ── Start server ────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`${FSP_ID} running on ${PORT}`);
  // Periodically clean up expired state
  setInterval(() => store.cleanup(), 60000);
});
