# **App Name**: VestTrack

## Core Features:

- User Authentication: Email/password-based authentication with Firebase Authentication. Users are assigned roles upon login, and this tool determines which part of the system the users are permitted to enter.
- Role-Based Routing: Route users to appropriate dashboards (/guard, /supervisor) based on roles stored in Firebase RTDB at /roles/{uid}.
- Guard Vest Pairing: Guards can pair with a vest by entering the vest ID, which is stored in RTDB at /activeVestByGuard/{guardUid}.
- Live Telemetry Display: Display live telemetry data (skinTemp, batteryPct, mode, lastSeenTs, gps.lat/lng) from /vests/{vestId}/current, updating in real-time. Offline indicator and GPS staleness warning.
- Mode Control: Allow guards/supervisors to control vest mode (Off, Eco, Normal, Boost) by writing commands to /vests/{vestId}/commands/{cmdId} and displaying acknowledgement feedback from /vests/{vestId}/acks/{cmdId}. Display command latency.
- Supervisor Fleet Management: Supervisors can view a fleet list of vests with key telemetry and open a detail view with live telemetry, recent history chart, and GPS data with staleness warning.
- Offline Detection: Detect vest offline status based on lastSeenTs and display an indicator if the device hasn't updated recently.

## Style Guidelines:

- Primary color: HSL (210, 70%, 50%) - A vibrant, modern blue (#3399FF) evoking technology and trust.
- Background color: HSL (210, 20%, 95%) - A very light blue (#F0F8FF), nearly white, for a clean, unobtrusive background.
- Accent color: HSL (180, 60%, 40%) - A teal/cyan (#33CCCC) to complement the primary, used sparingly for interactive elements and highlights.
- Body and headline font: 'Inter', a grotesque-style sans-serif with a modern, machined, objective, neutral look.
- Use simple, consistent icons from a set like Material Design Icons to represent device status, mode, and other data points.
- Employ a clean, card-based layout with clear separation of data points for easy scanning. Prioritize key metrics on the dashboard.
- Use subtle animations for data updates and mode changes to provide visual feedback without being distracting.