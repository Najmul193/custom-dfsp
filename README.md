# DFSP Sender/Receiver Setup

This folder contains a portable, self-contained DFSP sender/receiver simulator setup with a visualizer UI and 3 dashboard UIs. It is designed to be copied to any directory and run independently.

## What it includes

- `docker-compose.yml` — Two simulator DFSPs (sender + receiver) plus visualizer
- `docker-compose-ui.yml` — Three dashboard UIs (sender, receiver, core monitor)
- `custom-dfsp/` — Custom Node.js DFSPs with full FSPIOP transfer flow
- `ui-sender-dfsp/` — Sender banking portal for initiating transfers
- `ui-receiver-dfsp/` — Receiver banking portal for incoming transfers  
- `ui-core-monitor/` — Mojaloop core settlement & service health monitor
- `scripts/` — Setup, start, stop, provisioning, health check, sample transaction
- `config/` — Template environment files
- `docker/visualizer/` — React-based monitoring UI

## Quick start

1. Copy this folder anywhere.
2. Create a local `.env` from the sample:

```bash
cp .env.sample .env
```

3. Edit `.env` to point to your Mojaloop core/hub host and configure FSPIDs.
4. Run setup:

```bash
./scripts/setup.sh
```

5. Start the DFSP services:

```bash
./scripts/start.sh
```

6. Start the UI services (separate compose file):

```bash
docker compose -f docker-compose-ui.yml up -d
```

7. Open the dashboards:

| Service | URL |
|---------|-----|
| Sender DFSP UI | http://localhost:4001 |
| Receiver DFSP UI | http://localhost:4002 |
| Core Monitor | http://localhost:4003 |
| Visualizer | http://localhost:3003 |

## Sending a Transfer

1. Open **Sender UI** at http://localhost:4001
2. In the **Recipient FSP ID** field, enter: `custom-receiver-fsp`
3. Enter an **Amount** (e.g. `50`) and click **Send Transfer**
4. The transfer will flow through the core (quote → prepare → fulfil → commit)
5. Check the **Receiver UI** at http://localhost:4002 to see the incoming transfer
6. Check the **Core Monitor** at http://localhost:4003 to see settlement positions

> ⚠️ **Important**: The Recipient FSP ID must match exactly. Use `custom-receiver-fsp` (not `custom-receiver-dfsp`).

## Commands

```bash
./scripts/setup.sh
./scripts/start.sh
./scripts/stop.sh
./scripts/health-check.sh
./scripts/provision-dfsps.sh
./scripts/test-transaction.sh

# Start UI services
docker compose -f docker-compose-ui.yml up -d

# Stop UI services
docker compose -f docker-compose-ui.yml down

# View logs
docker logs ui-sender-dfsp -f
docker logs ui-receiver-dfsp -f
docker logs ui-core-monitor -f
docker logs custom-dfsp-sender -f
docker logs custom-dfsp-receiver -f
```

## Notes

- The setup uses relative paths only, so it will work regardless of the folder location.
- The simulator container image is `mojaloop/simulator:v12.2.4`.
- The custom DFSPs use `mojaloop/sdk-scheme-adapter` for FSPIOP-compliant transfers.
- The UI services check backend health and display real-time status.
- If your core runs on another machine, use its LAN IP in `.env`.
- All 3 UIs auto-refresh every 2-3 seconds for live updates.
