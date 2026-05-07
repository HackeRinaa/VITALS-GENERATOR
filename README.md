# vitals-gen

TypeScript MQTT vital-sign generator that publishes synthetic telemetry to your broker using the WEMORE topic contract.

## What it publishes

- Topic: `vitals/generator/{sourceId}`
- QoS: configurable (default `1`)
- Retain: configurable (default `false`)
- Interval: configurable (default `20000ms`)

Minimum payload fields per message:

```json
{
  "source": "generator",
  "sourceId": "sim-01",
  "hr": 74,
  "spo2": 98,
  "rr": 16,
  "ts": "2026-05-07T10:00:00.000Z"
}
```

The generator also includes extra fields (`vitals`, `respAirCnd`, `mentalAlertness`, `activityStatus`) for richer simulation.

## Requirements

- Node.js 20+
- npm
- Docker Desktop (optional, only if running with Compose)

## Environment variables

Copy `.env.example` to `.env` and set values:

```bash
MQTT_URL=mqtt://<broker-host>:1883
MQTT_USER=generator-client
MQTT_PASS=<generator-password>
MQTT_QOS=1
MQTT_RETAIN=false
MQTT_RECONNECT_MS=1500
INTERVAL_MS=20000
MQTT_SOURCE_ID=sim-01
# or MQTT_SOURCE_IDS=sim-01,sim-02
ENABLE_CONTROL_SUBSCRIPTION=false
```

Notes:

- `MQTT_SOURCE_IDS` (comma-separated) takes precedence over `MQTT_SOURCE_ID`.
- Keep `ENABLE_CONTROL_SUBSCRIPTION=false` unless your ACL allows `generator-client` to read `vitals/control/#`.

## Run locally (Node)

```bash
npm install
npm run build
node dist/index.js
```

## Run with Docker Compose

Use this when publishing to an external broker:

```bash
docker compose up --build --no-deps vitals-gen
```

Why `--no-deps`: avoids starting local `mqtt` service and prevents host port `1883` conflicts.

If you want to run the local broker service from this repo, it is behind the `local-broker` profile:

```bash
docker compose --profile local-broker up --build
```

## Broker credentials and ACL

For your new broker contract, generator should use:

- Username: `generator-client`
- Password: (the one created for that user on broker)
- Publish permission: `vitals/generator/#`

If authentication fails:

1. Recreate password on broker for `generator-client`
2. Restart Mosquitto
3. Recheck `MQTT_USER`, `MQTT_PASS`, `MQTT_URL`

## Force RED values

This generator supports control commands on:

- `vitals/control/all`
- `vitals/control/{sourceId}`

Example control payload:

```json
{"zone":"RED","durationSec":60}
```

To make this work:

1. Set `ENABLE_CONTROL_SUBSCRIPTION=true`
2. Ensure broker ACL allows generator to read control topics, for example:

```text
user generator-client
topic write vitals/generator/#
topic read vitals/control/#
```

If control is disabled or ACL denies reads, publish RED vitals directly from MQTTX to `vitals/generator/{sourceId}`.

## MQTTX quick test

Connection:

- URL: `mqtt://<broker-host>:1883`
- Username: `generator-client`
- Password: your configured password

Publish test:

- Topic: `vitals/generator/sim-01`
- QoS: `1`
- Retain: `false`

## Security

- Do not commit real secrets in `.env`.
- Rotate weak passwords after initial testing.

