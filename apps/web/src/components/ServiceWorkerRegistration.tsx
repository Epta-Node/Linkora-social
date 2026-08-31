"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Disable service worker in E2E test runs to prevent network/mocking interference
    if (
      navigator.webdriver ||
      navigator.userAgent.includes("Playwright") ||
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL !== undefined ||
      process.env.NODE_ENV === "test"
    ) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
