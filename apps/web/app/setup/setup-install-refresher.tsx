"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { repositoryScanBackoffMs } from "../../src/features/repository-scan/repository-scan-model";

/** The signed webhook normally arrives in seconds; then the buttons remain. */
const SETUP_INSTALL_REFRESH_LIMIT_MS = 5 * 60_000;

/**
 * Re-renders the setup page while it waits for the installation webhook. The
 * page redirects to the dashboard once the installation is linked.
 */
export function SetupInstallRefresher(): null {
  const router = useRouter();

  useEffect(() => {
    const startedAt = Date.now();
    let timer: number | undefined;
    const schedule = () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= SETUP_INSTALL_REFRESH_LIMIT_MS) return;
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") router.refresh();
        schedule();
      }, repositoryScanBackoffMs(elapsed));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [router]);

  return null;
}
