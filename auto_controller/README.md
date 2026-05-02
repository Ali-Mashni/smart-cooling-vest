# AUTO Controller Worker (Rule-Based v1)

Deterministic Python worker for Smart Cooling Vest AUTO mode.

## What this worker does

- Reads vest state from `vests/{vestId}/state`
- Processes only vests with `controlMode = AUTO`
- Reads telemetry from `vests/{vestId}/current`
- Reads recent history from `vests/{vestId}/history`
- Reads guard preferences from `users/{guardUid}/preferences`
- Computes `pumpSpeedPct` with a deterministic rule engine
- Derives `backupMode` from configurable speed ranges
- Publishes command to `vests/{vestId}/commands/{cmdId}` using `set_auto_pump`
- Reads RTDB using the Firebase Realtime Database REST API
- Supports optional Firebase Authentication email/password for protected RTDB rules

## Setup

1. Open a terminal in `auto_controller/`.
2. Use the local virtual environment in `auto_controller/.venv`.
3. Install dependencies:

   .\.venv\Scripts\python.exe -m pip install -r requirements.txt

4. Create env file from template:

   copy .env.example .env

5. Fill values in `.env`:

- `FIREBASE_API_KEY`
- `FIREBASE_DB_URL`
- `WORKER_EMAIL` (optional, protected mode only)
- `WORKER_PASSWORD` (optional, protected mode only)

6. Run:

   .\.venv\Scripts\python.exe -m app.main

## Notes

- Open-dev mode: run with only `FIREBASE_API_KEY` and `FIREBASE_DB_URL`.
- Protected mode: set both `WORKER_EMAIL` and `WORKER_PASSWORD`.
- In protected mode, the worker signs in through Firebase Auth REST API, uses the returned ID token on RTDB REST requests, and refreshes the token when needed.
