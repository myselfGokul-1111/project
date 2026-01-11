# CareConnect Dashboard

CareConnect is a small dashboard + ESP32 (Arduino) project for remote elderly care. It provides a web dashboard, Supabase backend integration, and a WebSocket endpoint to receive device telemetry from an ESP32/ESP8266.

## Features

- Web dashboard with live ECG/MPU/device data
- WebSocket `/ws` endpoint for device data
- Supabase integration for medicines, reminders, logs
- Email alerts for emergencies or low stock

---

## Quickstart (Local)

1. Install dependencies

```bash
npm install
```

2. Create `.env` from `.env.example` and fill in Supabase credentials

3. Start the server

```bash
npm run dev
# or
npm start
```

4. Open `http://localhost:8080` (or the PORT set in env)

---

## Deploy to Render

1. Push repo to GitHub.
2. Create a Web Service on Render and point to this repo.
3. Set the environment variables in Render: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Render will use `render.yaml` to build and start the service.
5. Confirm the `/health` endpoint returns `{ status: 'healthy' }`.

---

## Arduino (ESP32) Setup

1. Open `arduino.c`. Update WiFi credentials:

```c
const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";
```

2. Update the `serverHost` to your deployed domain (without `https://` or `wss://`):

```c
const char* serverHost = "your-service.onrender.com"; // e.g. careconnect-dashboard.onrender.com
```

3. The sketch uses secure WebSocket (`wss://`) on port `443`. It calls `webSocket.setInsecure()` by default to avoid certificate pinning problems on Render; change this only if you manage certificate fingerprints.

4. Flash the sketch to your ESP32.

---

## Testing & Verification

- Serial Monitor: Open the Serial Monitor (115200) and watch for:
  - WiFi connection
  - WSS connect/disconnect logs
  - "Data Sent" messages (heartbeat/device-data)

- Web Browser: Open the dashboard and check the browser console for WebSocket connection and incoming `device-data` events.

- Server: Check `/health` to confirm the service is running and see `websocketClients` count.

- Reminders API (examples):
```bash
# Create a reminder
curl -X POST -H 'Content-Type: application/json' -d '{"title":"medicine","details":"Aspirin","iso_date":"2026-01-09T12:00:00Z"}' http://localhost:8080/api/reminders

# List reminders
curl http://localhost:8080/api/reminders

# Get a reminder by id
curl http://localhost:8080/api/reminders/1

# Update a reminder
curl -X PATCH -H 'Content-Type: application/json' -d '{"details":"New details"}' http://localhost:8080/api/reminders/1

# Delete a reminder
curl -X DELETE http://localhost:8080/api/reminders/1
```

---

## Troubleshooting

- If the ESP32 fails to connect to `wss://`, ensure the deployed service is accessible at your domain and that port 443 is open.
- If using strict TLS, remove `webSocket.setInsecure()` and set the correct fingerprint.
- Make sure `SUPABASE_*` env vars are set in Render or your `.env` for local testing.

---

If you'd like, I can add an OTA/update path or an optional certificate fingerprint check for stricter security.
