'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Old Flowbysk routes — send everyone back to Express-backed admin. */
export default function BlockedAdminRoute() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin');
  }, [router]);
  return (
    <p className="text-sm text-[var(--ink3)]">This page moved — returning to Flow Browser admin…</p>
  );
}
