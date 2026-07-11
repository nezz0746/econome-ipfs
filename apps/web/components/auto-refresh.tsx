"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Periodically re-runs the server component tree (router.refresh) so live data
 * — e.g. migration/pin progress — stays fresh without a full reload.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
