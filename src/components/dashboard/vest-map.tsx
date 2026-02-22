'use client';

import { lazy, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import type { GpsData } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';

interface VestMapProps {
  gps?: GpsData;
}

// Lazy load MapContent to prevent SSR issues with Leaflet
const MapContent = lazy(() => import('./map-content'));

export default function VestMap({ gps }: VestMapProps) {
  const hasValidFix = gps && gps.fix !== false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPS Location</CardTitle>
        <CardDescription>
          {gps
            ? `Lat: ${gps.lat.toFixed(4)}, Lng: ${gps.lng.toFixed(4)}${
                gps.accuracyM ? `, Accuracy: ±${gps.accuracyM}m` : ''
              }${gps.fix === false ? ' (No Fix)' : ''}`
            : 'No GPS data available.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
          {hasValidFix && gps ? (
            <Suspense fallback={<Skeleton className="h-96 w-full" />}>
              <MapContent lat={gps.lat} lng={gps.lng} accuracyM={gps.accuracyM} />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-center text-muted-foreground">
                {gps?.fix === false ? 'No GPS fix available' : 'No location available'}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
