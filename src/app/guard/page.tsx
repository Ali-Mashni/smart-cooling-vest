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
import { Battery, Thermometer, HeartPulse, Droplets } from 'lucide-react';
import { ModeControl } from '@/components/dashboard/mode-control';
import VestMap from '@/components/dashboard/vest-map';
import { Skeleton } from '@/components/ui/skeleton';
import { getDatabase, ref, set, get } from 'firebase/database';

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

    const db = getDatabase();
    
    // Trim input (preserve casing — backend will handle casing convention)
    const trimmedId = vestId.trim();
    
    if (!trimmedId) {
      const error = new Error('Vest ID cannot be empty.');
      (error as any).isValidationError = true;
      throw error;
    }

    setPairing(true);

    try {
      // Validate vest exists by checking vests/{vestId}/current
      // (meta node defined in rules but not used in current schema)
      const currentRef = ref(db, `vests/${trimmedId}/current`);
      const currentSnapshot = await get(currentRef);

      if (!currentSnapshot.exists()) {
        const error = new Error('Invalid vest ID. Please check and try again.');
        (error as any).isValidationError = true;
        throw error;
      }

      // Vest exists, safe to write pairing mapping
      const pairingRef = ref(db, `activeVestByGuard/${user.uid}`);
      await set(pairingRef, trimmedId);

      // Success — component handles feedback
    } catch (e: any) {
      // Log only unexpected errors, not validation errors
      if (!e.isValidationError) {
        console.error('Pairing validation/write failed:', e);
      }
      
      // Re-throw with user-friendly message
      if (e.message.includes('Invalid vest ID') || e.message.includes('cannot be empty')) {
        throw e; // Already user-friendly
      } else if (e.code === 'PERMISSION_DENIED') {
        throw new Error('Permission denied. Please check your access rights.');
      } else if (e.message.includes('offline')) {
        throw new Error('You appear to be offline. Please check your connection.');
      } else {
        throw new Error(e.message || 'An unexpected error occurred during pairing.');
      }
    } finally {
      setPairing(false);
    }
  };

  if (authLoading || !user) {
    return <Loader />;
  }

  // Detect if vest is offline (no data for 60+ seconds)
  const isVestOffline =
    telemetry && telemetry.lastSeenTs
      ? (Date.now() - telemetry.lastSeenTs) / 1000 >= 60
      : false;

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
            title="Heart Rate"
            value={telemetry.heartRateBpm !== undefined ? `${telemetry.heartRateBpm}` : '—'}
            icon={<HeartPulse />}
            unit="bpm"
          />
          <TelemetryCard
            title="SpO₂"
            value={telemetry.spo2Pct !== undefined ? `${telemetry.spo2Pct}` : '—'}
            icon={<Droplets />}
            unit="%"
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
              <ModeControl vestId={pairedVestId} currentMode={telemetry?.mode} isOffline={isVestOffline} />
              <VestMap gps={telemetry?.gps} />
            </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
