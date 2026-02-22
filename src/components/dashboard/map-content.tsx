'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

interface MapContentProps {
  lat: number;
  lng: number;
  accuracyM?: number;
}

// Component to update map view when coordinates change
function MapUpdater({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();

  useEffect(() => {
    // Smooth pan to new location without remounting tiles
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);

  return null;
}

// Fix Leaflet marker icons for Next.js static export
// This prevents the "marker-icon is undefined" error in production builds
const createMarkerIcon = (color: string = 'red') => {
  const svgIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3" fill="white"/>
    </svg>
  `;

  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${Buffer.from(svgIcon).toString('base64')}`,
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
    shadowUrl: undefined,
  }) as L.Icon;
};

export default function MapContent({ lat, lng, accuracyM }: MapContentProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null; // Prevent hydration mismatch

  const markerIcon = createMarkerIcon('#ef4444'); // Tailwind red-500

  return (
    <MapContainer
      center={[lat, lng] as [number, number]}
      zoom={16}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
    >
      {/* OpenStreetMap Tiles */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Update map view when coordinates change (smooth pan) */}
      <MapUpdater lat={lat} lng={lng} />

      {/* Accuracy Circle (if exists) */}
      {accuracyM && (
        <Circle
          center={[lat, lng] as [number, number]}
          radius={accuracyM}
          pathOptions={{
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.1,
            weight: 2,
          }}
        >
          <Popup>Accuracy: ±{accuracyM}m</Popup>
        </Circle>
      )}

      {/* Marker at GPS location */}
      <Marker position={[lat, lng] as [number, number]} icon={markerIcon}>
        <Popup>
          <div className="text-sm">
            <p className="font-semibold">Vest Location</p>
            <p>Lat: {lat.toFixed(6)}</p>
            <p>Lng: {lng.toFixed(6)}</p>
            {accuracyM && <p>Accuracy: ±{accuracyM}m</p>}
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  );
}
