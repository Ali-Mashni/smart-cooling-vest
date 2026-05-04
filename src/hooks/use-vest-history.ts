'use client';

import { useEffect, useState } from 'react';
import { onValue, query, ref, orderByChild, limitToLast } from 'firebase/database';
import { useAuth } from '@/components/auth/auth-provider';
import { db } from '@/lib/firebase';
import type { VestHistoryPoint } from '@/lib/types';

export function useVestHistory(vestId: string | null, limit = 60) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<VestHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (authLoading || !user || !vestId) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const historyRef = ref(db, `vests/${vestId}/history`);
    const historyQuery = query(historyRef, orderByChild('ts'), limitToLast(limit));

    const unsubscribe = onValue(
      historyQuery,
      (snapshot) => {
        const raw = snapshot.val();
        if (!raw) {
          setData([]);
          setLoading(false);
          return;
        }

        const points = Object.values(raw as Record<string, VestHistoryPoint>)
          .filter((point) => point && typeof point.ts === 'number')
          .sort((a, b) => a.ts - b.ts);

        setData(points);
        setLoading(false);
      },
      (err: Error) => {
        if (!err.message.includes('permission_denied')) {
          console.error('Error reading vest history:', err);
          setError(err);
        } else {
          setError(null);
        }
        setData([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [authLoading, limit, user, vestId]);

  return { data, loading: authLoading || (!!vestId && loading), error };
}
