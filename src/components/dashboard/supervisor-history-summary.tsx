'use client';

import { useEffect, useMemo, useState } from 'react';
import { useVestHistory } from '@/hooks/use-vest-history';
import type { VestHistoryPoint } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

const MIN_HEART_RATE_BPM = 30;
const MAX_HEART_RATE_BPM = 220;
const MIN_SPO2_PCT = 70;
const MAX_SPO2_PCT = 100;

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

const formatValue = (value: number | null, unit = '', decimals = 0) => {
  if (!isValidNumber(value)) return '—';
  const formatted = decimals > 0 ? value.toFixed(decimals) : value.toFixed(0);
  return unit ? `${formatted}${unit}` : formatted;
};

const formatAge = (ts: number | null, now: number) => {
  if (!ts) return '—';
  const diffMs = now - ts;
  if (diffMs < 0) return '—';
  if (diffMs < 1000) return 'Just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

const findLastValid = <T,>(
  history: VestHistoryPoint[],
  getter: (point: VestHistoryPoint) => T | undefined,
  validator: (value: T | undefined) => value is T
): T | null => {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const value = getter(history[i]);
    if (validator(value)) {
      return value;
    }
  }
  return null;
};

const buildBatteryTrend = (history: VestHistoryPoint[]) => {
  const validPoints = history
    .map((point) => point.batteryPct)
    .filter((value): value is number => isValidBattery(value));

  if (!validPoints.length) {
    return { current: null, trendText: '—' };
  }

  const first = validPoints[0];
  const last = validPoints[validPoints.length - 1];
  const delta = last - first;

  if (Math.abs(delta) < 1) {
    return { current: last, trendText: 'Stable' };
  }

  const direction = delta > 0 ? 'Up' : 'Down';
  return { current: last, trendText: `${direction} ${Math.abs(delta).toFixed(0)}%` };
};

export function SupervisorHistorySummary({ vestId }: { vestId: string | null }) {
  const { data: history, loading } = useVestHistory(vestId, 30);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const summary = useMemo(() => {
    if (!history.length) {
      return null;
    }

    const lastSkin = findLastValid(history, (point) => point.skinTemp, (value): value is number =>
      isValidTemp(value, 20, 45)
    );
    const lastBody = findLastValid(history, (point) => point.bodyTemp, (value): value is number =>
      isValidTemp(value, 25, 45)
    );
    const lastHeart = findLastValid(history, (point) => point.heartRateBpm, isValidHeartRate);
    const lastSpo2 = findLastValid(history, (point) => point.spo2Pct, isValidSpo2);

    const batteryTrend = buildBatteryTrend(history);

    const latestTs = history[history.length - 1]?.ts ?? null;

    const metricsPerPoint = 4;
    let invalidCount = 0;

    history.forEach((point) => {
      if (!isValidTemp(point.skinTemp, 20, 45)) invalidCount += 1;
      if (!isValidTemp(point.bodyTemp, 25, 45)) invalidCount += 1;
      if (!isValidHeartRate(point.heartRateBpm)) invalidCount += 1;
      if (!isValidSpo2(point.spo2Pct)) invalidCount += 1;
    });

    const totalReadings = history.length * metricsPerPoint;

    return {
      lastSkin,
      lastBody,
      lastHeart,
      lastSpo2,
      batteryTrend,
      latestTs,
      invalidCount,
      totalReadings,
      samples: history.length,
    };
  }, [history]);

  const lastUpdateText = summary ? (now ? formatAge(summary.latestTs, now) : '—') : '—';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Recent telemetry summary</CardTitle>
        <CardDescription className="text-xs">
          Last valid readings and data quality from recent history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading recent history...</p>
        ) : !summary ? (
          <p className="text-xs text-muted-foreground">No recent history available.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Skin temp</span>
                <span className="font-medium">{formatValue(summary.lastSkin, '°C', 1)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Body temp</span>
                <span className="font-medium">{formatValue(summary.lastBody, '°C', 1)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Heart rate</span>
                <span className="font-medium">{formatValue(summary.lastHeart, ' bpm')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">SpO2</span>
                <span className="font-medium">{formatValue(summary.lastSpo2, '%')}</span>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Battery</span>
                <span className="font-medium">
                  {formatValue(summary.batteryTrend.current, '%')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Battery trend</span>
                <span className="font-medium">{summary.batteryTrend.trendText}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last update</span>
                <span className="font-medium">{lastUpdateText}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Invalid readings</span>
                <span className="font-medium">
                  {summary.invalidCount}/{summary.totalReadings}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {summary.samples} samples in window
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
