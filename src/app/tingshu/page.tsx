'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import TingshuClient from './TingshuClient';

export default function TingshuPage() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const ok = !!(window as unknown as { RUNTIME_CONFIG?: { TINGSHU_ENABLED?: boolean } })
      .RUNTIME_CONFIG?.TINGSHU_ENABLED;
    if (!ok) {
      router.replace('/');
    } else {
      setEnabled(true);
    }
  }, [router]);

  if (!enabled) return null;
  return <TingshuClient />;
}
