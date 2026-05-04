'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface VestActivityCardProps {
  pumpPct?: number;
  isOffline?: boolean;
}

export function VestActivityCard({ pumpPct, isOffline }: VestActivityCardProps) {
  const isActive = !isOffline && typeof pumpPct === 'number' && pumpPct > 0;
  const statusLabel = isOffline ? 'Offline' : isActive ? 'Flow active' : 'Flow idle';
  const statusClassName = isOffline
    ? 'border-rose-500/40 bg-rose-500/10 text-rose-700'
    : isActive
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
      : 'border-border bg-muted text-muted-foreground';

  const flowSpeed = isActive
    ? Math.max(0.7, 2.4 - ((pumpPct ?? 0) / 100) * 1.4)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Cooling activity</CardTitle>
        <CardDescription className="text-xs">Live pump flow visualization.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className={cn(
              'h-5 px-2.5 py-0 text-[10px] font-semibold uppercase tracking-wide leading-none',
              statusClassName
            )}
          >
            {statusLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {typeof pumpPct === 'number' ? `${pumpPct.toFixed(0)}% pump` : 'N/A'}
          </span>
        </div>
        <div className="mt-3 rounded-md border border-border/60 bg-background/70 p-3">
          <svg viewBox="0 0 160 160" className="h-36 w-full" aria-hidden="true">
            <defs>
              <linearGradient id="vestFlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.15" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
              </linearGradient>
            </defs>
            <path
              d="M40 20 L60 10 H100 L120 20 L132 50 V135 L112 150 H48 L28 135 V50 Z"
              fill="hsl(var(--muted))"
              stroke="hsl(var(--border))"
              strokeWidth="2"
            />
            <path
              d="M60 40 V120"
              stroke="url(#vestFlow)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="8 10"
              strokeOpacity={isActive ? 1 : 0.3}
            >
              {isActive && (
                <animate
                  attributeName="stroke-dashoffset"
                  values="0;36"
                  dur={`${flowSpeed}s`}
                  repeatCount="indefinite"
                />
              )}
            </path>
            <path
              d="M100 40 V120"
              stroke="url(#vestFlow)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="8 10"
              strokeOpacity={isActive ? 1 : 0.3}
            >
              {isActive && (
                <animate
                  attributeName="stroke-dashoffset"
                  values="0;36"
                  dur={`${flowSpeed}s`}
                  repeatCount="indefinite"
                />
              )}
            </path>
            <path
              d="M60 40 H100"
              stroke="url(#vestFlow)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeOpacity={isActive ? 0.9 : 0.25}
            />
            <path
              d="M60 120 H100"
              stroke="url(#vestFlow)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeOpacity={isActive ? 0.9 : 0.25}
            />
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
