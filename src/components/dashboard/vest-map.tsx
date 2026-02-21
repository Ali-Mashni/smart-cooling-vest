'use client';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { MapPin } from 'lucide-react';
import type { GpsData } from '@/lib/types';
import { PlaceHolderImages } from '@/lib/placeholder-images';

interface VestMapProps {
  gps?: GpsData;
}

export default function VestMap({ gps }: VestMapProps) {
  const mapImage = PlaceHolderImages.find((img) => img.id === 'map-background');

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPS Location</CardTitle>
        <CardDescription>
          {gps ? `Lat: ${gps.lat.toFixed(4)}, Lng: ${gps.lng.toFixed(4)}` : 'No GPS data available.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
          {mapImage && (
             <Image
                src={mapImage.imageUrl}
                alt="Map placeholder"
                fill
                className="object-cover"
                data-ai-hint={mapImage.imageHint}
              />
          )}
          {gps && (
            <div className="absolute inset-0 flex items-center justify-center">
                <MapPin className="h-8 w-8 text-destructive animate-pulse" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
