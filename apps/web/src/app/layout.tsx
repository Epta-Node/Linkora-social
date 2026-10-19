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
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

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
    <ThemeProvider>
      <WalletProvider>
        {/* KeyboardShortcutsProvider reads the wallet via useWallet, so it must
            sit inside WalletProvider. NavBar and KeyboardShortcutsModal consume
            its context, so both must sit inside this provider. */}
        <KeyboardShortcutsProvider>
          <OnboardingProvider>
            <GuidedTourProvider>
              <NotificationsProvider>
                <NavBar />
                <main id="main-content" tabIndex={-1} className="pb-safe md:pb-0">
                  {children}
                </main>
                <GuidedTour />
                <KeyboardShortcutsModal />
              </NotificationsProvider>
            </GuidedTourProvider>
          </OnboardingProvider>
        </KeyboardShortcutsProvider>
      </WalletProvider>
    </ThemeProvider>
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
      </head>
      <body suppressHydrationWarning>
        <ServiceWorkerRegistration />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-violet-600 focus:text-white focus:rounded-lg focus:font-semibold focus:outline-none focus:ring-2 focus:ring-violet-400"
        >
          Skip to content
        </a>
        <ThemeBootstrap />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
