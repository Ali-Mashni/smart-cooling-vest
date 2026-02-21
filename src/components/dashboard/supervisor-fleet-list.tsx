'use client';

import { useRtdbValue } from '@/hooks/use-rtdb-value';
import type { Vest, VestWithId, UserProfile } from '@/lib/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import Link from 'next/link';
import { Button } from '../ui/button';
import { Eye } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import { cn } from '@/lib/utils';

function StatusBadge({ lastSeenTs }: { lastSeenTs: number }) {
  const [now, setNow] = useState(() => Date.now());
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    const interval = setInterval(() => setNow(Date.now()), 1000); // update every second
    return () => clearInterval(interval);
  }, []);

  if (!hasMounted) {
    return <Badge variant="outline">Checking...</Badge>;
  }

  const diffSeconds = Math.round((now - lastSeenTs) / 1000);
  const isOnline = diffSeconds < 60;

  let lastSeenText = '';
  if (diffSeconds < 2) {
    lastSeenText = 'just now';
  } else if (diffSeconds < 60) {
    lastSeenText = `${diffSeconds}s ago`;
  } else if (diffSeconds < 3600) {
    lastSeenText = `${Math.round(diffSeconds / 60)}m ago`;
  } else {
    lastSeenText = `${Math.round(diffSeconds / 3600)}h ago`;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Badge
            variant={isOnline ? 'default' : 'destructive'}
            className={cn(isOnline && 'bg-green-600')}
          >
            {isOnline ? 'Online' : 'Offline'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Last seen: {lastSeenText}</p>
          {!isOnline && (
            <p className="text-xs text-muted-foreground">
              Offline (&gt;60s since last update)
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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

  useEffect(() => {
    console.log("activeGuards", activeGuards);
  }, [activeGuards]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000); // update every 5s for sorting
    return () => clearInterval(timer);
  }, []);

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
      vest.current?.lastSeenTs && now - vest.current.lastSeenTs < 60000;

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
  }, [allVests, now]);

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
          Could not load fleet data. You may not have permission to view this
          list.
        </p>
      );
    }

    if (sortedVests.length === 0) {
      return (
        <p className="text-muted-foreground text-center">
          No vests found in the fleet.
        </p>
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vest ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assigned Guard</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead className="text-right">Battery</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedVests.map((vest) => {
            const guardUid = vestToGuardMap[vest.vestId];
            const guardInfo = guardUid && users ? users[guardUid] : null;
            const guardDisplay = guardInfo
              ? guardInfo.displayName || guardInfo.email
              : guardUid
              ? `...${guardUid.slice(-8)}`
              : 'Unassigned';

            return (
              <TableRow key={vest.vestId}>
                <TableCell className="font-medium">{vest.vestId}</TableCell>
                <TableCell>
                  {vest.current?.lastSeenTs ? (
                    <StatusBadge lastSeenTs={vest.current.lastSeenTs} />
                  ) : (
                    <Badge variant="outline">Unknown</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">{guardDisplay}</TableCell>
                <TableCell>{vest.current?.mode || 'N/A'}</TableCell>
                <TableCell className="text-right">
                  {vest.current?.batteryPct != null
                    ? `${vest.current.batteryPct}%`
                    : 'N/A'}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="icon">
                    <Link href={`/supervisor?vestId=${vest.vestId}`}>
                      <Eye className="h-4 w-4" />
                      <span className="sr-only">View Details</span>
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fleet Management</CardTitle>
        <CardDescription>
          An overview of all active vests in the field.
        </CardDescription>
      </CardHeader>
      <CardContent>{renderContent()}</CardContent>
    </Card>
  );
}
