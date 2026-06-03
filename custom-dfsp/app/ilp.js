/**
 * ILP (Interledger Protocol) packet generation and
 * condition/fulfilment utilities using Node.js crypto.
 *
 * In a real DFSP this would use the `ilp-packet` library,
 * but here we construct compliant packets manually using
 * base64url encoding and SHA-256.
 */

const crypto = require('crypto');

/**
 * Generate a random 32-byte fulfilment and compute its SHA-256 condition.
 * @returns {{ fulfilment: string, condition: string }}
 */
function generateFulfilmentAndCondition() {
  const fulfilmentBytes = crypto.randomBytes(32);
  const fulfilment = base64url(fulfilmentBytes);
  const conditionBytes = crypto.createHash('sha256').update(fulfilmentBytes).digest();
  const condition = base64url(conditionBytes);
  return { fulfilment, condition };
}

/**
 * Generate a dynamic ILP packet.
 * A real ILP packet is a binary ASN.1 structure containing:
 *   - amount (uint64)
 *   - account address (string)
 * For simplicity, we construct a base64url-encoded JSON envelope
 * that the Mojaloop core can parse.
 *
 * @param {string} amount - Transfer amount as string
 * @param {string} currency - Currency code (e.g. 'USD')
 * @param {string} payerFsp - Payer FSP ID
 * @param {string} payeeFsp - Payee FSP ID
 * @returns {string} Base64url-encoded ILP packet
 */
function generateIlpPacket(amount, currency, payerFsp, payeeFsp) {
  // Construct a minimal ILP-like payload.
  // In production you'd use ilp-packet: ilpPacket.serializeIlpPayment({ amount, account })
  // We use a structured JSON that carries routing info
  const packet = {
    amount,
    currency,
    payer: payerFsp,
    payee: payeeFsp,
    // Attach a nonce so each packet is unique
    nonce: crypto.randomUUID(),
  };
  const json = JSON.stringify(packet);
  return Buffer.from(json).toString('base64url');
}

/**
 * Decode an ILP packet (for inspection).
 * @param {string} base64urlPacket
 * @returns {object}
 */
function decodeIlpPacket(base64urlPacket) {
  try {
    const json = Buffer.from(base64urlPacket, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return { raw: base64urlPacket };
  }
}

/**
 * Validate that a fulfilment matches a given condition.
 * @param {string} fulfilment - Base64url-encoded fulfilment
 * @param {string} condition - Base64url-encoded expected condition
 * @returns {boolean}
 */
function validateFulfilment(fulfilment, condition) {
  try {
    const fulfilmentBytes = Buffer.from(fulfilment, 'base64url');
    const computedCondition = crypto.createHash('sha256').update(fulfilmentBytes).digest('base64url');
    return computedCondition === condition;
  } catch {
    return false;
  }
}

/**
 * Convert a buffer to base64url (no padding).
 * @param {Buffer} buf
 * @returns {string}
 */
function base64url(buf) {
  return buf.toString('base64url');
}

/**
 * Generate a standard FSPIOP error body.
 * @param {string} errorCode - e.g. '3100', '3102', '2001'
 * @param {string} errorDescription
 * @returns {object}
 */
function fspiopError(errorCode, errorDescription) {
  return {
    errorInformation: {
      errorCode,
      errorDescription,
      extensionList: {
        extension: [
          { key: 'dfsp-source', value: 'custom-dfsp' },
        ],
      },
    },
  };
}

module.exports = {
  generateFulfilmentAndCondition,
  generateIlpPacket,
  decodeIlpPacket,
  validateFulfilment,
  fspiopError,
};