# DFSP Technical Dataflow

This document explains the existing DFSP services, the custom DFSP adapter, the Mojaloop core API path, the full transfer lifecycle, terminal usage, and the current state of the setup/start scripts.

## 1. What Exists In This Setup

This folder contains two different DFSP styles:

1. Mojaloop simulator DFSPs
2. Custom Node.js DFSPs

The custom DFSPs are isolated from the simulator DFSPs. A transfer from `custom-sender-fsp` to `custom-receiver-fsp` uses Mojaloop core APIs and callbacks. It does not use the simulator containers.

### Docker Services

| Service | Container | Host Port | Internal Port | Purpose |
| --- | --- | ---: | ---: | --- |
| Simulator sender | `sender-dfsp` | `8444` | `8444` | Mojaloop simulator sender |
| Simulator receiver | `receiver-dfsp` | `8445` | `8444` | Mojaloop simulator receiver |
| Custom sender | `custom-dfsp-sender` | `3001` | `3001` | Custom payer DFSP |
| Custom receiver | `custom-dfsp-receiver` | `3002` | `3002` | Custom payee DFSP |
| Visualizer | `dfsp-visualizer-ui` | `3003` | `3000` | Health/events UI |

### Docker Networks

| Network | Purpose |
| --- | --- |
| `dfsp-net` | Local bridge network for this DFSP setup |
| `mojaloop-net` | External network shared with Mojaloop core containers |

The custom DFSP containers are attached to both networks. This lets them expose ports to your host and also call Mojaloop core services by Docker DNS names such as `ml-api-adapter`, `quoting-service`, and `central-ledger`.

## 2. Existing DFSP Types

### Simulator DFSPs

The simulator services use:

```text
mojaloop/simulator:v12.2.4
```

Containers:

```text
sender-dfsp
receiver-dfsp
```

They are configured by environment variables in `docker-compose.yml`:

```text
CBH_FSPIOP_FSP_ID
CBH_FSPIOP_ALS_ENDPOINT_URL
CBH_FSPIOP_QUOTES_ENDPOINT_URL
CBH_FSPIOP_TRANSFERS_ENDPOINT_URL
CBH_FSPIOP_TRANSACTION_REQUESTS_ENDPOINT_URL
```

These simulator DFSPs are useful for baseline Mojaloop simulator testing. They are not used by the custom DFSP transfer flow.

### Custom DFSPs

The custom DFSP services are built from:

```text
custom-dfsp/
```

Containers:

```text
custom-dfsp-sender
custom-dfsp-receiver
```

Both containers run the same Node.js/Express app. They behave differently because of environment variables:

| Container | FSP ID | Port |
| --- | --- | ---: |
| `custom-dfsp-sender` | `custom-sender-fsp` | `3001` |
| `custom-dfsp-receiver` | `custom-receiver-fsp` | `3002` |

The custom DFSP app is made of:

| File | Purpose |
| --- | --- |
| `server.js` | Express API server and transfer workflow |
| `adapter.js` | HTTP adapter for Mojaloop core APIs |
| `store.js` | In-memory quote and transfer state |
| `ilp.js` | Fulfilment, condition, and ILP-like packet helpers |

## 3. Mojaloop Core Services Used

The `.env` file configures the core service names and ports:

| Core Service | Docker Host | Port | Used For |
| --- | --- | ---: | --- |
| ML API Adapter | `ml-api-adapter` | `3000` | Transfer prepare and fulfilment |
| Quoting Service | `quoting-service` | `3002` | Quote request and response |
| Account Lookup Service | `account-lookup-service` | `3001` | Participant/account lookup |
| Central Ledger | `central-ledger` | `3001` | Participant endpoints, accounts, positions, liquidity |

Important core endpoints:

| Method | Endpoint | Service | Meaning |
| --- | --- | --- | --- |
| `POST` | `/quotes` | `quoting-service:3002` | Submit quote request |
| `PUT` | `/quotes/{quoteId}` | `quoting-service:3002` | Submit quote response |
| `POST` | `/transfers` | `ml-api-adapter:3000` | Prepare transfer |
| `PUT` | `/transfers/{transferId}` | `ml-api-adapter:3000` | Fulfil transfer |
| `PUT` | `/transfers/{transferId}/error` | DFSP callback URL | Transfer error callback |
| `GET` | `/participants/{fspId}/accounts` | `central-ledger:3001` | Inspect DFSP ledger accounts |
| `POST` | `/participants/{fspId}/accounts/{accountId}` | `central-ledger:3001` | Record funds in/out |
| `DELETE` | `/endpointcache` | `ml-api-adapter:3000` | Clear endpoint cache |

## 4. Custom DFSP Endpoints

Both custom DFSP containers expose these endpoints:

| Method | Endpoint | Meaning |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `GET` | `/status` | Current in-memory transfer/quote counts |
| `POST` | `/initiate-transfer` | Start an outgoing transfer |
| `POST` | `/quotes` | Receive quote request from Mojaloop |
| `PUT` | `/quotes/{quoteId}` | Receive quote response callback from Mojaloop |
| `POST` | `/transfers` | Receive transfer prepare callback from Mojaloop |
| `PUT` | `/transfers/{transferId}` | Receive fulfilment callback from Mojaloop |
| `PUT` | `/transfers/{transferId}/error` | Receive transfer error callback from Mojaloop |

Example host URLs:

```text
http://localhost:3001/health
http://localhost:3002/health
http://localhost:3001/initiate-transfer
```

Example internal Docker URLs:

```text
http://custom-dfsp-sender:3001
http://custom-dfsp-receiver:3002
```

## 5. Adapter Responsibilities

The adapter in `custom-dfsp/app/adapter.js` is the custom DFSP's API client for Mojaloop.

It does these things:

- Builds FSPIOP headers.
- Sends quote requests.
- Sends quote responses.
- Sends transfer prepare requests.
- Sends transfer fulfilment requests.
- Sets `Content-Length` on JSON bodies.
- Removes `Accept` on `PUT` callbacks where needed.

Important headers:

| Header | Purpose |
| --- | --- |
| `Content-Type` | FSPIOP vendor media type |
| `Accept` | Expected FSPIOP response type |
| `FSPIOP-Source` | Sending FSP |
| `FSPIOP-Destination` | Receiving FSP |
| `Date` | Required FSPIOP date header |
| `Content-Length` | Prevents bad chunked callback behavior |

The `Content-Length` fix is important. Without it, Node may send `Transfer-Encoding: chunked` to Mojaloop. Mojaloop can later forward headers in a way that creates both `transfer-encoding` and `content-length` on callback requests. Node rejects that combination before Express sees the request, causing a bare HTTP `400`. Setting `Content-Length` fixed that callback failure.

## 6. Full Dataflow Path

This is the working custom-to-custom DFSP flow:

```text
custom-dfsp-sender
  -> quoting-service
  -> custom-dfsp-receiver
  -> quoting-service
  -> custom-dfsp-sender
  -> ml-api-adapter
  -> central-ledger / Kafka / position handler
  -> custom-dfsp-receiver
  -> ml-api-adapter
  -> central-ledger / Kafka / notification handler
  -> custom-dfsp-sender
  -> custom-dfsp-receiver
```

### Step 1: User Starts Transfer

Command:

```bash
./scripts/make-transaction.sh custom-sender-fsp custom-receiver-fsp 10
```

The script calls:

```http
POST http://localhost:3001/initiate-transfer
Content-Type: application/json

{
  "payeeFsp": "custom-receiver-fsp",
  "amount": 10
}
```

### Step 2: Sender Creates Local State

`custom-dfsp-sender` creates:

- `transferId`
- `quoteId`
- amount object
- ILP-like packet
- fulfilment
- condition
- expiration

It stores:

- quote as `PENDING`
- transfer as `PENDING`

### Step 3: Sender Posts Quote To Mojaloop

`custom-dfsp-sender` calls:

```http
POST http://quoting-service:3002/quotes
FSPIOP-Source: custom-sender-fsp
FSPIOP-Destination: custom-receiver-fsp
Content-Type: application/vnd.interoperability.quotes+json;version=1.0
```

Mojaloop returns:

```text
HTTP 202
```

### Step 4: Mojaloop Routes Quote To Receiver

Mojaloop calls:

```http
POST http://custom-dfsp-receiver:3002/quotes
```

`custom-dfsp-receiver`:

- accepts with `202`
- generates fulfilment and condition
- stores quote and fulfilment in memory
- sends quote response asynchronously

### Step 5: Receiver Sends Quote Response

`custom-dfsp-receiver` calls:

```http
PUT http://quoting-service:3002/quotes/{quoteId}
FSPIOP-Source: custom-receiver-fsp
FSPIOP-Destination: custom-sender-fsp
```

Payload includes:

```json
{
  "transferAmount": {
    "currency": "XXX",
    "amount": "10"
  },
  "ilpPacket": "...",
  "condition": "...",
  "expiration": "..."
}
```

### Step 6: Sender Receives Quote Callback

Mojaloop calls:

```http
PUT http://custom-dfsp-sender:3001/quotes/{quoteId}
```

`custom-dfsp-sender`:

- marks quote as accepted
- creates transfer prepare body
- uses the payee's condition and ILP packet

### Step 7: Sender Posts Transfer Prepare

`custom-dfsp-sender` calls:

```http
POST http://ml-api-adapter:3000/transfers
FSPIOP-Source: custom-sender-fsp
FSPIOP-Destination: custom-receiver-fsp
Content-Type: application/vnd.interoperability.transfers+json;version=1.0
Content-Length: ...
```

Payload:

```json
{
  "transferId": "...",
  "payerFsp": "custom-sender-fsp",
  "payeeFsp": "custom-receiver-fsp",
  "amount": {
    "currency": "XXX",
    "amount": "10"
  },
  "ilpPacket": "...",
  "condition": "...",
  "expiration": "...",
  "extensionList": {
    "extension": [
      {
        "key": "QUOTE_ACCEPTED",
        "value": "true"
      }
    ]
  }
}
```

Mojaloop returns:

```text
HTTP 202
```

### Step 8: Mojaloop Core Switches Prepare

Core path:

```text
ml-api-adapter
  -> Kafka topic-transfer-prepare
  -> central-ledger prepare handler
  -> duplicate check
  -> position/liquidity check
  -> endpoint lookup for custom-receiver-fsp
  -> notification handler
  -> HTTP callback to custom receiver
```

Core components involved:

| Component | Role |
| --- | --- |
| `ml-api-adapter` | Accepts FSPIOP transfer API requests |
| Kafka | Carries transfer events |
| `central-ledger` | Validates and records transfer state |
| `central-handler-position-batch` | Handles position updates |
| Notification handler | Sends HTTP callbacks to DFSP endpoints |

### Step 9: Receiver Gets Transfer Prepare

Mojaloop calls:

```http
POST http://custom-dfsp-receiver:3002/transfers
FSPIOP-Source: custom-sender-fsp
FSPIOP-Destination: custom-receiver-fsp
```

`custom-dfsp-receiver`:

- stores transfer as `PREPARED`
- finds matching quote
- reuses quote fulfilment
- returns `202`
- auto-fulfils after short delay

### Step 10: Receiver Sends Fulfilment

`custom-dfsp-receiver` calls:

```http
PUT http://ml-api-adapter:3000/transfers/{transferId}
FSPIOP-Source: custom-receiver-fsp
FSPIOP-Destination: custom-sender-fsp
Content-Type: application/vnd.interoperability.transfers+json;version=1.0
```

Payload:

```json
{
  "fulfilment": "...",
  "completedTimestamp": "...",
  "transferState": "COMMITTED"
}
```

Important rules:

- `transferState` is required.
- `FSPIOP-Destination` must be the payer FSP.
- The fulfilment must match the transfer condition.

### Step 11: Mojaloop Commits

Mojaloop validates:

- transfer exists
- fulfilment matches condition
- headers are valid
- destination matches payer
- state is `COMMITTED`

Then it returns:

```text
HTTP 200
```

### Step 12: Mojaloop Sends Final Callbacks

Mojaloop sends:

```http
PUT http://custom-dfsp-sender:3001/transfers/{transferId}
PUT http://custom-dfsp-receiver:3002/transfers/{transferId}
```

Both custom DFSPs validate fulfilment and mark the transfer as `COMMITTED`.

## 7. Verified Working Transfer

Working transfer verified:

```text
3e4e0298-f8e0-4f3d-9808-cc836b5a32a1
```

Observed:

- quote accepted
- quote callback received
- transfer prepare accepted
- receiver received `POST /transfers`
- receiver sent fulfilment
- core accepted fulfilment with `HTTP 200`
- sender received fulfil callback
- receiver received fulfil callback
- fulfilment validation was `VALID`

## 8. How To Use The DFSP

### Start Services

```bash
cd /home/rivan/ml-core-test-harness/dfsp-sender-receiver-setup
./scripts/start.sh
```

If only custom DFSP code changed:

```bash
docker-compose build custom-dfsp-sender custom-dfsp-receiver
docker-compose rm -f -s -v custom-dfsp-sender custom-dfsp-receiver
docker-compose up -d custom-dfsp-sender custom-dfsp-receiver
```

### Health Check

```bash
./scripts/test-transaction.sh
```

### Make Transfer

```bash
./scripts/make-transaction.sh custom-sender-fsp custom-receiver-fsp 10
```

Reverse direction:

```bash
./scripts/make-transaction.sh custom-receiver-fsp custom-sender-fsp 10
```

Direct curl:

```bash
curl -X POST http://localhost:3001/initiate-transfer \
  -H 'Content-Type: application/json' \
  -d '{"payeeFsp":"custom-receiver-fsp","amount":10}'
```

### Watch Logs

Terminal 1:

```bash
docker logs -f custom-dfsp-sender
```

Terminal 2:

```bash
docker logs -f custom-dfsp-receiver
```

Terminal 3:

```bash
docker logs -f ml-api-adapter
```

Other useful logs:

```bash
docker logs -f central-ledger
docker logs -f central-handler-position-batch
docker logs -f quoting-service
```

### Check Ledger Accounts

Sender:

```bash
docker exec ml-api-adapter wget -qO- \
  http://central-ledger:3001/participants/custom-sender-fsp/accounts
```

Receiver:

```bash
docker exec ml-api-adapter wget -qO- \
  http://central-ledger:3001/participants/custom-receiver-fsp/accounts
```

### Fund Sender If Liquidity Fails

If core reports:

```text
Payer FSP insufficient liquidity
```

fund the sender settlement account. Example for account `17`:

```bash
docker exec ml-api-adapter sh -c 'wget -S -O- \
  --header="Content-Type: application/json" \
  --post-data="{\"transferId\":\"REPLACE-WITH-NEW-UUID\",\"externalReference\":\"custom-dfsp-funding\",\"action\":\"recordFundsIn\",\"reason\":\"Fund custom sender for test\",\"amount\":{\"amount\":5000000,\"currency\":\"XXX\"},\"extensionList\":{\"extension\":[{\"key\":\"string\",\"value\":\"string\"}]}}" \
  http://central-ledger:3001/participants/custom-sender-fsp/accounts/17'
```

Use a new UUID each time.

### Clear Endpoint Cache

If endpoints were changed but callbacks still behave incorrectly:

```bash
docker exec ml-api-adapter node -e "fetch('http://127.0.0.1:3000/endpointcache',{method:'DELETE',headers:{date:new Date().toUTCString(),'fspiop-source':'Hub','content-type':'application/json'}}).then(async r=>{console.log(r.status); console.log(await r.text())})"
```

Expected:

```text
202
```

### Visualizer

Open:

```text
http://localhost:3003
```

The terminal logs are more useful for technical debugging than the visualizer.

## 9. Script Review

### `scripts/setup.sh`

Status: mostly OK.

Good:

- Creates `.env` from `.env.sample`.
- Checks Docker.
- Checks Docker Compose.
- Checks that visualizer files exist.

Issues:

- The final URL message uses a quoted heredoc, so this text is printed literally:

```text
http://localhost:$(grep -E '^VISUALIZER_PORT=' .env | cut -d'=' -f2)
```

- It does not check whether `mojaloop-net` exists.
- It does not check whether Mojaloop core services are running.

Recommended:

- Source `.env` and print `http://localhost:${VISUALIZER_PORT}`.
- Add `docker network inspect mojaloop-net`.

### `scripts/start.sh`

Status: works, but aggressive.

It runs:

```bash
docker-compose down --remove-orphans
sleep 2
docker-compose up -d
```

Good:

- Gives a clean restart.
- Fixes many Docker Compose v1 stale container problems.

Risk:

- Stops all project services.
- Clears custom DFSP in-memory state.
- Recreates simulator services even if only custom DFSPs changed.

Recommended:

- Keep as clean restart.
- Add a separate custom-only restart script.

### `scripts/test-transaction.sh`

Status: OK health check, but name is misleading.

It checks:

- simulator sender health
- simulator receiver health
- core health through visualizer
- custom sender health
- custom receiver health

It does not make a transaction.

Recommended:

- Rename to `health-check.sh`, or add an optional transaction mode.

### `scripts/make-transaction.sh`

Status: works for starting a transfer.

Important limitation:

- It reports success when quote submission returns `202`.
- It does not wait for final transfer commit.

Better wording would be:

```text
Quote accepted by quoting service. Check logs for final commit.
```

Recommended:

- Add a follow-up status check or log instructions after printing transfer ID.

### `docker-compose.yml`

Status: OK.

Good:

- Custom DFSPs are on `mojaloop-net`.
- Visualizer is on `dfsp-net` and `mojaloop-net`.
- Ports are clear.

Recommended:

- Add healthchecks for custom DFSP containers.
- Consider a compose profile for simulator services, because custom transfers do not need simulator DFSPs.

## 10. Troubleshooting Summary

### Docker Compose `ContainerConfig` Error

Fix:

```bash
docker-compose down --remove-orphans
docker-compose up -d
```

Or custom-only:

```bash
docker-compose rm -f -s -v custom-dfsp-sender custom-dfsp-receiver
docker-compose up -d custom-dfsp-sender custom-dfsp-receiver
```

### Quote Accepted But Transfer Does Not Commit

Remember: quote `202` is not final success.

Check:

```bash
docker logs -f custom-dfsp-sender
docker logs -f custom-dfsp-receiver
docker logs -f ml-api-adapter
```

### Bare HTTP 400 From Receiver Callback

Cause found:

- outgoing prepare used chunked encoding
- callback could include conflicting HTTP headers
- Node rejected callback before Express route

Fix:

- adapter sets `Content-Length`.

### Fulfilment Validation Error

Cause found:

- fulfilment was missing `transferState`, or `FSPIOP-Destination` was wrong.

Fix:

- fulfilment body includes `transferState: "COMMITTED"`
- fulfilment header destination is payer FSP

## 11. Final Summary

The custom DFSP adapter is now a working isolated DFSP pair:

```text
custom-dfsp-sender <-> Mojaloop core APIs <-> custom-dfsp-receiver
```

The simulator DFSPs are separate. They are included in the setup, but not used by custom-to-custom transfers.

Working technical path:

```text
POST /initiate-transfer
  -> POST quoting-service /quotes
  -> POST receiver /quotes
  -> PUT quoting-service /quotes/{id}
  -> PUT sender /quotes/{id}
  -> POST ml-api-adapter /transfers
  -> POST receiver /transfers
  -> PUT ml-api-adapter /transfers/{id}
  -> PUT sender /transfers/{id}
  -> PUT receiver /transfers/{id}
  -> COMMITTED
```
