'use client';

import { lazy, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import type { GpsData } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';
import { cn } from '@/lib/utils';

interface VestMapProps {
  gps?: GpsData;
  statusMessage?: string;
  variant?: 'card' | 'plain';
  size?: 'default' | 'compact';
}

// Lazy load MapContent to prevent SSR issues with Leaflet
const MapContent = lazy(() => import('./map-content'));

export default function VestMap({ gps, statusMessage, variant = 'card', size = 'default' }: VestMapProps) {
  const hasValidFix =
    !!gps &&
    gps.fix === true &&
    typeof gps.lat === 'number' &&
    typeof gps.lng === 'number' &&
    gps.lat !== 0 &&
    gps.lng !== 0;

  const mapSizeClassName = size === 'compact' ? 'aspect-[16/9] max-h-64' : 'aspect-[4/3]';

  const mapBody = (
    <div className={cn("relative w-full overflow-hidden rounded-md bg-muted", mapSizeClassName)}>
      {hasValidFix && gps ? (
        <Suspense fallback={<Skeleton className="h-full w-full" />}>
          <MapContent lat={gps.lat} lng={gps.lng} accuracyM={gps.accuracyM} />
        </Suspense>
      ) : (
        <div className="flex h-full items-center justify-center">
          <p className="text-center text-muted-foreground">
            {statusMessage ?? (gps?.fix === false ? 'No GPS fix available' : 'No location available')}
          </p>
        </div>
      )}
    </div>
  );

  if (variant === 'plain') {
    return mapBody;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPS Location</CardTitle>
        <CardDescription>
          {gps
            ? `${statusMessage ? `${statusMessage} ` : ''}Lat: ${gps.lat.toFixed(4)}, Lng: ${gps.lng.toFixed(4)}${
                gps.accuracyM ? `, Accuracy: ±${gps.accuracyM}m` : ''
              }${gps.fix === false ? ' (No Fix)' : ''}`
            : statusMessage || 'No GPS data available.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mapBody}
      </CardContent>
    </Card>
  );
}
