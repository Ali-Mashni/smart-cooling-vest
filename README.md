# VestTrack — Smart Cooling Vest Dashboard

A real-time monitoring dashboard for smart cooling vests, built as a senior design project. The system allows **guards** to pair with and control their vest, while **supervisors** monitor the entire fleet from a centralized dashboard.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (static export, `output: "export"`) |
| UI | Tailwind CSS, shadcn/ui (Radix primitives) |
| Auth | Firebase Authentication |
| Database | Firebase Realtime Database (RTDB) |
| Maps | Leaflet + OpenStreetMap (react-leaflet) |
| Hosting | Firebase Hosting (Spark plan) |
| Language | TypeScript |

## Features

- **Role-based routing** — automatic redirect to `/guard` or `/supervisor` based on RTDB role
- **Guard dashboard** — pair with a vest, view live telemetry (skin temp, battery, GPS, mode), send mode commands
- **Supervisor dashboard** — monitor all active vests in the fleet
- **Live GPS map** — Leaflet + OpenStreetMap tiles with marker, accuracy circle, and fix status
- **Vest pairing with validation** — verifies vest exists in RTDB before writing the pairing mapping (prevents orphan nodes)
- **Mode control** — send `set_mode` commands to vests via RTDB, with ACK handling
- **Real-time updates** — RTDB subscriptions via custom `useRtdbValue` hook

## RTDB Data Model

```
/vests/{vestId}/current          → { ts, lastSeenTs, skinTemp, batteryPct, mode, gps }
/vests/{vestId}/history/{key}    → { ts, skinTemp, batteryPct, mode, gps? }
/vests/{vestId}/commands/{cmdId} → { cmd, value, ts }
/vests/{vestId}/acks/{cmdId}     → { status, ts, message? }
/vests/{vestId}/meta             → vest metadata (optional)

/activeVestByGuard/{guardUid}    → vestId
/roles/{uid}                     → "guard" | "supervisor"
/users/{uid}                     → { displayName, email }
```

## Project Structure

```
src/
├── app/
│   ├── layout.tsx            # Root layout (AuthProvider, Toaster, fonts)
│   ├── page.tsx              # Entry — reads role, redirects to /guard or /supervisor
│   ├── globals.css           # Tailwind + dark theme CSS variables
│   ├── guard/page.tsx        # Guard dashboard (pairing, telemetry, map, mode control)
│   ├── supervisor/page.tsx   # Supervisor fleet dashboard
│   └── login/page.tsx        # Firebase Auth login
├── components/
│   ├── auth/                 # AuthProvider (Firebase Auth context)
│   ├── dashboard/
│   │   ├── vest-pairing.tsx  # Pair vest with validation + error/success UI
│   │   ├── vest-map.tsx      # Leaflet map wrapper (dynamic import, SSR-safe)
│   │   ├── map-content.tsx   # Leaflet MapContainer + OSM tiles + marker + accuracy circle
│   │   ├── telemetry-card.tsx
│   │   └── mode-control.tsx
│   ├── layout/               # DashboardLayout, Loader, navigation
│   └── ui/                   # shadcn/ui primitives (Button, Card, Input, Alert, etc.)
├── hooks/
│   ├── use-rtdb-value.ts     # Real-time RTDB subscription hook
│   └── use-toast.ts          # Toast notification hook
└── lib/
    ├── firebase.ts           # Firebase app initialization
    └── types.ts              # TypeScript types (VestTelemetry, GpsData, VestMode, etc.)
```

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Auth + Realtime Database enabled
- Firebase CLI (`npm install -g firebase-tools`)

### Install & Run

```bash
# Install dependencies
npm install

# Run dev server (port 9002)
npm run dev
```

### Environment

Create a `.env.local` with your Firebase config:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_DATABASE_URL=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

### Build & Deploy

```bash
# Build static export
npm run build

# Deploy to Firebase Hosting
npm run deploy
# or: npm run build && firebase deploy --only hosting
```

See [DEPLOY.md](./DEPLOY.md) for detailed deployment instructions.

## Senior Design — Constraint & Specification

| | Description |
|---|---|
| **Constraint** | Vest communicates via Wi-Fi to cloud — simulated by a network client writing telemetry to RTDB |
| **Specification** | Telemetry updates every 10–20 seconds with `lastSeenTs` updates; supervisor dashboard reflects changes in near real-time |

### Virtual Vest Simulator (planned)

A standalone script that imitates the ESP32 controller:
- Writes telemetry to `/vests/{vestId}/current` every 10–20 seconds
- Updates GPS separately every 30–80 seconds
- Listens for commands at `/vests/{vestId}/commands/` and writes ACKs
- Updates `lastSeenTs` on each telemetry write

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (port 9002, Turbopack) |
| `npm run build` | Static export to `out/` |
| `npm run deploy` | Build + deploy to Firebase Hosting |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type check |

## License

Senior design project — not licensed for external use.

## Optional: Run the Virtual Vest Simulator

If you want to simulate vest telemetry locally, use the Python simulator in `simulator/`.

```bash
# from smart-cooling-vest/
cd simulator

# create and activate virtual environment
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# install dependencies
pip install -r requirements.txt

# create env file and fill values
copy .env.example .env

# run simulator
python virtual_vest.py
```

Set these values in `simulator/.env` before running:

- `FIREBASE_API_KEY`
- `FIREBASE_DB_URL`
- `DEVICE_EMAIL`
- `DEVICE_PASSWORD`
- `VEST_ID`
