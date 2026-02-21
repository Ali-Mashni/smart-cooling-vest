'use client';

import { db } from '@/lib/firebase';
import { onValue, ref } from 'firebase/database';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';

export function useRtdbValue<T>(path: string | null) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // If auth is loading, we aren't logged in, or don't have a path, don't fetch.
    if (authLoading || !user || !path) {
      setData(null);
      setLoading(false); // Not loading if we can't fetch.
      setError(null);
      return;
    }

    // Auth is loaded and we have a user and path, so start loading data.
    setLoading(true);
    setError(null);
    const dbRef = ref(db, path);

    const unsubscribe = onValue(
      dbRef,
      (snapshot) => {
        setData(snapshot.val() as T);
        setLoading(false);
      },
      (err: Error) => {
        // 'permission_denied' is an expected error during logout/auth transitions.
        // We can safely ignore it and simply clear the data without polluting the console.
        if (!err.message.includes('permission_denied')) {
            console.error(`Error reading from path: ${path}`, err);
            setError(err);
        } else {
            setError(null); // Clear any previous non-permission error
        }
        setData(null);
        setLoading(false);
      }
    );

    // Cleanup: onValue returns a function to unsubscribe the listener.
    // This is called when the component unmounts or dependencies change.
    return () => {
      unsubscribe();
    };
  }, [path, user, authLoading]);

  // The hook is loading if auth is still resolving or if we have started fetching data.
  return { data, loading: authLoading || (!!path && loading), error };
}
