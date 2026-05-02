'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Loader } from '@/components/layout/loader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { VestPairing } from '@/components/dashboard/vest-pairing';
import { useRtdbValue } from '@/hooks/use-rtdb-value';
import type { VestTelemetry, GpsData } from '@/lib/types';
import { normalizeMetric, type NormalizedMetric } from '@/lib/telemetry-normalization';
import { Battery, Thermometer, Droplets, Gauge, Wind, Zap, Activity, Timer } from 'lucide-react';
import { ModeControl } from '@/components/dashboard/mode-control';
import VestMap from '@/components/dashboard/vest-map';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getDatabase, ref, set, get } from 'firebase/database';

type LastValidTelemetry = {
  skinTemp?: number;
  batteryPct?: number;
  heartRateBpm?: number;
  spo2Pct?: number;
  inletTemp?: number;
  outletTemp?: number;
  bodyTemp?: number;
  pcmTemp?: number;
  ppgTemp?: number;
  ambientTemp?: number;
  humidity?: number;
  batteryVoltage?: number;
  batteryCurrentMa?: number;
  batteryPowerMw?: number;
  flowRateLMin?: number;
  flowTotalL?: number;
  pumpPct?: number;
  gps?: GpsData;
};

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidSkinTemp = (value: unknown): value is number =>
  isValidNumber(value) && value >= 20 && value <= 45;

const isValidBattery = (value: unknown): value is number =>
  isValidNumber(value) && value >= 0 && value <= 100;

const isValidHeartRate = (value: unknown): value is number =>
  isValidNumber(value) && value >= 30 && value <= 220;

const isValidSpo2 = (value: unknown): value is number =>
  isValidNumber(value) && value >= 70 && value <= 100;

const isValidTemp = (value: unknown): value is number =>
  isValidNumber(value) && value >= -20 && value <= 85;

const isValidHumidity = (value: unknown): value is number =>
  isValidNumber(value) && value >= 0 && value <= 100;

const isValidPumpPct = (value: unknown): value is number =>
  isValidNumber(value) && value >= 0 && value <= 100;

const isValidNonNegative = (value: unknown): value is number =>
  isValidNumber(value) && value >= 0;

const isValidGps = (gps?: GpsData): gps is GpsData =>
  !!gps &&
  gps.fix === true &&
  isValidNumber(gps.lat) &&
  isValidNumber(gps.lng) &&
  gps.lat !== 0 &&
  gps.lng !== 0;

const STALE_THRESHOLDS_MS = {
  temp: 15000,
  ppg: 10000,
  gnss: 60000,
  dht: 15000,
  ina260: 15000,
  flow: 15000,
};

const formatAge = (ageMs?: number) => {
  if (ageMs === undefined || ageMs === null || ageMs < 0) {
    return '—';
  }
  if (ageMs < 1000) {
    return 'Just now';
  }
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const formatDuration = (durationMs?: number) => {
  if (durationMs === undefined || durationMs === null || durationMs < 0) {
    return '—';
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const statusToneClasses: Record<NormalizedMetric<unknown>['statusTone'], string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
  danger: 'border-rose-500/40 bg-rose-500/10 text-rose-700',
  muted: 'border-border bg-muted text-muted-foreground',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-700',
};

const StatusBadge = ({ metric }: { metric: NormalizedMetric<unknown> }) => (
  <Badge
    variant="outline"
    className={cn(
      'text-[10px] uppercase tracking-wide',
      statusToneClasses[metric.statusTone]
    )}
  >
    {metric.statusLabel}
  </Badge>
);

const MetricRow = ({
  label,
  metric,
  helper,
}: {
  label: string;
  metric: NormalizedMetric<number | string>;
  helper?: string;
}) => (
  <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/70 px-3 py-2">
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold">{metric.formattedValue}</p>
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
    </div>
    <StatusBadge metric={metric} />
  </div>
);

export default function GuardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [pairing, setPairing] = useState(false);
  const [lastValid, setLastValid] = useState<LastValidTelemetry>({});
  const [now, setNow] = useState(() => Date.now());

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
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);

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
        next.skinTemp = telemetry.skinTemp;
      }
      if (isValidBattery(telemetry.batteryPct)) {
        next.batteryPct = telemetry.batteryPct;
      }
      if (isValidHeartRate(telemetry.heartRateBpm) && telemetry.sensorOk?.ppg !== false) {
        next.heartRateBpm = telemetry.heartRateBpm;
      }
      if (isValidSpo2(telemetry.spo2Pct) && telemetry.sensorOk?.ppg !== false) {
        next.spo2Pct = telemetry.spo2Pct;
      }
      if (isValidTemp(telemetry.inletTemp) && telemetry.sensorOk?.inlet !== false) {
        next.inletTemp = telemetry.inletTemp;
      }
      if (isValidTemp(telemetry.outletTemp) && telemetry.sensorOk?.outlet !== false) {
        next.outletTemp = telemetry.outletTemp;
      }
      if (isValidTemp(telemetry.bodyTemp) && telemetry.sensorOk?.body !== false) {
        next.bodyTemp = telemetry.bodyTemp;
      }
      if (isValidTemp(telemetry.pcmTemp) && telemetry.sensorOk?.pcm !== false) {
        next.pcmTemp = telemetry.pcmTemp;
      }
      if (isValidTemp(telemetry.ppgTemp) && telemetry.sensorOk?.ppg !== false) {
        next.ppgTemp = telemetry.ppgTemp;
      }
      if (isValidTemp(telemetry.ambientTemp) && telemetry.sensorOk?.dht !== false) {
        next.ambientTemp = telemetry.ambientTemp;
      }
      if (isValidHumidity(telemetry.humidity) && telemetry.sensorOk?.dht !== false) {
        next.humidity = telemetry.humidity;
      }
      if (isValidNonNegative(telemetry.batteryVoltage) && telemetry.sensorOk?.ina260 !== false) {
        next.batteryVoltage = telemetry.batteryVoltage;
      }
      if (isValidNonNegative(telemetry.batteryCurrentMa) && telemetry.sensorOk?.ina260 !== false) {
        next.batteryCurrentMa = telemetry.batteryCurrentMa;
      }
      if (isValidNonNegative(telemetry.batteryPowerMw) && telemetry.sensorOk?.ina260 !== false) {
        next.batteryPowerMw = telemetry.batteryPowerMw;
      }
      if (isValidNonNegative(telemetry.flowRateLMin) && telemetry.sensorOk?.flow !== false) {
        next.flowRateLMin = telemetry.flowRateLMin;
      }
      if (isValidNonNegative(telemetry.flowTotalL) && telemetry.sensorOk?.flow !== false) {
        next.flowTotalL = telemetry.flowTotalL;
      }
      if (isValidPumpPct(telemetry.pumpPct)) {
        next.pumpPct = telemetry.pumpPct;
      }
      if (isValidGps(telemetry.gps) && telemetry.sensorOk?.gnss !== false) {
        next.gps = telemetry.gps;
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
      ? (now - telemetry.lastSeenTs) / 1000 >= 60
      : false;

  const currentGpsValid = telemetry ? isValidGps(telemetry.gps) : false;

  const metrics = {
    skinTemp: normalizeMetric(telemetry?.skinTemp, {
      unit: '°C',
      decimals: 1,
      validate: isValidSkinTemp,
      lastValidValue: lastValid.skinTemp,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    }),
    bodyTemp: normalizeMetric(telemetry?.bodyTemp, {
      unit: '°C',
      decimals: 1,
      validate: isValidTemp,
      sensorOk: telemetry?.sensorOk?.body,
      lastValidValue: lastValid.bodyTemp,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    }),
    heartRateBpm: normalizeMetric(telemetry?.heartRateBpm, {
      unit: 'bpm',
      validate: isValidHeartRate,
      sensorOk: telemetry?.sensorOk?.ppg,
      lastValidValue: lastValid.heartRateBpm,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.ppg,
      staleAfterMs: STALE_THRESHOLDS_MS.ppg,
    }),
    spo2Pct: normalizeMetric(telemetry?.spo2Pct, {
      unit: '%',
      validate: isValidSpo2,
      sensorOk: telemetry?.sensorOk?.ppg,
      lastValidValue: lastValid.spo2Pct,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.ppg,
      staleAfterMs: STALE_THRESHOLDS_MS.ppg,
    }),
    ppgTemp: normalizeMetric(telemetry?.ppgTemp, {
      unit: '°C',
      decimals: 1,
      validate: isValidTemp,
      sensorOk: telemetry?.sensorOk?.ppg,
      lastValidValue: lastValid.ppgTemp,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.ppg,
      staleAfterMs: STALE_THRESHOLDS_MS.ppg,
    }),
    inletTemp: normalizeMetric(telemetry?.inletTemp, {
      unit: '°C',
      decimals: 1,
      validate: isValidTemp,
      sensorOk: telemetry?.sensorOk?.inlet,
      lastValidValue: lastValid.inletTemp,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    }),
    outletTemp: normalizeMetric(telemetry?.outletTemp, {
      unit: '°C',
      decimals: 1,
      validate: isValidTemp,
      sensorOk: telemetry?.sensorOk?.outlet,
      lastValidValue: lastValid.outletTemp,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    }),
    pcmTemp: normalizeMetric(telemetry?.pcmTemp, {
      unit: '°C',
      decimals: 1,
      validate: isValidTemp,
      sensorOk: telemetry?.sensorOk?.pcm,
      lastValidValue: lastValid.pcmTemp,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    }),
    flowRateLMin: normalizeMetric(telemetry?.flowRateLMin, {
      unit: 'L/min',
      decimals: 2,
      validate: isValidNonNegative,
      sensorOk: telemetry?.sensorOk?.flow,
      lastValidValue: lastValid.flowRateLMin,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.flow,
      staleAfterMs: STALE_THRESHOLDS_MS.flow,
    }),
    flowTotalL: normalizeMetric(telemetry?.flowTotalL, {
      unit: 'L',
      decimals: 2,
      validate: isValidNonNegative,
      sensorOk: telemetry?.sensorOk?.flow,
      lastValidValue: lastValid.flowTotalL,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.flow,
      staleAfterMs: STALE_THRESHOLDS_MS.flow,
    }),
    pumpPct: normalizeMetric(telemetry?.pumpPct, {
      unit: '%',
      decimals: 0,
      validate: isValidPumpPct,
      lastValidValue: lastValid.pumpPct,
      isOffline: isVestOffline,
    }),
    ambientTemp: normalizeMetric(telemetry?.ambientTemp, {
      unit: '°C',
      decimals: 1,
      validate: isValidTemp,
      sensorOk: telemetry?.sensorOk?.dht,
      lastValidValue: lastValid.ambientTemp,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.dht,
      staleAfterMs: STALE_THRESHOLDS_MS.dht,
    }),
    humidity: normalizeMetric(telemetry?.humidity, {
      unit: '%',
      decimals: 0,
      validate: isValidHumidity,
      sensorOk: telemetry?.sensorOk?.dht,
      lastValidValue: lastValid.humidity,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.dht,
      staleAfterMs: STALE_THRESHOLDS_MS.dht,
    }),
    batteryPct: normalizeMetric(telemetry?.batteryPct, {
      unit: '%',
      decimals: 0,
      validate: isValidBattery,
      sensorOk: telemetry?.sensorOk?.ina260,
      lastValidValue: lastValid.batteryPct,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.ina260,
      staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    }),
    batteryVoltage: normalizeMetric(telemetry?.batteryVoltage, {
      unit: 'V',
      decimals: 2,
      validate: isValidNonNegative,
      sensorOk: telemetry?.sensorOk?.ina260,
      lastValidValue: lastValid.batteryVoltage,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.ina260,
      staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    }),
    batteryCurrentMa: normalizeMetric(telemetry?.batteryCurrentMa, {
      unit: 'mA',
      decimals: 0,
      validate: isValidNonNegative,
      sensorOk: telemetry?.sensorOk?.ina260,
      lastValidValue: lastValid.batteryCurrentMa,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.ina260,
      staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    }),
    batteryPowerMw: normalizeMetric(telemetry?.batteryPowerMw, {
      unit: 'mW',
      decimals: 0,
      validate: isValidNonNegative,
      sensorOk: telemetry?.sensorOk?.ina260,
      lastValidValue: lastValid.batteryPowerMw,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.ina260,
      staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    }),
    gps: normalizeMetric(telemetry?.gps, {
      validate: isValidGps,
      sensorOk: telemetry?.sensorOk?.gnss,
      lastValidValue: lastValid.gps,
      isOffline: isVestOffline,
      ageMs: telemetry?.sensorAgeMs?.gnss,
      staleAfterMs: STALE_THRESHOLDS_MS.gnss,
    }),
  };

  const displayedGps = metrics.gps.displayValue;
  let gpsStatusMessage: string | undefined;
  if (!displayedGps) {
    gpsStatusMessage = 'No GPS data available.';
  } else if (!currentGpsValid && metrics.gps.source === 'lastValid') {
    gpsStatusMessage = 'No current GPS fix. Showing last known location.';
  } else if (metrics.gps.isStale) {
    gpsStatusMessage = 'GPS data is stale.';
  } else if (displayedGps.fix === false) {
    gpsStatusMessage = 'No GPS fix available.';
  }

  const lastSeenAgeMs = telemetry?.lastSeenTs ? now - telemetry.lastSeenTs : undefined;
  const hasPairing = !!pairedVestId;
  const hasTelemetry = !!telemetry;

  const sensorHealth = [
    {
      key: 'inlet',
      label: 'Inlet',
      ok: telemetry?.sensorOk?.inlet,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    },
    {
      key: 'outlet',
      label: 'Outlet',
      ok: telemetry?.sensorOk?.outlet,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    },
    {
      key: 'body',
      label: 'Body',
      ok: telemetry?.sensorOk?.body,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    },
    {
      key: 'pcm',
      label: 'PCM',
      ok: telemetry?.sensorOk?.pcm,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
    },
    {
      key: 'ppg',
      label: 'PPG',
      ok: telemetry?.sensorOk?.ppg,
      ageMs: telemetry?.sensorAgeMs?.ppg,
      staleAfterMs: STALE_THRESHOLDS_MS.ppg,
    },
    {
      key: 'gnss',
      label: 'GNSS',
      ok: telemetry?.sensorOk?.gnss,
      ageMs: telemetry?.sensorAgeMs?.gnss,
      staleAfterMs: STALE_THRESHOLDS_MS.gnss,
    },
    {
      key: 'dht',
      label: 'DHT',
      ok: telemetry?.sensorOk?.dht,
      ageMs: telemetry?.sensorAgeMs?.dht,
      staleAfterMs: STALE_THRESHOLDS_MS.dht,
    },
    {
      key: 'ina260',
      label: 'INA260',
      ok: telemetry?.sensorOk?.ina260,
      ageMs: telemetry?.sensorAgeMs?.ina260,
      staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    },
    {
      key: 'flow',
      label: 'Flow',
      ok: telemetry?.sensorOk?.flow,
      ageMs: telemetry?.sensorAgeMs?.flow,
      staleAfterMs: STALE_THRESHOLDS_MS.flow,
    },
  ];

  const resolveSensorStatus = (item: (typeof sensorHealth)[number]) => {
    if (item.ok === false) {
      return { label: 'Failed', tone: 'danger' as const };
    }
    if (typeof item.ageMs === 'number' && item.ageMs > item.staleAfterMs) {
      return { label: 'Stale', tone: 'warn' as const };
    }
    if (item.ok === true) {
      return { label: 'OK', tone: 'ok' as const };
    }
    return { label: 'Unknown', tone: 'muted' as const };
  };
  
  return (
    <DashboardLayout>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <VestPairing
            activeVestId={pairedVestId}
            onPair={handlePairVest}
            pairing={pairing}
            loading={pairedVestIdLoading}
          />
        </div>

        <Card className="lg:col-span-8">
          <CardHeader className="gap-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Vest Status</span>
              {telemetryLoading && hasPairing ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs',
                    isVestOffline
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-700'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                  )}
                >
                  {isVestOffline ? 'Offline' : 'Live'}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {hasPairing ? (
                <span>
                  Paired vest <span className="font-semibold text-foreground">{pairedVestId}</span>
                </span>
              ) : (
                'No vest paired yet.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Mode
                </div>
                <Badge variant="outline" className="text-xs">
                  {telemetry?.mode ?? '—'}
                </Badge>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                  Pump
                </div>
                <span className="text-sm font-semibold">{metrics.pumpPct.formattedValue}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  Last update
                </div>
                <span className="text-sm font-semibold">{formatAge(lastSeenAgeMs)}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  Uptime
                </div>
                <span className="text-sm font-semibold">{formatDuration(telemetry?.uptimeMs)}</span>
              </div>
            </div>
            {!hasTelemetry && hasPairing && !telemetryLoading && (
              <p className="mt-3 text-xs text-muted-foreground">
                Waiting for telemetry from {pairedVestId}.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Human / Vitals</CardTitle>
              <CardDescription>Wearer status readings.</CardDescription>
            </div>
            <Thermometer className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid gap-3">
            <MetricRow label="Skin temp" metric={metrics.skinTemp} />
            <MetricRow label="Body temp" metric={metrics.bodyTemp} />
            <MetricRow label="Heart rate" metric={metrics.heartRateBpm} />
            <MetricRow label="SpO2" metric={metrics.spo2Pct} />
            <MetricRow label="PPG temp" metric={metrics.ppgTemp} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Cooling System</CardTitle>
              <CardDescription>Coolant loop performance.</CardDescription>
            </div>
            <Wind className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid gap-3">
            <MetricRow label="Inlet temp" metric={metrics.inletTemp} />
            <MetricRow label="Outlet temp" metric={metrics.outletTemp} />
            <MetricRow label="PCM temp" metric={metrics.pcmTemp} />
            <MetricRow label="Flow rate" metric={metrics.flowRateLMin} />
            <MetricRow label="Flow total" metric={metrics.flowTotalL} />
            <MetricRow label="Pump output" metric={metrics.pumpPct} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Battery & Power</CardTitle>
              <CardDescription>Power system metrics.</CardDescription>
            </div>
            <Battery className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid gap-3">
            <MetricRow label="Battery" metric={metrics.batteryPct} />
            <MetricRow label="Voltage" metric={metrics.batteryVoltage} />
            <MetricRow label="Current" metric={metrics.batteryCurrentMa} />
            <MetricRow label="Power" metric={metrics.batteryPowerMw} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Environment</CardTitle>
              <CardDescription>Ambient conditions.</CardDescription>
            </div>
            <Droplets className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid gap-3">
            <MetricRow label="Ambient temp" metric={metrics.ambientTemp} />
            <MetricRow label="Humidity" metric={metrics.humidity} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Sensor Health</CardTitle>
              <CardDescription>Quick sensor checks.</CardDescription>
            </div>
            <Zap className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {sensorHealth.map((sensor) => {
                const status = resolveSensorStatus(sensor);
                return (
                  <div
                    key={sensor.key}
                    className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2"
                  >
                    <span className="text-xs font-medium text-muted-foreground">{sensor.label}</span>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] uppercase tracking-wide', statusToneClasses[status.tone])}
                    >
                      {status.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-4">
          <ModeControl vestId={pairedVestId} currentMode={telemetry?.mode} isOffline={isVestOffline} />
        </div>

        <Card className="lg:col-span-12">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="text-base">Location</CardTitle>
              <CardDescription>
                {gpsStatusMessage ?? 'Live GNSS location and accuracy.'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  displayedGps?.fix === true
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-700'
                )}
              >
                {displayedGps?.fix === true ? 'GPS Fix' : 'No Fix'}
              </Badge>
              <Badge
                variant="outline"
                className={cn('text-xs', statusToneClasses[metrics.gps.statusTone])}
              >
                {metrics.gps.statusLabel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
              <VestMap gps={displayedGps} statusMessage={gpsStatusMessage} variant="plain" />
              <div className="grid gap-3">
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Latitude / Longitude</p>
                  <p className="text-sm font-semibold">
                    {displayedGps && isValidNumber(displayedGps.lat) && isValidNumber(displayedGps.lng)
                      ? `${displayedGps.lat.toFixed(5)}, ${displayedGps.lng.toFixed(5)}`
                      : '—'}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Accuracy</p>
                  <p className="text-sm font-semibold">
                    {displayedGps?.accuracyM ? `±${displayedGps.accuracyM.toFixed(0)} m` : '—'}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">GPS age</p>
                  <p className="text-sm font-semibold">
                    {formatAge(telemetry?.sensorAgeMs?.gnss)}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Last GPS update</p>
                  <p className="text-sm font-semibold">
                    {telemetry?.gps?.gpsTs ? formatAge(now - telemetry.gps.gpsTs) : '—'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
