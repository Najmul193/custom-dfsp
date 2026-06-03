Custom DFSP
=================

This folder contains a minimal, reusable DFSP implementation (Node.js + Express) intended for testing with a Mojaloop core.

Usage:

1. Build the image via docker-compose in the parent folder.
2. Configure `.env` with `CUSTOM_SENDER_FSPID` and `CUSTOM_RECEIVER_FSPID` and core host/ports.
3. Start the services: `./scripts/start.sh` (in `dfsp-sender-receiver-setup`).

Endpoints:
- `GET /health` — health check
- `POST /quotes` — incoming quote
- `POST /transfers` — incoming transfer prepare
- `POST /initiate-transfer` — initiate an outgoing transfer via the configured core
