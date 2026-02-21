'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { get, getDatabase, ref } from 'firebase/database';
import { useAuth } from '@/components/auth/auth-provider';
import { Loader } from '@/components/layout/loader';

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      router.replace('/login');
      return;
    }

    const db = getDatabase();
    const roleRef = ref(db, `roles/${user.uid}`);
    get(roleRef)
      .then((snapshot) => {
        if (snapshot.exists()) {
          const userRole = snapshot.val();
          if (userRole === 'guard') {
            router.replace('/guard');
          } else if (userRole === 'supervisor') {
            router.replace('/supervisor');
          } else {
            console.error('Unknown role:', userRole);
            router.replace('/login');
          }
        } else {
          console.error('No role found for user:', user.uid);
          // For demo purposes, default to supervisor if no role
          router.replace('/supervisor');
        }
      })
      .catch((error) => {
        console.error('Error fetching role:', error);
        router.replace('/login');
      });
  }, [user, authLoading, router]);

  return <Loader />;
}
