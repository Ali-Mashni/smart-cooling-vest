'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Loader } from '@/components/layout/loader';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { VestPairing } from '@/components/dashboard/vest-pairing';
import { useRtdbValue } from '@/hooks/use-rtdb-value';
import type { VestTelemetry } from '@/lib/types';
import TelemetryCard from '@/components/dashboard/telemetry-card';
import { Battery, MapPin, Thermometer, Wifi } from 'lucide-react';
import { ModeControl } from '@/components/dashboard/mode-control';
import VestMap from '@/components/dashboard/vest-map';
import { Skeleton } from '@/components/ui/skeleton';
import { getDatabase, ref, set } from 'firebase/database';

export default function GuardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [pairing, setPairing] = useState(false);

  // Single source of truth for pairedVestId
  const guardVestPath = user ? `/activeVestByGuard/${user.uid}` : null;
  const { data: pairedVestId, loading: pairedVestIdLoading } = useRtdbValue<string>(guardVestPath);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  // Telemetry subscription based on the single source of truth
  const vestTelemetryPath = pairedVestId ? `/vests/${pairedVestId}/current` : null;
  const { data: telemetry, loading: telemetryLoading } = useRtdbValue<VestTelemetry>(vestTelemetryPath);

  const handlePairVest = async (vestId: string) => {
    if (!user) return;
    setPairing(true);
    const db = getDatabase();
    const vestRef = ref(db, `activeVestByGuard/${user.uid}`);
    try {
      // The useRtdbValue hook will automatically update pairedVestId
      await set(vestRef, vestId);
    } catch (e) {
      console.error(e);
      // Let the pairing component handle the toast for errors
      throw e;
    } finally {
      setPairing(false);
    }
  };

  if (authLoading || !user) {
    return <Loader />;
  }

  const renderTelemetry = () => {
    if (!pairedVestId) {
      return (
        <div className="text-center py-10 rounded-lg bg-card border">
          <p className="text-muted-foreground">No vest paired. Please pair a vest to see live data.</p>
        </div>
      );
    }
    if (telemetryLoading) {
      return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      );
    }
    if (!telemetry) {
        return (
            <div className="text-center py-10 rounded-lg bg-card border">
              <p className="text-muted-foreground">Waiting for data from vest <span className='font-bold text-primary'>{pairedVestId}</span>...</p>
            </div>
          );
    }
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <TelemetryCard
            title="Mode"
            value={telemetry.mode}
            icon={<Wifi />}
            statusTs={telemetry.lastSeenTs}
          />
          <TelemetryCard
            title="Skin Temp"
            value={`${telemetry.skinTemp.toFixed(1)} °C`}
            icon={<Thermometer />}
          />
          <TelemetryCard
            title="Battery"
            value={`${telemetry.batteryPct}%`}
            icon={<Battery />}
            isPercentage
            percentageValue={telemetry.batteryPct}
          />
          <TelemetryCard
            title="GPS"
            value={`${telemetry.gps.lat.toFixed(4)}, ${telemetry.gps.lng.toFixed(4)}`}
            icon={<MapPin />}
            statusTs={telemetry.lastSeenTs}
          />
        </div>
    );
  };
  
  return (
    <DashboardLayout>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <VestPairing
            activeVestId={pairedVestId}
            onPair={handlePairVest}
            pairing={pairing}
            loading={pairedVestIdLoading}
          />
        </div>
        <div className="grid auto-rows-max items-start gap-4 lg:col-span-1 xl:col-span-2 md:gap-8">
            {renderTelemetry()}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                <ModeControl vestId={pairedVestId} currentMode={telemetry?.mode} />
                <VestMap gps={telemetry?.gps} />
            </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
