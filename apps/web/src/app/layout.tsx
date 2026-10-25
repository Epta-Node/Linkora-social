import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { NavBar } from "@/components/NavBar";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { GuidedTourProvider } from "@/contexts/GuidedTourContext";
import { GuidedTour } from "@/components/onboarding/GuidedTour";
import { ThemeBootstrap } from "@/components/ThemeBootstrap";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { KeyboardShortcutsProvider } from "@/contexts/KeyboardShortcutsContext";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { CommandPalette } from "@/components/CommandPalette";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { ResourceHints, ThirdPartyScripts } from "@/components/ThirdPartyScripts";
import { ConsentBanner } from "@/components/ConsentBanner";
import { QueryProvider } from "@/contexts/QueryProvider";
import { Toaster } from "@/components/ui/Toaster";
import { InstallPromptProvider } from "@/contexts/InstallPromptContext";
import { InstallPromptBanner } from "@/components/InstallPromptBanner";

export const metadata: Metadata = {
  title: "Linkora",
  description: "Decentralised social on Stellar",
  icons: {
    icon: [
      { url: "/logo/logo-icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", type: "image/x-icon" },
    ],
    shortcut: "/logo/logo-icon.svg",
    apple: "/logo/logo-icon.svg",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Linkora",
  },
  other: {
    "theme-color": "#7C3AED",
    "background-color": "#0F172A",
  },
};

/**
 * The real application provider tree.
 *
 * Exported (and rendered by `RootLayout`) so tests can assert that a provider
 * the feature depends on is actually mounted in the running app, rather than
 * wrapping a component in the provider by hand and calling that coverage.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <WalletProvider>
          {/* KeyboardShortcutsProvider reads the wallet via useWallet, so it must
            sit inside WalletProvider. NavBar and KeyboardShortcutsModal consume
            its context, so both must sit inside this provider. */}
          <KeyboardShortcutsProvider>
            <OnboardingProvider>
              <GuidedTourProvider>
                <NotificationsProvider>
                  <InstallPromptProvider>
                    <NavBar />
                    <main id="main-content" tabIndex={-1} className="pb-safe md:pb-0">
                      {children}
                    </main>
                    <GuidedTour />
                    <KeyboardShortcutsModal />
                    <CommandPalette />
                    <InstallPromptBanner />
                    {/* Rollback toasts for optimistic mutations (follow, like,
                      delete, pool deposits) are rendered above page content. */}
                    <Toaster />
                  </InstallPromptProvider>
                </NotificationsProvider>
              </GuidedTourProvider>
            </OnboardingProvider>
          </KeyboardShortcutsProvider>
        </WalletProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline script reads localStorage before React mounts to prevent FOUC */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('linkora_theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`,
          }}
        />
        {/*
          Consent Mode v2 bootstrap — MUST run before the GA4 script loads.

          1. Initialises window.dataLayer and the gtag() stub so subsequent
             gtag() calls are queued rather than lost.
          2. Sets all consent signals to "denied" by default (GDPR-compliant).
             GA4 will not fire any measurement hits until the user accepts.
          3. Enables url_passthrough and ads_data_redaction for cookieless
             modelling when consent is denied (recommended by Google).
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('consent', 'default', {
                analytics_storage: 'denied',
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
                wait_for_update: 500
              });
              gtag('set', 'url_passthrough', true);
              gtag('set', 'ads_data_redaction', true);
            `,
          }}
        />
        {/* Connection hints for the RPC / indexer origins */}
        <ResourceHints />
      </head>
      <body suppressHydrationWarning>
        {/* Third-party scripts, each pinned to its lowest usable priority */}
        <ThirdPartyScripts />
        <ServiceWorkerRegistration />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-violet-600 focus:text-white focus:rounded-lg focus:font-semibold focus:outline-none focus:ring-2 focus:ring-violet-400"
        >
          Skip to content
        </a>
        <ThemeBootstrap />
        <AppProviders>{children}</AppProviders>
        {/* Cookie consent banner — shown on first visit, dismissed after choice */}
        <ConsentBanner />
      </body>
    </html>
  );
}
