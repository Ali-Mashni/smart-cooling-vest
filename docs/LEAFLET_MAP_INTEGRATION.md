# Leaflet + OpenStreetMap Integration Guide

## Overview
The vest map now uses **Leaflet** with **OpenStreetMap** tiles instead of placeholder images or Google Maps. The implementation handles Next.js static export constraints with dynamic imports and client-only rendering.

---

## Architecture

### Components

#### 1. **VestMap.tsx** (Wrapper)
- Handles conditional rendering based on GPS fix status
- Dynamically imports `MapContent` to avoid SSR issues
- Shows "No GPS fix available" / "No location available" when appropriate

```tsx
<VestMap gps={telemetry?.gps} />
```

#### 2. **map-content.tsx** (Map Logic)
- Client-only component with actual Leaflet implementation
- Renders OSM tile layer
- Places marker at GPS coordinates
- Draws accuracy circle if `accuracyM` exists
- Handles the Leaflet marker icon issue for Next.js static export using SVG data URIs

---

## Data Flow

```
Firebase RTDB
  └─ vests/{vestId}/current
     ├─ gps: {
     │  ├─ lat: number
     │  ├─ lng: number
     │  ├─ accuracyM?: number (optional, meters)
     │  └─ fix?: boolean (optional, default true)
     └─ ... (other telemetry)
        ↓
useRtdbValue hook
  ↓
VestTelemetry type (includes gps)
  ↓
VestMap component
  ├─ Checks: fix !== false
  └─ Renders: MapContent with marker + accuracy circle
```

---

## Usage Example (Already Integrated)

In [guard/page.tsx](../app/guard/page.tsx):

```tsx
// Telemetry data from Firebase
const { data: telemetry } = useRtdbValue<VestTelemetry>(vestTelemetryPath);

// Pass GPS data to map
<VestMap gps={telemetry?.gps} />
```

---

## VestTelemetry Type (Updated)

```typescript
export interface GpsData {
  lat: number;
  lng: number;
  accuracyM?: number;  // Accuracy in meters (e.g., 5 for ±5m)
  fix?: boolean;       // true = valid fix, false = no GPS fix
}

export interface VestTelemetry {
  skinTemp: number;
  batteryPct: number;
  mode: VestMode;
  lastSeenTs: number;
  gps: GpsData;  // GPS data with Leaflet support
}
```

---

## Map Features

### ✅ Marker
- Red location pin at GPS coordinates
- Custom SVG icon (works in static export)
- Clickable popup showing lat/lng/accuracy

### ✅ Accuracy Circle
- Optional circle around marker if `accuracyM` provided
- Blue fill with 10% opacity
- Shows accuracy radius in meters

### ✅ OSM Attribution
- Proper attribution for OpenStreetMap
- Automatically added to map footer

### ✅ No GPS Fix Handling
- Shows "No GPS fix available" if `fix === false`
- Shows "No location available" if `gps` is undefined

---

## Next.js Static Export Fixes

### 1. **Dynamic Import**
```tsx
const MapContent = dynamic(() => import('./map-content'), {
  ssr: false, // Critical: Leaflet requires client-side only
});
```

### 2. **Leaflet Marker Icon Fix**
The component uses SVG data URIs instead of external icon files:

```tsx
const createMarkerIcon = (color: string = 'red') => {
  const svgIcon = `<svg>...</svg>`;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${Buffer.from(svgIcon).toString('base64')}`,
    // ... other config
  });
};
```

This **prevents** the common Next.js error: `"marker-icon.png is undefined"` in production builds.

### 3. **CSS Import in Client Component**
```tsx
import 'leaflet/dist/leaflet.css'; // Imported in map-content.tsx
```

---

## Example Firebase Data

### Valid GPS with Good Accuracy
```json
{
  "vests": {
    "vest001": {
      "current": {
        "mode": "Normal",
        "skinTemp": 34.5,
        "batteryPct": 87,
        "lastSeenTs": 1708590234000,
        "gps": {
          "lat": 1.3521,
          "lng": 103.8198,
          "accuracyM": 5,
          "fix": true
        }
      }
    }
  }
}
```

### No GPS Fix
```json
{
  "gps": {
    "lat": 0,
    "lng": 0,
    "accuracyM": null,
    "fix": false
  }
}
```
→ Map shows: "No GPS fix available"

### Minimal GPS (no accuracy)
```json
{
  "gps": {
    "lat": 1.3521,
    "lng": 103.8198,
    "fix": true
  }
}
```
→ Map shows marker, no accuracy circle

---

## Virtual Vest Simulator Integration

To update your virtual vest to include GPS data, modify `virtual_vest.py`:

```python
import random
from datetime import datetime

def generate_gps_telemetry():
    """Generate realistic GPS data with accuracy"""
    # Simulate a location (example: Singapore)
    base_lat, base_lng = 1.3521, 103.8198
    
    # Small random jitter (±0.001 degrees ≈ ±100 meters)
    lat = base_lat + random.uniform(-0.001, 0.001)
    lng = base_lng + random.uniform(-0.001, 0.001)
    
    # Accuracy varies: good (±5m) to poor (±50m)
    accuracy = random.choice([5, 10, 15, 20, 50])
    
    # Occasionally lose GPS fix
    fix = random.random() > 0.05  # 95% of the time has fix
    
    return {
        "gps": {
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "accuracyM": accuracy if fix else None,
            "fix": fix
        }
    }

# In telemetry update:
db.child("vests").child(VEST_ID).child("current").update(
    generate_gps_telemetry()
)
```

---

## Styling

Map container uses Tailwind classes:
```tsx
<div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
  {/* MapContainer fills this div */}
</div>
```

- **Size**: 4:3 aspect ratio, responsive width
- **Colors**: 
  - Marker: Red (#ef4444)
  - Accuracy circle: Blue (#3b82f6) with 10% opacity
  - Background: Muted (dark theme compatible)

---

## Browser Compatibility

- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Mobile browsers (touch-friendly)
- ✅ Static export deployments (Firebase Hosting)

---

## Performance Notes

- **Lazy loading**: Map only renders when GPS data exists and has valid fix
- **No external dependencies**: OSM tiles load from CDN
- **Lightweight**: Leaflet is ~40KB gzipped
- **Client-only**: Server-side build includes no map code

---

## Troubleshooting

### Issue: Map not showing in production build
**Solution**: Ensure `ssr: false` in dynamic import and Leaflet CSS is imported.

### Issue: Marker icon shows broken image
**Solution**: Already fixed using SVG data URIs. If persists, check browser console for CSS errors.

### Issue: Zoom too high/low on certain coordinates
**Solution**: Adjust `zoom={16}` in `map-content.tsx` to zoom level 13-18 depending on preference.

### Issue: Accuracy circle too large/small
**Solution**: Circle radius is in meters. Check that `accuracyM` value from Firebase is reasonable (1-100m typical).

---

## Supervisor Dashboard

The same `VestMap` component is reusable in [supervisor/page.tsx](../app/supervisor/page.tsx):

```tsx
// For each vest in the fleet
<VestMap gps={vestTelemetry?.gps} />
```

---

## Next Steps

1. ✅ Map component deployed
2. ✅ Types updated to include accuracy + fix
3. 📝 Update virtual-vest simulator to generate GPS telemetry
4. 📝 Deploy to Firebase Hosting: `npm run deploy`
