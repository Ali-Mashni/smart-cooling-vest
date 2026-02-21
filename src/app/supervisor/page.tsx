'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { SupervisorFleetList } from '@/components/dashboard/supervisor-fleet-list';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Loader } from '@/components/layout/loader';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';
import React from 'react';
import type { VestTelemetry } from '@/lib/types';
import { useRtdbValue } from '@/hooks/use-rtdb-value';
import TelemetryCard from '@/components/dashboard/telemetry-card';
import {
  Battery,
  MapPin,
  Thermometer,
  Wifi,
  ArrowLeft,
} from 'lucide-react';
import { ModeControl } from '@/components/dashboard/mode-control';
import VestMap from '@/components/dashboard/vest-map';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import VestHistoryChart from '@/components/dashboard/vest-history-chart';

function SupervisorVestDetail({ vestId }: { vestId: string }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  const vestTelemetryPath = vestId ? `/vests/${vestId}/current` : null;
  const { data: telemetry, loading: telemetryLoading } =
    useRtdbValue<VestTelemetry>(vestTelemetryPath);

  if (authLoading || !user) {
    return <Loader />;
  }

  const renderTelemetry = () => {
    if (telemetryLoading) {
      return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      );
    }
    if (!telemetry) {
      return (
        <div className="text-center py-10 rounded-lg bg-card border">
          <p className="text-muted-foreground">
            Waiting for data from vest{' '}
            <span className="font-bold text-primary">{vestId}</span>...
          </p>
        </div>
      );
    }
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <TelemetryCard
          title="Mode"
          value={telemetry.mode}
          icon={<Wifi />}
          statusTs={telemetry.lastSeenTs}
        />
        <TelemetryCard
          title="Skin Temp"
          value={`${telemetry.skinTemp.toFixed(1)} °C`}
          icon={<Thermometer />}
        />
        <TelemetryCard
          title="Battery"
          value={`${telemetry.batteryPct}%`}
          icon={<Battery />}
          isPercentage
          percentageValue={telemetry.batteryPct}
        />
        <TelemetryCard
          title="GPS"
          value={`${telemetry.gps.lat.toFixed(4)}, ${telemetry.gps.lng.toFixed(
            4
          )}`}
          icon={<MapPin />}
          statusTs={telemetry.lastSeenTs}
        />
      </div>
    );
  };

  return (
    <>
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/supervisor">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back</span>
          </Link>
        </Button>
        <h1 className="flex-1 shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0">
          Vest Details: {vestId}
        </h1>
      </div>
      <div className="grid gap-4 md:gap-8">
        {renderTelemetry()}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <div className="lg:col-span-3 space-y-4">
            <ModeControl vestId={vestId} currentMode={telemetry?.mode} />
            <VestMap gps={telemetry?.gps} />
          </div>
          <div className="lg:col-span-4">
            <VestHistoryChart vestId={vestId} />
          </div>
        </div>
      </div>
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
