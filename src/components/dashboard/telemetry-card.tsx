'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '../ui/progress';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

interface TelemetryCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  isPercentage?: boolean;
  percentageValue?: number;
  statusTs?: number; // Unix timestamp
  unit?: string; // Optional unit display (e.g., "bpm", "%")
}

function StatusIndicator({ lastSeenTs }: { lastSeenTs: number }) {
  const [isOnline, setIsOnline] = useState(true);
  const [lastSeen, setLastSeen] = useState('');
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    const updateStatus = () => {
      const now = Date.now();
      const diffSeconds = (now - lastSeenTs) / 1000;
      setIsOnline(diffSeconds < 60);

      if (diffSeconds < 60) {
        setLastSeen(`${Math.round(diffSeconds)}s ago`);
      } else if (diffSeconds < 3600) {
        setLastSeen(`${Math.round(diffSeconds / 60)}m ago`);
      } else {
        setLastSeen(`${Math.round(diffSeconds / 3600)}h ago`);
      }
    };
    
    updateStatus();
    const interval = setInterval(updateStatus, 5000); // Update every 5 seconds
    return () => clearInterval(interval);

  }, [lastSeenTs]);
  
  if (!hasMounted) {
    return <div className="h-3 w-3 rounded-full bg-muted" />;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
            <div className={cn("h-3 w-3 rounded-full", isOnline ? 'bg-green-500' : 'bg-red-500')} />
        </TooltipTrigger>
        <TooltipContent>
          <p>Last seen: {lastSeen}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}


export default function TelemetryCard({
  title,
  value,
  icon,
  isPercentage = false,
  percentageValue = 0,
  statusTs,
  unit
}: TelemetryCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {statusTs && <StatusIndicator lastSeenTs={statusTs} />}
          <div className="text-2xl font-bold">
            {value}
            {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
          </div>
        </div>
        {isPercentage && (
          <Progress value={percentageValue} aria-label={`${percentageValue}%`} className="mt-2 h-2" />
        )}
      </CardContent>
    </Card>
  );
}
