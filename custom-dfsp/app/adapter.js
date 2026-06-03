const http = require('http');

const fspId = process.env.FSP_ID || 'customfsp';
const CORE_HOST = process.env.CORE_HOST || 'ml-api-adapter';
const CORE_PORT = process.env.CORE_PORT || '3000';
// Quotes must go through ml-api-adapter (not direct to quoting-service)
// so the async callback flow works via Kafka topics
const CORE_QUOTE_HOST = process.env.CORE_QUOTE_HOST || 'ml-api-adapter';
const CORE_QUOTE_PORT = process.env.CORE_QUOTE_PORT || '3002';
const CORE_ALS_HOST = process.env.CORE_ALS_HOST || 'account-lookup-service';
const CORE_ALS_PORT = process.env.CORE_ALS_PORT || '3001';
const ADMIN_API_URL = process.env.ADMIN_API_URL; // optional admin API
const FSPIOP_VERSION = '1.0';

/**
 * Standard HTTP Request client using Node.js built-in http module.
 * This guarantees strict control over request headers, including Accept.
 */
function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = { ...(options.headers || {}) };
    if (body && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const reqOptions = {
      method: options.method || 'GET',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers,
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          text: data,
          headers: res.headers,
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Build standard FSPIOP headers for a request.
 */
function fspiopHeaders(source, destination, contentType, extraHeaders = {}) {
  return {
    'Content-Type': contentType || `application/vnd.interoperability.transfers+json;version=${FSPIOP_VERSION}`,
    'Accept': `application/vnd.interoperability.${contentType ? 'quotes' : 'transfers'}+json;version=${FSPIOP_VERSION}`,
    'FSPIOP-Source': source,
    'FSPIOP-Destination': destination || 'mojaloop',
    'Date': new Date().toUTCString(),
    ...extraHeaders,
  };
}

/**
 * Send a request to the core transfers API (ml-api-adapter).
 */
async function postToCore(path, body, method = 'POST', extraHeaders = {}) {
  const url = `http://${CORE_HOST}:${CORE_PORT}${path}`;
  const headers = fspiopHeaders(
    fspId,
    body.payeeFsp || 'mojaloop',
    null,
    extraHeaders
  );
  console.log(`[${method}] ${url}`, JSON.stringify(body));
  try {
    const res = await httpRequest(url, { method, headers }, JSON.stringify(body));
    console.log(`Response [${res.status}]:`, res.text);
    return { status: res.status, text: res.text, headers: res.headers };
  } catch (err) {
    console.error(`HTTP error for ${url}:`, err);
    return { error: err.message };
  }
}

/**
 * Send a quote request to the core quoting service.
 * POST /quotes
 */
async function postQuote(quoteRequest) {
  const url = `http://${CORE_QUOTE_HOST}:${CORE_QUOTE_PORT}/quotes`;
  const payeeFspId = (quoteRequest.payee && quoteRequest.payee.partyIdInfo && quoteRequest.payee.partyIdInfo.fspId) || quoteRequest.payeeFsp || 'mojaloop';
  const headers = fspiopHeaders(
    fspId,
    payeeFspId,
    'application/vnd.interoperability.quotes+json;version=1.0'
  );
  console.log(`[POST] Quote ${url}`, JSON.stringify(quoteRequest));
  try {
    const res = await httpRequest(url, { method: 'POST', headers }, JSON.stringify(quoteRequest));
    console.log(`Quote Response [${res.status}]:`, res.text);
    return { status: res.status, text: res.text };
  } catch (err) {
    console.error(`HTTP error for quote ${url}:`, err);
    return { error: err.message };
  }
}

/**
 * Send a fulfilment (PUT /transfers/{id}) to core.
 */
async function putFulfilment(transferId, fulfilmentBody, destinationFspId) {
  const url = `http://${CORE_HOST}:${CORE_PORT}/transfers/${transferId}`;
  const headers = fspiopHeaders(
    fspId,
    destinationFspId || 'mojaloop',
    'application/vnd.interoperability.transfers+json;version=1.0'
  );
  delete headers['Accept']; // Remove Accept header for PUT request
  console.log(`[PUT] Fulfil ${url}`, JSON.stringify(fulfilmentBody));
  try {
    const res = await httpRequest(url, { method: 'PUT', headers }, JSON.stringify(fulfilmentBody));
    console.log(`Fulfil Response [${res.status}]:`, res.text);
    return { status: res.status, text: res.text };
  } catch (err) {
    console.error(`HTTP error for fulfil ${url}:`, err);
    return { error: err.message };
  }
}

/**
 * Register a participant in the core's participant registry.
 */
async function registerParticipant(participantFspId, callbackUrl) {
  if (!ADMIN_API_URL) return { skipped: true };
  const url = `${ADMIN_API_URL}/participants/${participantFspId}`;
  try {
    const res = await httpRequest(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    }, JSON.stringify({ fspId: participantFspId, endpoint: callbackUrl }));
    return { status: res.status, text: res.text };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Look up a participant/account via the Account Lookup Service.
 * GET /participants/{partyIdType}/{partyIdentifier}
 */
async function lookupParticipant(partyIdType, partyIdentifier) {
  const url = `http://${CORE_ALS_HOST}:${CORE_ALS_PORT}/participants/${partyIdType}/${partyIdentifier}`;
  console.log(`[GET] ALS lookup ${url}`);
  try {
    const res = await httpRequest(url, {
      headers: {
        'Accept': 'application/vnd.interoperability.participants+json;version=1.0',
        'FSPIOP-Source': fspId,
        'Date': new Date().toUTCString(),
      },
    });
    console.log(`ALS Response [${res.status}]:`, res.text);
    return { status: res.status, text: res.text };
  } catch (err) {
    console.error(`HTTP error for ALS ${url}:`, err);
    return { error: err.message };
  }
}

/**
 * Send a quote response (PUT /quotes/{id}) to core.
 */
async function putQuote(quoteId, quoteResponse, destFspId) {
  const url = `http://${CORE_QUOTE_HOST}:${CORE_QUOTE_PORT}/quotes/${quoteId}`;
  const headers = fspiopHeaders(
    fspId,
    destFspId || 'mojaloop',
    'application/vnd.interoperability.quotes+json;version=1.0'
  );
  delete headers['Accept']; // Remove Accept header for PUT request
  console.log(`[PUT] Quote ${url}`, JSON.stringify(quoteResponse));
  try {
    const res = await httpRequest(url, { method: 'PUT', headers }, JSON.stringify(quoteResponse));
    console.log(`Put Quote Response [${res.status}]:`, res.text);
    return { status: res.status, text: res.text };
  } catch (err) {
    console.error(`HTTP error for put quote ${url}:`, err);
    return { error: err.message };
  }
}

module.exports = {
  postToCore,
  postQuote,
  putQuote,
  putFulfilment,
  registerParticipant,
  lookupParticipant,
  fspiopHeaders,
};
