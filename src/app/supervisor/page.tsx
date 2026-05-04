'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { SupervisorFleetList } from '@/components/dashboard/supervisor-fleet-list';
import VestMap from '@/components/dashboard/vest-map';
import { SupervisorHistorySummary } from '@/components/dashboard/supervisor-history-summary';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Loader } from '@/components/layout/loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRtdbValue } from '@/hooks/use-rtdb-value';
import type { UserProfile, VestTelemetry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowLeft, ShieldCheck, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, Suspense, useState } from 'react';
import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const OFFLINE_MS = 60000;
const LOW_BATTERY_PCT = 20;
const HIGH_SKIN_TEMP_C = 38.5;
const HIGH_BODY_TEMP_C = 38.5;
const MIN_HEART_RATE_BPM = 30;
const MAX_HEART_RATE_BPM = 220;
const MIN_SPO2_PCT = 70;
const MAX_SPO2_PCT = 100;

const statusToneClasses = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  attention: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
  offline: 'border-rose-500/40 bg-rose-500/10 text-rose-700',
} as const;

const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidNonZeroNumber = (value: unknown): value is number =>
  isValidNumber(value) && value !== 0;

const isValidTemp = (value: unknown, min: number, max: number): value is number =>
  isValidNonZeroNumber(value) && value >= min && value <= max;

const isValidBattery = (value: unknown): value is number =>
  isValidNonZeroNumber(value) && value >= 0 && value <= 100;

const isValidHeartRate = (value: unknown): value is number =>
  isValidNonZeroNumber(value) && value >= MIN_HEART_RATE_BPM && value <= MAX_HEART_RATE_BPM;

const isValidSpo2 = (value: unknown): value is number =>
  isValidNonZeroNumber(value) && value >= MIN_SPO2_PCT && value <= MAX_SPO2_PCT;

const isValidGps = (gps: VestTelemetry['gps']): boolean =>
  !!gps &&
  gps.fix === true &&
  isValidNonZeroNumber(gps.lat) &&
  isValidNonZeroNumber(gps.lng);

const formatAge = (lastSeenTs: number | undefined, now: number) => {
  if (!lastSeenTs) return '—';
  const diffMs = now - lastSeenTs;
  if (diffMs < 0) return '—';
  if (diffMs < 1000) return 'Just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

const formatValue = (value: number | undefined, unit = '', decimals = 0, allowZero = false) => {
  if (!isValidNumber(value)) return '—';
  if (!allowZero && value === 0) return '—';
  const formatted = decimals > 0 ? value.toFixed(decimals) : value.toFixed(0);
  return unit ? `${formatted}${unit}` : formatted;
};

const SummaryTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-base font-semibold">{value}</p>
  </div>
);

const DetailSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-border/60 bg-background/80 p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    <div className="mt-2 space-y-1 text-sm">{children}</div>
  </div>
);

const DetailItem = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium">{value}</span>
  </div>
);

const buildAttentionReasons = (current: VestTelemetry, isOnline: boolean) => {
  if (!isOnline) {
    return ['Vest offline'];
  }

  const reasons: string[] = [];
  const batteryPct = current.batteryPct;
  const skinTemp = current.skinTemp;
  const bodyTemp = current.bodyTemp;
  const heartRate = current.heartRateBpm;
  const spo2 = current.spo2Pct;
  const gps = current.gps;
  const pumpPct = current.pumpPct;
  const flowRate = current.flowRateLMin;

  if (isValidBattery(batteryPct) && batteryPct < LOW_BATTERY_PCT) {
    reasons.push('Low battery');
  }

  if (!isValidHeartRate(heartRate)) {
    reasons.push('Heart rate missing');
  }

  if (!isValidSpo2(spo2)) {
    reasons.push('SpO2 missing');
  }

  if (isValidTemp(skinTemp, 20, 45) && skinTemp >= HIGH_SKIN_TEMP_C) {
    reasons.push('High skin temp');
  }

  if (isValidTemp(bodyTemp, 25, 45) && bodyTemp >= HIGH_BODY_TEMP_C) {
    reasons.push('High body temp');
  }

  if (!isValidGps(gps)) {
    reasons.push('No GPS fix');
  }

  const flowExpected =
    (isValidNumber(pumpPct) && pumpPct > 0) || (current.mode && current.mode !== 'Off');
  const flowAvailable = isValidNumber(flowRate) && flowRate > 0 && current.sensorOk?.flow !== false;
  if (flowExpected && !flowAvailable) {
    reasons.push('Flow unavailable');
  }

  return reasons;
};

function SupervisorVestDetail({ vestId }: { vestId: string }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  const vestTelemetryPath = vestId ? `/vests/${vestId}/current` : null;
  const { data: telemetry, loading: telemetryLoading } =
    useRtdbValue<VestTelemetry>(vestTelemetryPath);
  const { data: activeGuards } = useRtdbValue<{ [guardUid: string]: string }>(
    '/activeVestByGuard'
  );
  const { data: users } = useRtdbValue<{ [uid: string]: UserProfile }>('/users');

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  if (authLoading || !user) {
    return <Loader />;
  }

  const current = (telemetry ?? {}) as VestTelemetry;
  const hasNow = now !== null;
  const nowMs = now ?? 0;
  const lastSeenTs = current.lastSeenTs;
  const isOnline = hasNow && !!lastSeenTs && nowMs - lastSeenTs < OFFLINE_MS;
  const attentionReasons = buildAttentionReasons(current, isOnline);
  const status: 'ok' | 'attention' | 'offline' = !isOnline
    ? 'offline'
    : attentionReasons.length > 0
      ? 'attention'
      : 'ok';
  const statusLabel =
    status === 'offline' ? 'Offline' : status === 'attention' ? 'Needs attention' : 'OK';

  const guardUid = activeGuards
    ? Object.keys(activeGuards).find((uid) => activeGuards[uid] === vestId) || null
    : null;
  const guardInfo = guardUid && users ? users[guardUid] : null;
  const guardDisplay =
    guardInfo?.displayName || guardInfo?.email || (guardUid ? `...${guardUid.slice(-6)}` : 'Unassigned');

  const batteryText = isValidBattery(current.batteryPct)
    ? `${current.batteryPct.toFixed(0)}%`
    : '—';
  const pumpText = formatValue(current.pumpPct, '%', 0, true);
  const modeText = current.mode ?? '—';
  const lastUpdateText = hasNow ? formatAge(lastSeenTs, nowMs) : '—';
  const gpsStatus =
    current.gps?.fix === false
      ? 'No GPS fix'
      : isValidGps(current.gps)
        ? 'Live GPS'
        : 'No GPS data';
  const hasGpsFix = isValidGps(current.gps);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="icon" asChild>
          <Link href="/supervisor">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back</span>
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Vest {vestId}</h1>
          <p className="text-xs text-muted-foreground">Supervisor inspection view.</p>
        </div>
        <Badge
          variant="outline"
          className={cn('h-6 px-2 text-[11px] font-semibold uppercase', statusToneClasses[status])}
        >
          {statusLabel}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="Assigned guard" value={guardDisplay} />
          <SummaryTile label="Battery" value={batteryText} />
          <SummaryTile label="Mode / Pump" value={`${modeText} · ${pumpText}`} />
          <SummaryTile label="Last update" value={lastUpdateText} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <DetailSection title="Health summary">
            <div className="flex items-center gap-2">
              {status === 'ok' && <ShieldCheck className="h-4 w-4 text-emerald-600" />}
              {status === 'attention' && (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              {status === 'offline' && <WifiOff className="h-4 w-4 text-rose-600" />}
              <span className="font-semibold">{statusLabel}</span>
            </div>
            {attentionReasons.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {attentionReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No issues detected.</p>
            )}
          </DetailSection>

          <DetailSection title="Vitals summary">
            <DetailItem
              label="Skin temp"
              value={formatValue(current.skinTemp, '°C', 1)}
            />
            <DetailItem
              label="Body temp"
              value={formatValue(current.bodyTemp, '°C', 1)}
            />
            <DetailItem
              label="Heart rate"
              value={formatValue(current.heartRateBpm, ' bpm', 0)}
            />
            <DetailItem
              label="SpO2"
              value={formatValue(current.spo2Pct, '%', 0)}
            />
          </DetailSection>

          <DetailSection title="Power & mode">
            <DetailItem label="Battery" value={batteryText} />
            <DetailItem label="Pump" value={pumpText} />
            <DetailItem label="Mode" value={modeText} />
            <DetailItem label="Last update" value={lastUpdateText} />
          </DetailSection>

          <DetailSection title="Location">
            <p className="text-xs text-muted-foreground">{gpsStatus}</p>
            {hasGpsFix ? (
              <div className="mt-2">
                <VestMap
                  gps={current.gps}
                  statusMessage={gpsStatus}
                  variant="plain"
                  size="compact"
                />
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Location unavailable.</p>
            )}
          </DetailSection>

          <DetailSection title="Telemetry status">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { key: 'ppg', label: 'PPG' },
                { key: 'gnss', label: 'GNSS' },
                { key: 'temp', label: 'Temp' },
                { key: 'dht', label: 'DHT' },
                { key: 'ina260', label: 'INA260' },
                { key: 'flow', label: 'Flow' },
              ].map((sensor) => {
                const ok = current.sensorOk?.[sensor.key as keyof VestTelemetry['sensorOk']];
                const label = ok === true ? 'OK' : ok === false ? 'Failed' : 'Unknown';
                const tone =
                  ok === true
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                    : ok === false
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-700'
                      : 'border-border bg-muted text-muted-foreground';
                return (
                  <div
                    key={sensor.key}
                    className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-xs"
                  >
                    <span className="text-muted-foreground">{sensor.label}</span>
                    <Badge variant="outline" className={cn('h-5 px-2 text-[10px]', tone)}>
                      {label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </DetailSection>

          <div className="lg:col-span-2">
            <SupervisorHistorySummary vestId={vestId} />
          </div>
        </div>
      </div>
      {telemetryLoading && (
        <p className="mt-3 text-xs text-muted-foreground">Loading latest telemetry...</p>
      )}
    </>
  );
}

function SupervisorPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const vestId = searchParams.get('vestId');

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return <Loader />;
  }

  return (
    <DashboardLayout>
      {vestId ? (
        <SupervisorVestDetail vestId={vestId} />
      ) : (
        <SupervisorFleetList />
      )}
    </DashboardLayout>
  );
}

export default function SupervisorPage() {
  return (
    <Suspense fallback={<Loader />}>
      <SupervisorPageContent />
    </Suspense>
  );
}
