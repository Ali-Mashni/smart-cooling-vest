'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig } from '../ui/chart';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import type { VestHistoryPoint } from '@/lib/types';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { getDatabase, ref, query, onValue, orderByChild, limitToLast } from 'firebase/database';
import { db } from '@/lib/firebase';

interface VestHistoryChartProps {
  vestId: string | null;
}

type ChartDataPoint = {
  time: string;
  skinTemp: number;
  batteryPct: number;
};

const chartConfig = {
    skinTemp: {
      label: 'Skin Temp (°C)',
      color: 'hsl(var(--chart-1))',
    },
    batteryPct: {
      label: 'Battery (%)',
      color: 'hsl(var(--chart-2))',
    },
  } satisfies ChartConfig;

export default function VestHistoryChart({ vestId }: VestHistoryChartProps) {
  const [history, setHistory] = useState<ChartDataPoint[]>([]);

  useEffect(() => {
    if (!vestId) {
        setHistory([]);
        return;
    }

    console.log("Viewing history for vestId:", vestId);

    const historyRef = ref(db, `vests/${vestId}/history`);
    const historyQuery = query(historyRef, orderByChild('ts'), limitToLast(30));

    const unsubscribe = onValue(historyQuery, (snapshot) => {
        const data = snapshot.val();
        console.log("Raw history snapshot.val():", data);

        if (data) {
            const processedHistory = Object.values(data as Record<string, VestHistoryPoint>)
                .sort((a, b) => a.ts - b.ts)
                .map((point) => ({
                    time: format(new Date(point.ts), 'HH:mm:ss'),
                    skinTemp: point.skinTemp,
                    batteryPct: point.batteryPct,
                }));
            
            console.log("Computed history array length:", processedHistory.length);
            if (processedHistory.length > 0) {
                console.log("First history item:", processedHistory[0]);
            }

            setHistory(processedHistory);
        } else {
            setHistory([]);
        }
    });

    return () => unsubscribe();
  }, [vestId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent History</CardTitle>
        <CardDescription>Telemetry over the last few moments.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length > 1 ? (
        <ChartContainer config={chartConfig} className='min-h-[250px] w-full'>
            <LineChart data={history} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" domain={['dataMin - 2', 'dataMax + 2']} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickLine={false} axisLine={false} />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent indicator="line" />}
              />
              <Line yAxisId="left" type="monotone" dataKey="skinTemp" stroke="var(--color-skinTemp)" strokeWidth={2} dot={false} name="Skin Temp" />
              <Line yAxisId="right" type="monotone" dataKey="batteryPct" stroke="var(--color-batteryPct)" strokeWidth={2} dot={false} name="Battery" />
            </LineChart>
        </ChartContainer>
         ) : (
            <div className="flex min-h-[250px] w-full items-center justify-center text-muted-foreground">
              <p>No historical data available for this vest.</p>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
