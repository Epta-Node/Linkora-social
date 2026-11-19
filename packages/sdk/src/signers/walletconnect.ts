/**
 * WalletConnect 2.0 Mobile Deep Link Adapter
 *
 * Facilitates mobile wallet signing with deep links for Lobstr and standard WalletConnect 2.0
 * applications on iOS and Android, with cross-device QR fallbacks.
 */

export interface WalletConnectDeepLinkConfig {
  wcUri: string;
  targetWallet?: 'lobstr' | 'generic';
}

export function isMobileEnvironment(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

export function generateWalletConnectDeepLink(config: WalletConnectDeepLinkConfig): string {
  const encodedUri = encodeURIComponent(config.wcUri);

  if (config.targetWallet === 'lobstr') {
    return `lobstr://wc?uri=${encodedUri}`;
  }

  // Generic WC deep link standard
  return `wc:${encodedUri}`;
}

export function openMobileWallet(deepLink: string): boolean {
  if (typeof window !== 'undefined' && isMobileEnvironment()) {
    window.location.href = deepLink;
    return true;
  }
  return false;
}

export function getQrCodePayload(wcUri: string): { uri: string; qrData: string } {
  return {
    uri: wcUri,
    qrData: `stellar:walletconnect?uri=${encodeURIComponent(wcUri)}`,
  };
}
