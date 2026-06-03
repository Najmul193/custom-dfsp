# DFSP Sender/Receiver Setup

This folder contains a portable, self-contained DFSP sender/receiver simulator setup with a visualizer UI. It is designed to be copied to any directory and run independently.

## What it includes

- `docker-compose.yml` to run two simulator DFSPs and a visualizer UI
- `scripts/` for setup, start, stop, provisioning, health check, and sample transaction
- `config/` with template environment files
- `docker/visualizer/` for the React-based monitoring UI

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

5. Start services:

```bash
./scripts/start.sh
```

6. Open the visualizer UI at `http://localhost:3001`.

## Commands

```bash
./scripts/setup.sh
./scripts/start.sh
./scripts/stop.sh
./scripts/health-check.sh
./scripts/provision-dfsps.sh
./scripts/test-transaction.sh
```

## Notes

- The setup uses relative paths only, so it will work regardless of the folder location.
- The simulator container image is `mojaloop/simulator:v12.2.4`.
- The UI checks service health and displays network status.
- If your core runs on another machine, use its LAN IP in `.env`.
