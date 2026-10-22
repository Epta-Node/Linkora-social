import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";

/**
 * Third-party script loading strategy.
 *
 * Loading order:
 *  - `beforeInteractive` — wallet SDK (must exist before first interaction)
 *  - GA4 via @next/third-parties `<GoogleAnalytics>` — `afterInteractive`
 *    (automatically deferred; respects Consent Mode v2 default-deny set by
 *    the inline script in layout.tsx)
 *  - Vercel Web Analytics — privacy-friendly fallback, no cookies
 *  - `lazyOnload` — IPFS / vitals beacons (idle-time only)
 *
 * Every script is opt-in via an env var so self-hosted deployments never
 * phone home to a vendor they didn't configure.
 *
 * Environment variables
 * ─────────────────────
 * NEXT_PUBLIC_GA_MEASUREMENT_ID  — GA4 Measurement ID (e.g. G-XXXXXXXXXX)
 * NEXT_PUBLIC_WALLET_SDK_URL     — Freighter/wallet SDK CDN URL
 * NEXT_PUBLIC_ANALYTICS_SCRIPT_URL — legacy custom analytics URL (optional)
 * NEXT_PUBLIC_IPFS_SCRIPT_URL    — IPFS pinning beacon (optional)
 */

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const WALLET_SDK_URL = process.env.NEXT_PUBLIC_WALLET_SDK_URL;
const ANALYTICS_SCRIPT_URL = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL;
const IPFS_SCRIPT_URL = process.env.NEXT_PUBLIC_IPFS_SCRIPT_URL;

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  "https://soroban-testnet.stellar.org";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3001";

function toOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const RPC_ORIGIN = toOrigin(RPC_URL);
const INDEXER_ORIGIN = toOrigin(INDEXER_URL);

/**
 * `preconnect` / `dns-prefetch` hints for origins the app is guaranteed to
 * talk to. Hints are cheap and shave a full round-trip off the first RPC call.
 */
export function ResourceHints() {
  return (
    <>
      {RPC_ORIGIN && <link rel="preconnect" href={RPC_ORIGIN} crossOrigin="anonymous" />}
      {INDEXER_ORIGIN && <link rel="preconnect" href={INDEXER_ORIGIN} />}
      {RPC_ORIGIN && <link rel="dns-prefetch" href={RPC_ORIGIN} />}
      {INDEXER_ORIGIN && <link rel="dns-prefetch" href={INDEXER_ORIGIN} />}
      {/* Preconnect to Google's analytics endpoints so the first hit is fast */}
      {GA_MEASUREMENT_ID && (
        <>
          <link rel="preconnect" href="https://www.googletagmanager.com" />
          <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
        </>
      )}
    </>
  );
}

/** Opt-in third-party scripts. */
export function ThirdPartyScripts() {
  return (
    <>
      {/* Wallet SDK — must be available before any interaction */}
      {WALLET_SDK_URL && <Script src={WALLET_SDK_URL} strategy="beforeInteractive" />}

      {/*
        GA4 via @next/third-parties.
        GoogleAnalytics automatically uses strategy="afterInteractive" and
        respects the Consent Mode v2 default-deny set by the inline script in
        layout.tsx. It will not fire hits until the user grants consent.
      */}
      {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}

      {/*
        Vercel Web Analytics — privacy-friendly, no cookies, no consent needed.
        Falls back gracefully when GA4 is blocked or consent is denied.
      */}
      <VercelAnalytics />

      {/* Legacy custom analytics endpoint (optional) */}
      {ANALYTICS_SCRIPT_URL && <Script src={ANALYTICS_SCRIPT_URL} strategy="afterInteractive" />}

      {/* IPFS pinning / vitals beacon — idle time only */}
      {IPFS_SCRIPT_URL && <Script src={IPFS_SCRIPT_URL} strategy="lazyOnload" />}
    </>
  );
}
