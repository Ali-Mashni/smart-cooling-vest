'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BatteryLow,
  ChevronDown,
  ChevronUp,
  Eye,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { useRtdbValue } from '@/hooks/use-rtdb-value';
import type { Vest, VestTelemetry, VestWithId, UserProfile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import VestMap from './vest-map';
import { SupervisorHistorySummary } from './supervisor-history-summary';

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

type FleetStatus = 'ok' | 'attention' | 'offline';

type FleetRow = {
  vestId: string;
  guardDisplay: string;
  current: VestTelemetry;
  status: FleetStatus;
  statusLabel: string;
  statusTone: keyof typeof statusToneClasses;
  attentionReasons: string[];
  batteryText: string;
  modeText: string;
  lastUpdateText: string;
  pumpText: string;
  isOnline: boolean;
  hasLowBattery: boolean;
  gpsStatus: string;
  hasGpsFix: boolean;
  sensorOk: VestTelemetry['sensorOk'];
};

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

const StatusBadge = ({ status, label }: { status: FleetStatus; label: string }) => (
  <Badge
    variant="outline"
    className={cn('h-5 px-2 text-[10px] font-semibold uppercase', statusToneClasses[status])}
  >
    {label}
  </Badge>
);

const SummaryCard = ({
  label,
  value,
  icon,
  helper,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  helper?: string;
}) => (
  <Card className="bg-muted/30">
    <CardContent className="flex items-center justify-between p-3">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
      </div>
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
    </CardContent>
  </Card>
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

export function SupervisorFleetList() {
  const {
    data: allVests,
    loading: vestsLoading,
    error: vestsError,
  } = useRtdbValue<{ [id: string]: Vest }>('/vests');
  const { data: activeGuards } = useRtdbValue<{ [guardUid: string]: string }>(
    '/activeVestByGuard'
  );
  const { data: users } = useRtdbValue<{ [uid: string]: UserProfile }>(
    '/users'
  );

  const [now, setNow] = useState<number | null>(null);
  const [expandedVestId, setExpandedVestId] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const hasNow = now !== null;
  const nowMs = now ?? 0;

  const vestToGuardMap: { [vestId: string]: string } = useMemo(() => {
    if (!activeGuards) return {};
    return Object.entries(activeGuards).reduce(
      (acc, [guardUid, vestId]) => {
        acc[vestId] = guardUid;
        return acc;
      },
      {} as { [vestId: string]: string }
    );
  }, [activeGuards]);

  const sortedVests: VestWithId[] = useMemo(() => {
    if (!allVests) return [];

    const isOnline = (vest: Vest) =>
      hasNow &&
      vest.current?.lastSeenTs &&
      nowMs - vest.current.lastSeenTs < OFFLINE_MS;

    return Object.entries(allVests)
      .map(([vestId, vestData]) => ({ ...vestData, vestId }))
      .sort((a, b) => {
        const aOnline = isOnline(a);
        const bOnline = isOnline(b);
        if (aOnline === bOnline) {
          return a.vestId.localeCompare(b.vestId);
        }
        return aOnline ? -1 : 1;
      });
  }, [allVests, hasNow, nowMs]);

  const fleetRows: FleetRow[] = useMemo(() => {
    return sortedVests.map((vest) => {
      const current = vest.current ?? {};
      const lastSeenTs = current.lastSeenTs;
      const isOnline = hasNow && !!lastSeenTs && nowMs - lastSeenTs < OFFLINE_MS;
      const attentionReasons = buildAttentionReasons(current, isOnline);
      const hasAttention = isOnline && attentionReasons.length > 0;

      const status: FleetStatus = !isOnline ? 'offline' : hasAttention ? 'attention' : 'ok';
      const statusLabel =
        status === 'offline' ? 'Offline' : status === 'attention' ? 'Needs attention' : 'OK';

      const guardUid = vestToGuardMap[vest.vestId];
      const guardInfo = guardUid && users ? users[guardUid] : null;
      const guardDisplay = guardInfo
        ? guardInfo.displayName || guardInfo.email
        : guardUid
        ? `...${guardUid.slice(-6)}`
        : 'Unassigned';

      const batteryPct = current.batteryPct;
      const hasLowBattery = isValidBattery(batteryPct) && batteryPct < LOW_BATTERY_PCT;
      const batteryText = isValidBattery(batteryPct) ? `${batteryPct.toFixed(0)}%` : '—';
      const modeText = current.mode ?? '—';
      const lastUpdateText = hasNow ? formatAge(lastSeenTs, nowMs) : '—';
      const pumpText = formatValue(current.pumpPct, '%', 0, true);

      const hasGpsFix = isValidGps(current.gps);
      const gpsStatus =
        current.gps?.fix === false
          ? 'No GPS fix'
          : hasGpsFix
            ? 'Live GPS'
            : 'No GPS data';

      return {
        vestId: vest.vestId,
        guardDisplay,
        current,
        status,
        statusLabel,
        statusTone: status,
        attentionReasons,
        batteryText,
        modeText,
        lastUpdateText,
        pumpText,
        isOnline,
        hasLowBattery,
        gpsStatus,
        hasGpsFix,
        sensorOk: current.sensorOk,
      };
    });
  }, [sortedVests, users, vestToGuardMap, hasNow, nowMs]);

  const summary = useMemo(() => {
    return fleetRows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.status === 'offline') {
          acc.offline += 1;
        } else {
          acc.online += 1;
        }
        if (row.status === 'attention') acc.needsAttention += 1;
        if (row.hasLowBattery) acc.lowBattery += 1;
        return acc;
      },
      { total: 0, online: 0, offline: 0, needsAttention: 0, lowBattery: 0 }
    );
  }, [fleetRows]);

  const renderContent = () => {
    if (vestsLoading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      );
    }

    if (vestsError) {
      return (
        <p className="text-destructive text-center">
          Could not load fleet data. You may not have permission to view this list.
        </p>
      );
    }

    if (fleetRows.length === 0) {
      return (
        <p className="text-muted-foreground text-center">No vests found in the fleet.</p>
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vest ID</TableHead>
            <TableHead>Assigned Guard</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Battery</TableHead>
            <TableHead>Last update</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fleetRows.map((row) => {
            const isExpanded = expandedVestId === row.vestId;
            return (
              <Fragment key={row.vestId}>
                <TableRow key={row.vestId}>
                  <TableCell className="font-medium">{row.vestId}</TableCell>
                  <TableCell className="text-xs">{row.guardDisplay}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} label={row.statusLabel} />
                  </TableCell>
                  <TableCell>{row.modeText}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        row.hasLowBattery && 'text-amber-600 font-semibold'
                      )}
                    >
                      {row.batteryText}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.lastUpdateText}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/supervisor?vestId=${row.vestId}`}>
                          <Eye className="h-4 w-4" />
                          View details
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExpandedVestId(isExpanded ? null : row.vestId)
                        }
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                        {isExpanded ? 'Hide' : 'Expand'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow>
                    <TableCell colSpan={7} className="bg-muted/30 p-4">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <DetailSection title="Status summary">
                          <div className="flex items-center gap-2">
                            {row.status === 'ok' && <ShieldCheck className="h-4 w-4 text-emerald-600" />}
                            {row.status === 'attention' && (
                              <AlertTriangle className="h-4 w-4 text-amber-600" />
                            )}
                            {row.status === 'offline' && <WifiOff className="h-4 w-4 text-rose-600" />}
                            <span className="font-semibold">{row.statusLabel}</span>
                          </div>
                          {row.attentionReasons.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                              {row.attentionReasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">
                              No issues detected.
                            </p>
                          )}
                        </DetailSection>

                        <DetailSection title="Vitals summary">
                          <DetailItem
                            label="Skin temp"
                            value={formatValue(row.current.skinTemp, '°C', 1)}
                          />
                          <DetailItem
                            label="Body temp"
                            value={formatValue(row.current.bodyTemp, '°C', 1)}
                          />
                          <DetailItem
                            label="Heart rate"
                            value={formatValue(row.current.heartRateBpm, ' bpm', 0)}
                          />
                          <DetailItem
                            label="SpO2"
                            value={formatValue(row.current.spo2Pct, '%', 0)}
                          />
                        </DetailSection>

                        <DetailSection title="Power & mode">
                          <DetailItem label="Battery" value={row.batteryText} />
                          <DetailItem label="Pump" value={row.pumpText} />
                          <DetailItem label="Mode" value={row.modeText} />
                          <DetailItem label="Last update" value={row.lastUpdateText} />
                        </DetailSection>

                        <DetailSection title="Location">
                          <p className="text-xs text-muted-foreground">{row.gpsStatus}</p>
                          {row.hasGpsFix ? (
                            <div className="mt-2">
                              <VestMap
                                gps={row.current.gps}
                                statusMessage={row.gpsStatus}
                                variant="plain"
                                size="compact"
                              />
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Location unavailable.
                            </p>
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
                              const ok = row.sensorOk?.[sensor.key as keyof VestTelemetry['sensorOk']];
                              const label =
                                ok === true ? 'OK' : ok === false ? 'Failed' : 'Unknown';
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
                          <SupervisorHistorySummary vestId={row.vestId} />
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Fleet Health</h2>
        <p className="text-xs text-muted-foreground">
          Monitor vest readiness and flag issues before they escalate.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Total vests" value={summary.total} />
        <SummaryCard label="Online" value={summary.online} icon={<ShieldCheck className="h-5 w-5" />} />
        <SummaryCard label="Offline" value={summary.offline} icon={<WifiOff className="h-5 w-5" />} />
        <SummaryCard
          label="Needs attention"
          value={summary.needsAttention}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <SummaryCard label="Low battery" value={summary.lowBattery} icon={<BatteryLow className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fleet list</CardTitle>
          <CardDescription>Compact status view with on-demand details.</CardDescription>
        </CardHeader>
        <CardContent>{renderContent()}</CardContent>
      </Card>
    </section>
  );
}
