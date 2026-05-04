'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sanitizeChartValue } from '@/lib/telemetry-normalization';
import { useVestHistory } from '@/hooks/use-vest-history';

const temperatureConfig = {
  skinTemp: { label: 'Skin Temp', color: 'hsl(var(--chart-1))' },
  bodyTemp: { label: 'Body Temp', color: 'hsl(var(--chart-2))' },
} satisfies ChartConfig;

const envConfig = {
  ambientTemp: { label: 'Ambient Temp', color: 'hsl(var(--chart-3))' },
  skinTemp: { label: 'Skin Temp', color: 'hsl(var(--chart-1))' },
  bodyTemp: { label: 'Body Temp', color: 'hsl(var(--chart-2))' },
  pumpPct: { label: 'Pump %', color: 'hsl(var(--chart-5))' },
} satisfies ChartConfig;

const ChartPlaceholder = ({ message }: { message: string }) => (
  <div className="flex h-40 w-full items-center justify-center text-xs text-muted-foreground">
    {message}
  </div>
);

type TrendPoint = {
  time: string;
  skinTemp: number | null;
  bodyTemp: number | null;
  ambientTemp: number | null;
  pumpPct: number | null;
};

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getSeriesValues = <K extends keyof TrendPoint>(data: TrendPoint[], key: K) =>
  data.map((item) => item[key]).filter(isNumber);

const getDomain = (values: number[]) => {
  if (!values.length) {
    return null;
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(0.4, maxValue - minValue);
  const padding = Math.max(0.6, range * 0.2);
  const min = Math.floor((minValue - padding) * 10) / 10;
  const max = Math.ceil((maxValue + padding) * 10) / 10;

  if (min === max) {
    return [min - 1, max + 1];
  }

  return [min, max];
};

const describeTrend = (delta: number) => {
  if (Math.abs(delta) < 0.2) {
    return 'Stable';
  }

  return delta > 0 ? 'Rising' : 'Decreasing';
};

const formatDelta = (delta: number) => `${delta > 0 ? '+' : ''}${delta.toFixed(1)}°C`;

const buildTempSummary = (label: string, values: number[]) => {
  if (!values.length) {
    return null;
  }

  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const trend = describeTrend(delta);
  const deltaText = Math.abs(delta) < 0.2 ? '' : ` ${formatDelta(delta)}`;

  return `${label} ${last.toFixed(1)}°C (${trend}${deltaText})`;
};

interface GuardTrendsProps {
  vestId: string | null;
}

export function GuardTrends({ vestId }: GuardTrendsProps) {
  const { data: history, loading } = useVestHistory(vestId, 60);

  const chartData = useMemo<TrendPoint[]>(() => {
    if (!history.length) {
      return [];
    }

    return history.map((point) => {
      const skinTemp = sanitizeChartValue(point.skinTemp, { min: 20, max: 45 });
      const bodyTemp = sanitizeChartValue(point.bodyTemp, { min: 25, max: 45 });
      const ambientTemp = sanitizeChartValue(point.ambientTemp, { min: -20, max: 85 });
      const pumpPct = sanitizeChartValue(point.pumpPct, { min: 0, max: 100, allowZero: true });
      return {
        time: format(new Date(point.ts), 'HH:mm'),
        skinTemp,
        bodyTemp,
        ambientTemp,
        pumpPct,
      };
    });
  }, [history]);

  const skinValues = getSeriesValues(chartData, 'skinTemp');
  const bodyValues = getSeriesValues(chartData, 'bodyTemp');
  const ambientValues = getSeriesValues(chartData, 'ambientTemp');
  const pumpValues = getSeriesValues(chartData, 'pumpPct');
  const tempDomain = getDomain([...skinValues, ...bodyValues]) ?? [20, 40];
  const envTempKey: 'skinTemp' | 'bodyTemp' | null = skinValues.length
    ? 'skinTemp'
    : bodyValues.length
      ? 'bodyTemp'
      : null;
  const envTempValues = envTempKey ? getSeriesValues(chartData, envTempKey) : [];
  const envDomain = getDomain([...ambientValues, ...envTempValues]) ?? [0, 40];
  const showAmbient = ambientValues.length > 0;
  const showEnvTemp = envTempValues.length > 0;
  const showPump = pumpValues.length > 0;
  const envTempStroke = envTempKey === 'bodyTemp' ? 'var(--color-bodyTemp)' : 'var(--color-skinTemp)';
  const envTempLabel = envTempKey === 'bodyTemp' ? 'Body' : 'Skin';

  const skinSummary = buildTempSummary('Skin', skinValues);
  const bodySummary = buildTempSummary('Body', bodyValues);
  const tempSummary = [skinSummary, bodySummary].filter(Boolean).join(' · ');

  const ambientLatest = ambientValues.length ? ambientValues[ambientValues.length - 1] : null;
  const envTempLatest = envTempValues.length ? envTempValues[envTempValues.length - 1] : null;
  const pumpLatest = pumpValues.length ? pumpValues[pumpValues.length - 1] : null;
  const pumpActiveCount = pumpValues.filter((value) => value > 0).length;
  const pumpWindow = pumpValues.length;
  const envSummaryParts: string[] = [];
  if (ambientLatest !== null) {
    envSummaryParts.push(`Ambient ${ambientLatest.toFixed(1)}°C`);
  }
  if (envTempLatest !== null) {
    envSummaryParts.push(`${envTempLabel} ${envTempLatest.toFixed(1)}°C`);
  }
  if (pumpLatest !== null) {
    envSummaryParts.push(`Pump ${pumpLatest.toFixed(0)}%`);
  }
  if (pumpWindow > 0) {
    envSummaryParts.push(`Active ${pumpActiveCount}/${pumpWindow}`);
  }
  const envSummary = envSummaryParts.join(' · ');

  const hasHistory = chartData.length > 1;
  const emptyMessage = loading
    ? 'Loading trends...'
    : vestId
      ? 'No recent history available.'
      : 'Pair a vest to see recent history.';

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Recent trends</h2>
        <p className="text-xs text-muted-foreground">
          Visual context for wearer comfort and cooling response.
        </p>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Wearer temperature trend</CardTitle>
            <CardDescription className="text-xs">Skin and body temperature.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {hasHistory ? (
              <ChartContainer config={temperatureConfig} className="h-40 w-full">
                <LineChart data={chartData} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={tempDomain} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line
                    type="monotone"
                    dataKey="skinTemp"
                    stroke="var(--color-skinTemp)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bodyTemp"
                    stroke="var(--color-bodyTemp)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <ChartPlaceholder message={emptyMessage} />
            )}
            {tempSummary && (
              <p className="mt-2 text-[11px] text-muted-foreground">{tempSummary}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Environment vs cooling response</CardTitle>
            <CardDescription className="text-xs">
              Ambient temperature, skin temp, and pump output.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {hasHistory ? (
              <ChartContainer config={envConfig} className="h-40 w-full">
                <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={envDomain} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="pump"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  {showAmbient && (
                    <Area
                      type="monotone"
                      dataKey="ambientTemp"
                      stroke="var(--color-ambientTemp)"
                      fill="var(--color-ambientTemp)"
                      fillOpacity={0.12}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  )}
                  {showEnvTemp && envTempKey && (
                    <Line
                      type="monotone"
                      dataKey={envTempKey}
                      stroke={envTempStroke}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  )}
                  {showPump && (
                    <Bar
                      yAxisId="pump"
                      dataKey="pumpPct"
                      fill="var(--color-pumpPct)"
                      barSize={10}
                      opacity={0.6}
                    />
                  )}
                </ComposedChart>
              </ChartContainer>
            ) : (
              <ChartPlaceholder message={emptyMessage} />
            )}
            {envSummary && (
              <p className="mt-2 text-[11px] text-muted-foreground">{envSummary}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
