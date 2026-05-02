'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Loader } from '@/components/layout/loader';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { VestPairing } from '@/components/dashboard/vest-pairing';
import { useRtdbValue } from '@/hooks/use-rtdb-value';
import type { VestTelemetry, GpsData } from '@/lib/types';
import TelemetryCard from '@/components/dashboard/telemetry-card';
import { Battery, Thermometer, HeartPulse, Droplets } from 'lucide-react';
import { ModeControl } from '@/components/dashboard/mode-control';
import VestMap from '@/components/dashboard/vest-map';
import { Skeleton } from '@/components/ui/skeleton';
import { getDatabase, ref, set, get } from 'firebase/database';

type LastValidMetric<T> = {
  value: T;
};

type LastValidTelemetry = {
  skinTemp?: LastValidMetric<number>;
  batteryPct?: LastValidMetric<number>;
  heartRateBpm?: LastValidMetric<number>;
  spo2Pct?: LastValidMetric<number>;
  gps?: LastValidMetric<GpsData>;
};

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidSkinTemp = (value: unknown): value is number =>
  isValidNumber(value) && value >= 20 && value <= 45;

const isValidBattery = (value: unknown): value is number =>
  isValidNumber(value) && value >= 1 && value <= 100;

const isValidHeartRate = (value: unknown): value is number =>
  isValidNumber(value) && value >= 30 && value <= 220;

const isValidSpo2 = (value: unknown): value is number =>
  isValidNumber(value) && value >= 70 && value <= 100;

const isValidGps = (gps?: GpsData): gps is GpsData =>
  !!gps &&
  gps.fix === true &&
  isValidNumber(gps.lat) &&
  isValidNumber(gps.lng) &&
  gps.lat !== 0 &&
  gps.lng !== 0;

export default function GuardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [pairing, setPairing] = useState(false);
  const [lastValid, setLastValid] = useState<LastValidTelemetry>({});

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

  useEffect(() => {
    // Avoid carrying last-known values across different paired vests.
    setLastValid({});
  }, [pairedVestId]);

  useEffect(() => {
    if (!telemetry) {
      return;
    }

    setLastValid((prev) => {
      const next: LastValidTelemetry = { ...prev };

      if (isValidSkinTemp(telemetry.skinTemp)) {
        next.skinTemp = { value: telemetry.skinTemp };
      }
      if (isValidBattery(telemetry.batteryPct)) {
        next.batteryPct = { value: telemetry.batteryPct };
      }
      if (isValidHeartRate(telemetry.heartRateBpm)) {
        next.heartRateBpm = { value: telemetry.heartRateBpm };
      }
      if (isValidSpo2(telemetry.spo2Pct)) {
        next.spo2Pct = { value: telemetry.spo2Pct };
      }
      if (isValidGps(telemetry.gps)) {
        next.gps = { value: telemetry.gps };
      }

      return next;
    });
  }, [telemetry]);

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

  const currentGpsValid = telemetry ? isValidGps(telemetry.gps) : false;
  const displayedGps = telemetry
    ? currentGpsValid
      ? telemetry.gps
      : lastValid.gps?.value
    : undefined;
  const gpsStatusMessage = telemetry && !currentGpsValid
    ? displayedGps
      ? 'No current GPS fix. User may be indoors. Showing last known location.'
      : 'No GPS data available.'
    : undefined;

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

    const currentSkinValid = isValidSkinTemp(telemetry.skinTemp);
    const currentHeartRateValid = isValidHeartRate(telemetry.heartRateBpm);
    const currentSpo2Valid = isValidSpo2(telemetry.spo2Pct);
    const displayedSkinTemp = currentSkinValid ? telemetry.skinTemp : lastValid.skinTemp?.value;
    const displayedBattery = isValidBattery(telemetry.batteryPct) ? telemetry.batteryPct : lastValid.batteryPct?.value;
    const displayedHeartRate = currentHeartRateValid ? telemetry.heartRateBpm : lastValid.heartRateBpm?.value;
    const displayedSpo2 = currentSpo2Valid ? telemetry.spo2Pct : lastValid.spo2Pct?.value;

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <TelemetryCard
            title="Skin Temp"
            value={displayedSkinTemp !== undefined ? `${displayedSkinTemp.toFixed(1)} °C` : '—'}
            icon={<Thermometer />}
          />
          <TelemetryCard
            title="Battery"
            value={displayedBattery !== undefined ? `${displayedBattery}%` : '—'}
            icon={<Battery />}
            isPercentage={displayedBattery !== undefined}
            percentageValue={displayedBattery ?? 0}
          />
          <TelemetryCard
            title="Heart Rate"
            value={displayedHeartRate !== undefined ? `${displayedHeartRate}` : '—'}
            icon={<HeartPulse />}
            unit="bpm"
          />
          <TelemetryCard
            title="SpO₂"
            value={displayedSpo2 !== undefined ? `${displayedSpo2}` : '—'}
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
              <VestMap gps={displayedGps} statusMessage={gpsStatusMessage} />
            </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
