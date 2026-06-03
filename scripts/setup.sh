#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
cd "${ROOT_DIR}"

if [[ ! -f .env ]]; then
  cp .env.sample .env
  echo "Created .env from .env.sample. Edit .env and re-run if needed."
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker before running this setup."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "Docker Compose is required. Install docker compose or docker-compose."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo ".env file not found after copy. Create it from .env.sample."
  exit 1
fi

if [[ ! -f ./docker/visualizer/app/package.json ]]; then
  echo "Visualizer app missing. Make sure the folder is complete."
  exit 1
fi

cat <<'EOF'
Setup completed.
Next steps:
  1. Edit .env values if needed.
  2. Run ./scripts/start.sh
  3. Open http://localhost:$(grep -E '^VISUALIZER_PORT=' .env | cut -d'=' -f2)
EOF
