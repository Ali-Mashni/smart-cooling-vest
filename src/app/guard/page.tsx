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
import {
  normalizeMetric,
  type NormalizedMetric,
  type MetricStatusTone,
} from '@/lib/telemetry-normalization';
import { Battery, Thermometer, HeartPulse, Droplets, Wind } from 'lucide-react';
import { ModeControl } from '@/components/dashboard/mode-control';
import VestMap from '@/components/dashboard/vest-map';
import { cn } from '@/lib/utils';
import { getDatabase, ref, set, get } from 'firebase/database';

type LastValidTelemetry = {
  gps?: GpsData;
};

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonZeroNumber = (value: unknown): value is number =>
  isValidNumber(value) && value !== 0;

const isValidSkinTemp = (value: unknown): value is number =>
  isNonZeroNumber(value) && value >= 20 && value <= 45;

const isValidBattery = (value: unknown): value is number =>
  isNonZeroNumber(value) && value >= 0 && value <= 100;

const isValidHeartRate = (value: unknown): value is number =>
  isNonZeroNumber(value) && value >= 30 && value <= 220;

const isValidSpo2 = (value: unknown): value is number =>
  isNonZeroNumber(value) && value >= 70 && value <= 100;

const isValidTemp = (value: unknown): value is number =>
  isNonZeroNumber(value) && value >= -20 && value <= 85;

const isValidBodyTemp = (value: unknown): value is number =>
  isNonZeroNumber(value) && value >= 25 && value <= 45;

const isValidHumidity = (value: unknown): value is number =>
  isNonZeroNumber(value) && value >= 0 && value <= 100;

const isValidPumpPct = (value: unknown): value is number =>
  isValidNumber(value) && value >= 0 && value <= 100;

const isValidPositive = (value: unknown): value is number =>
  isNonZeroNumber(value) && value > 0;

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

const PCM_TEMP_THRESHOLDS_C = {
  coldMax: 18,
  warmMax: 26,
};

const FLOW_OK_MIN_L_MIN = 0.3;
const LOOP_DELTA_ACTIVE_C = 0.8;
const LOOP_DELTA_LOW_C = 0.3;

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

const statusToneClasses: Record<MetricStatusTone, string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
  danger: 'border-rose-500/40 bg-rose-500/10 text-rose-700',
  muted: 'border-border bg-muted text-muted-foreground',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-700',
};

const StatusPill = ({ label, tone }: { label: string; tone: MetricStatusTone }) => (
  <Badge
    variant="outline"
    className={cn('text-[10px] uppercase tracking-wide', statusToneClasses[tone])}
  >
    {label}
  </Badge>
);

const StatusBadge = ({ metric }: { metric: NormalizedMetric<unknown> }) => (
  <StatusPill label={metric.statusLabel} tone={metric.statusTone} />
);

const TopStat = ({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: { label: string; tone: MetricStatusTone };
}) => (
  <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/70 px-3 py-2">
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
    {status && <StatusPill label={status.label} tone={status.tone} />}
  </div>
);

const LiveMetricCard = ({
  title,
  metric,
  icon,
  helper,
}: {
  title: string;
  metric: NormalizedMetric<number | string>;
  icon?: React.ReactNode;
  helper?: string;
}) => (
  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-3">
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>{title}</span>
      {icon}
    </div>
    <div className="mt-2 flex items-end justify-between gap-2">
      <div className="text-2xl font-semibold">{metric.formattedValue}</div>
      <StatusBadge metric={metric} />
    </div>
    {helper && <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>}
  </div>
);

const CompactMetricCard = ({
  title,
  metric,
  helper,
}: {
  title: string;
  metric: NormalizedMetric<number | string>;
  helper?: string;
}) => (
  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted-foreground">{title}</p>
      <StatusBadge metric={metric} />
    </div>
    <p className="mt-2 text-lg font-semibold">{metric.formattedValue}</p>
    {helper && <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>}
  </div>
);

const DerivedStatusCard = ({
  title,
  value,
  statusLabel,
  statusTone,
  helper,
}: {
  title: string;
  value: string;
  statusLabel: string;
  statusTone: MetricStatusTone;
  helper?: string;
}) => (
  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2">
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted-foreground">{title}</p>
      <StatusPill label={statusLabel} tone={statusTone} />
    </div>
    <p className="mt-2 text-sm font-semibold">{value}</p>
    {helper && <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>}
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

  const lastSeenAgeMs = telemetry?.lastSeenTs ? now - telemetry.lastSeenTs : undefined;
  const hasPairing = !!pairedVestId;

  const criticalLabels = {
    live: 'Live',
    stale: 'Stale',
    offline: 'Offline',
    missing: 'No live reading',
    invalid: 'No live reading',
    zero: 'No live reading',
  };

  const ppgLabels = {
    ...criticalLabels,
    zero: 'Waiting for finger',
  };

  const derivedLabels = {
    live: 'Live',
    stale: 'Stale',
    offline: 'Unavailable',
    missing: 'Unavailable',
    invalid: 'Unavailable',
    zero: 'Unavailable',
    unavailable: 'Unavailable',
  };

  const controlLabels = {
    live: 'Live',
    stale: 'Stale',
    offline: 'Offline',
    lastReceived: 'Last received',
    missing: 'Unavailable',
    invalid: 'Unavailable',
    zero: 'Unavailable',
  };

  const skinMetric = normalizeMetric(telemetry?.skinTemp, {
    category: 'criticalLive',
    unit: '°C',
    decimals: 1,
    validate: isValidSkinTemp,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.temp,
    staleAfterMs: STALE_THRESHOLDS_MS.temp,
    labels: criticalLabels,
  });

  const bodyMetric = normalizeMetric(telemetry?.bodyTemp, {
    category: 'criticalLive',
    unit: '°C',
    decimals: 1,
    validate: isValidBodyTemp,
    sensorOk: telemetry?.sensorOk?.body,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.temp,
    staleAfterMs: STALE_THRESHOLDS_MS.temp,
    labels: criticalLabels,
  });

  const heartMetric = normalizeMetric(telemetry?.heartRateBpm, {
    category: 'criticalLive',
    unit: 'bpm',
    validate: isValidHeartRate,
    sensorOk: telemetry?.sensorOk?.ppg,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.ppg,
    staleAfterMs: STALE_THRESHOLDS_MS.ppg,
    labels: ppgLabels,
  });

  const spo2Metric = normalizeMetric(telemetry?.spo2Pct, {
    category: 'criticalLive',
    unit: '%',
    validate: isValidSpo2,
    sensorOk: telemetry?.sensorOk?.ppg,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.ppg,
    staleAfterMs: STALE_THRESHOLDS_MS.ppg,
    labels: ppgLabels,
  });

  const pumpMetric = normalizeMetric(telemetry?.pumpPct, {
    category: 'control',
    unit: '%',
    decimals: 0,
    validate: isValidPumpPct,
    isOffline: isVestOffline,
    labels: controlLabels,
  });

  const batteryMetric = normalizeMetric(telemetry?.batteryPct, {
    category: 'control',
    unit: '%',
    decimals: 0,
    validate: isValidBattery,
    sensorOk: telemetry?.sensorOk?.ina260,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.ina260,
    staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    allowZero: false,
    labels: controlLabels,
  });

  const ambientMetric = normalizeMetric(telemetry?.ambientTemp, {
    category: 'engineeringDerived',
    unit: '°C',
    decimals: 1,
    validate: isValidTemp,
    sensorOk: telemetry?.sensorOk?.dht,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.dht,
    staleAfterMs: STALE_THRESHOLDS_MS.dht,
    labels: derivedLabels,
  });

  const humidityMetric = normalizeMetric(telemetry?.humidity, {
    category: 'engineeringDerived',
    unit: '%',
    decimals: 0,
    validate: isValidHumidity,
    sensorOk: telemetry?.sensorOk?.dht,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.dht,
    staleAfterMs: STALE_THRESHOLDS_MS.dht,
    labels: derivedLabels,
  });

  const batteryVoltageMetric = normalizeMetric(telemetry?.batteryVoltage, {
    category: 'engineeringDerived',
    unit: 'V',
    decimals: 2,
    validate: isValidPositive,
    sensorOk: telemetry?.sensorOk?.ina260,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.ina260,
    staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    labels: derivedLabels,
  });

  const batteryCurrentMetric = normalizeMetric(telemetry?.batteryCurrentMa, {
    category: 'engineeringDerived',
    unit: 'mA',
    decimals: 0,
    validate: isValidPositive,
    sensorOk: telemetry?.sensorOk?.ina260,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.ina260,
    staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    labels: derivedLabels,
  });

  const batteryPowerMetric = normalizeMetric(telemetry?.batteryPowerMw, {
    category: 'engineeringDerived',
    unit: 'mW',
    decimals: 0,
    validate: isValidPositive,
    sensorOk: telemetry?.sensorOk?.ina260,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.ina260,
    staleAfterMs: STALE_THRESHOLDS_MS.ina260,
    labels: derivedLabels,
  });

  const inletMetric = normalizeMetric(telemetry?.inletTemp, {
    category: 'engineeringDerived',
    unit: '°C',
    decimals: 1,
    validate: isValidTemp,
    sensorOk: telemetry?.sensorOk?.inlet,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.temp,
    staleAfterMs: STALE_THRESHOLDS_MS.temp,
    labels: derivedLabels,
  });

  const outletMetric = normalizeMetric(telemetry?.outletTemp, {
    category: 'engineeringDerived',
    unit: '°C',
    decimals: 1,
    validate: isValidTemp,
    sensorOk: telemetry?.sensorOk?.outlet,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.temp,
    staleAfterMs: STALE_THRESHOLDS_MS.temp,
    labels: derivedLabels,
  });

  const pcmMetric = normalizeMetric(telemetry?.pcmTemp, {
    category: 'engineeringDerived',
    unit: '°C',
    decimals: 1,
    validate: isValidTemp,
    sensorOk: telemetry?.sensorOk?.pcm,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.temp,
    staleAfterMs: STALE_THRESHOLDS_MS.temp,
    labels: derivedLabels,
  });

  const gpsMetric = normalizeMetric(telemetry?.gps, {
    category: 'slowLastKnown',
    validate: isValidGps,
    sensorOk: telemetry?.sensorOk?.gnss,
    lastValidValue: lastValid.gps,
    isOffline: isVestOffline,
    ageMs: telemetry?.sensorAgeMs?.gnss,
    staleAfterMs: STALE_THRESHOLDS_MS.gnss,
    labels: {
      live: 'Live GPS',
      stale: 'GPS stale',
      missing: 'No GPS data',
      invalid: 'No GPS fix',
      lastKnown: 'Last known location',
    },
  });

  const displayedGps = gpsMetric.displayValue;
  const gpsStatus = (() => {
    if (isVestOffline) {
      return displayedGps
        ? { label: 'Last known location', tone: 'info' as const }
        : { label: 'Unavailable', tone: 'muted' as const };
    }
    if (telemetry?.sensorOk?.gnss === false) {
      return { label: 'Sensor failed', tone: 'danger' as const };
    }
    if (telemetry?.gps && telemetry.gps.fix === false) {
      return { label: 'No GPS fix', tone: 'warn' as const };
    }
    if (gpsMetric.isStale) {
      return { label: 'GPS stale', tone: 'warn' as const };
    }
    if (gpsMetric.source === 'lastValid') {
      return { label: 'Last known location', tone: 'info' as const };
    }
    if (gpsMetric.isValid) {
      return { label: 'Live GPS', tone: 'ok' as const };
    }
    return { label: 'No GPS data', tone: 'muted' as const };
  })();

  const gpsStatusMessage = (() => {
    if (gpsStatus.label === 'Live GPS') {
      return undefined;
    }
    if (gpsStatus.label === 'Last known location') {
      return 'Showing last known location.';
    }
    if (gpsStatus.label === 'GPS stale') {
      return 'GPS data is stale.';
    }
    if (gpsStatus.label === 'No GPS fix') {
      return 'No GPS fix available.';
    }
    return 'No GPS data available.';
  })();

  const inletValue = typeof inletMetric.displayValue === 'number' ? inletMetric.displayValue : undefined;
  const outletValue = typeof outletMetric.displayValue === 'number' ? outletMetric.displayValue : undefined;
  const loopDeltaValue =
    inletValue !== undefined && outletValue !== undefined
      ? outletValue - inletValue
      : undefined;
  const loopDeltaText =
    loopDeltaValue !== undefined
      ? `${loopDeltaValue >= 0 ? '+' : ''}${loopDeltaValue.toFixed(1)} °C`
      : '—';

  const loopDeltaStatus = (() => {
    if (isVestOffline || loopDeltaValue === undefined) {
      return { label: 'Unavailable', tone: 'muted' as const };
    }
    if (loopDeltaValue >= LOOP_DELTA_ACTIVE_C) {
      return { label: 'Heat pickup', tone: 'ok' as const };
    }
    if (loopDeltaValue <= -LOOP_DELTA_LOW_C) {
      return { label: 'Reverse delta', tone: 'warn' as const };
    }
    if (Math.abs(loopDeltaValue) >= LOOP_DELTA_LOW_C) {
      return { label: 'Low effect', tone: 'warn' as const };
    }
    return { label: 'Low effect', tone: 'muted' as const };
  })();

  const coolingStatus = (() => {
    if (isVestOffline) {
      return {
        value: 'Unavailable',
        statusLabel: 'Unavailable',
        statusTone: 'muted' as const,
        helper: 'Loop delta unavailable.',
      };
    }
    if (loopDeltaValue === undefined) {
      return {
        value: 'Unavailable',
        statusLabel: 'Unavailable',
        statusTone: 'muted' as const,
        helper: 'Loop delta unavailable.',
      };
    }
    if (loopDeltaValue >= LOOP_DELTA_ACTIVE_C) {
      return {
        value: 'Cooling loop absorbing heat',
        statusLabel: 'Live',
        statusTone: 'ok' as const,
        helper: `Loop delta ${loopDeltaText}`,
      };
    }
    if (loopDeltaValue <= -LOOP_DELTA_LOW_C) {
      return {
        value: 'Reverse delta detected',
        statusLabel: 'Live',
        statusTone: 'warn' as const,
        helper: `Loop delta ${loopDeltaText}`,
      };
    }
    if (loopDeltaValue >= LOOP_DELTA_LOW_C) {
      return {
        value: 'Low loop effect',
        statusLabel: 'Live',
        statusTone: 'warn' as const,
        helper: `Loop delta ${loopDeltaText}`,
      };
    }
    return {
      value: 'Low loop effect',
      statusLabel: 'Live',
      statusTone: 'muted' as const,
      helper: `Loop delta ${loopDeltaText}`,
    };
  })();

  const flowStatus = (() => {
    const flowAgeMs = telemetry?.sensorAgeMs?.flow;
    const flowValue = telemetry?.flowRateLMin;
    const flowHasValue = isValidNumber(flowValue);
    const flowIsStale = typeof flowAgeMs === 'number' && flowAgeMs > STALE_THRESHOLDS_MS.flow;

    if (isVestOffline) {
      return { value: 'Unavailable', statusLabel: 'Unavailable', statusTone: 'muted' as const };
    }
    if (telemetry?.sensorOk?.flow === false) {
      return { value: 'Sensor failed', statusLabel: 'Sensor failed', statusTone: 'danger' as const };
    }
    if (flowIsStale) {
      return { value: 'Stale', statusLabel: 'Stale', statusTone: 'warn' as const };
    }
    if (!flowHasValue) {
      return { value: 'Unavailable', statusLabel: 'Unavailable', statusTone: 'muted' as const };
    }
    if (flowValue === 0) {
      return { value: 'No flow detected', statusLabel: 'No flow', statusTone: 'warn' as const };
    }
    if (flowValue < FLOW_OK_MIN_L_MIN) {
      return { value: 'Low flow', statusLabel: 'Low flow', statusTone: 'warn' as const };
    }
    return { value: 'Flow OK', statusLabel: 'Flow OK', statusTone: 'ok' as const };
  })();

  const pcmStatus = (() => {
    const pcmValue = typeof pcmMetric.displayValue === 'number' ? pcmMetric.displayValue : undefined;
    if (isVestOffline) {
      return { value: 'Unavailable', statusLabel: 'Unavailable', statusTone: 'muted' as const };
    }
    if (!pcmMetric.isValid || pcmValue === undefined) {
      return { value: 'Unavailable', statusLabel: pcmMetric.statusLabel, statusTone: pcmMetric.statusTone };
    }
    if (pcmValue <= PCM_TEMP_THRESHOLDS_C.coldMax) {
      return { value: 'Cold / ready', statusLabel: 'Cold', statusTone: 'ok' as const };
    }
    if (pcmValue <= PCM_TEMP_THRESHOLDS_C.warmMax) {
      return { value: 'Warming', statusLabel: 'Warming', statusTone: 'warn' as const };
    }
    return { value: 'Warm', statusLabel: 'Warm', statusTone: 'warn' as const };
  })();

  const criticalHelper = (metric: NormalizedMetric<unknown>) => {
    if (isVestOffline && lastSeenAgeMs !== undefined) {
      return `Last update ${formatAge(lastSeenAgeMs)}`;
    }
    if (metric.isStale && metric.ageMs !== undefined) {
      return `Sensor age ${formatAge(metric.ageMs)}`;
    }
    return undefined;
  };

  const tempOkValues = [
    telemetry?.sensorOk?.inlet,
    telemetry?.sensorOk?.outlet,
    telemetry?.sensorOk?.body,
    telemetry?.sensorOk?.pcm,
  ];
  const tempOk = tempOkValues.every((value) => value === true)
    ? true
    : tempOkValues.some((value) => value === false)
      ? false
      : undefined;

  const sensorHealth = [
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
      key: 'temp',
      label: 'Temp',
      ok: tempOk,
      ageMs: telemetry?.sensorAgeMs?.temp,
      staleAfterMs: STALE_THRESHOLDS_MS.temp,
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
  
  const onlineStatus = isVestOffline
    ? { label: 'Offline', tone: 'danger' as const }
    : { label: 'Online', tone: 'ok' as const };
  const modeStatus = !telemetry?.mode
    ? { label: 'Unavailable', tone: 'muted' as const }
    : isVestOffline
      ? { label: 'Last received', tone: 'info' as const }
      : { label: 'Live', tone: 'ok' as const };
  const pumpStatus = { label: pumpMetric.statusLabel, tone: pumpMetric.statusTone };
  const batteryStatus = { label: batteryMetric.statusLabel, tone: batteryMetric.statusTone };

  return (
    <DashboardLayout>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <Card>
          <CardContent className="p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <TopStat label="Vest" value={pairedVestId ?? 'Not paired'} status={onlineStatus} />
              <TopStat label="Mode" value={telemetry?.mode ?? '—'} status={modeStatus} />
              <TopStat label="Pump" value={pumpMetric.formattedValue} status={pumpStatus} />
              <TopStat label="Battery" value={batteryMetric.formattedValue} status={batteryStatus} />
              <TopStat label="Last update" value={formatAge(lastSeenAgeMs)} />
            </div>
            {telemetryLoading && hasPairing && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Loading latest telemetry…
              </p>
            )}
            {!telemetry && hasPairing && !telemetryLoading && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Waiting for telemetry from {pairedVestId}.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Safety / Live Vitals</CardTitle>
              <CardDescription>Live-only safety readings.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <LiveMetricCard
                title="Skin temp"
                metric={skinMetric}
                icon={<Thermometer className="h-4 w-4" />}
                helper={criticalHelper(skinMetric)}
              />
              <LiveMetricCard
                title="Body temp"
                metric={bodyMetric}
                icon={<Thermometer className="h-4 w-4" />}
                helper={criticalHelper(bodyMetric)}
              />
              <LiveMetricCard
                title="Heart rate"
                metric={heartMetric}
                icon={<HeartPulse className="h-4 w-4" />}
                helper={criticalHelper(heartMetric)}
              />
              <LiveMetricCard
                title="SpO2"
                metric={spo2Metric}
                icon={<Droplets className="h-4 w-4" />}
                helper={criticalHelper(spo2Metric)}
              />
            </CardContent>
          </Card>

          <div className="lg:col-span-4 grid gap-4">
            <VestPairing
              activeVestId={pairedVestId}
              onPair={handlePairVest}
              pairing={pairing}
              loading={pairedVestIdLoading}
            />
            <ModeControl vestId={pairedVestId} currentMode={telemetry?.mode} isOffline={isVestOffline} />
          </div>

          <Card className="lg:col-span-8">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Cooling impact</CardTitle>
                  <CardDescription>Derived status from loop sensors.</CardDescription>
                </div>
                <Wind className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <DerivedStatusCard
                title="Cooling status"
                value={coolingStatus.value}
                statusLabel={coolingStatus.statusLabel}
                statusTone={coolingStatus.statusTone}
                helper={coolingStatus.helper}
              />
              <DerivedStatusCard
                title="Loop delta"
                value={loopDeltaText}
                statusLabel={loopDeltaStatus.label}
                statusTone={loopDeltaStatus.tone}
                helper="Heat pickup indicator"
              />
              <DerivedStatusCard
                title="Flow status"
                value={flowStatus.value}
                statusLabel={flowStatus.statusLabel}
                statusTone={flowStatus.statusTone}
              />
              <DerivedStatusCard
                title="PCM status"
                value={pcmStatus.value}
                statusLabel={pcmStatus.statusLabel}
                statusTone={pcmStatus.statusTone}
              />
              <DerivedStatusCard
                title="Pump output"
                value={pumpMetric.formattedValue}
                statusLabel={pumpMetric.statusLabel}
                statusTone={pumpMetric.statusTone}
              />
            </CardContent>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Battery & Environment</CardTitle>
                  <CardDescription>Power and ambient conditions.</CardDescription>
                </div>
                <Battery className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <CompactMetricCard title="Battery" metric={batteryMetric} />
                <CompactMetricCard title="Ambient temp" metric={ambientMetric} />
                <CompactMetricCard title="Humidity" metric={humidityMetric} />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Voltage</p>
                  <p className="text-xs font-semibold">{batteryVoltageMetric.formattedValue}</p>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Current</p>
                  <p className="text-xs font-semibold">{batteryCurrentMetric.formattedValue}</p>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Power</p>
                  <p className="text-xs font-semibold">{batteryPowerMetric.formattedValue}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-12">
            <CardHeader className="flex flex-col gap-2 pb-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-base">Location</CardTitle>
                <CardDescription>
                  {gpsStatusMessage ?? 'Live GNSS location and accuracy.'}
                </CardDescription>
              </div>
              <StatusPill label={gpsStatus.label} tone={gpsStatus.tone} />
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
                <VestMap
                  gps={displayedGps}
                  statusMessage={gpsStatusMessage}
                  variant="plain"
                  size="compact"
                />
                <div className="grid gap-2">
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
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-12">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Diagnostics</CardTitle>
              <CardDescription>Sensor health snapshot (optional).</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  View sensor health
                </summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {sensorHealth.map((sensor) => {
                    const status = resolveSensorStatus(sensor);
                    return (
                      <div
                        key={sensor.key}
                        className="flex items-center justify-between rounded-md border border-border/60 bg-background/70 px-3 py-2"
                      >
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {sensor.label}
                        </span>
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
              </details>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
