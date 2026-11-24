/**
 * Mobile Biometric Authenticator & Key Signing Helper
 *
 * Provides biometric authentication (Face ID / Touch ID) protection for session signing keys,
 * enforcing a 15-minute inactivity session expiration and fallback to passphrase.
 * Stores keys in expo-secure-store and uses expo-local-authentication for biometric checks.
 */

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
  fallbackToWalletConnect?: boolean;
}

export interface BiometricConfig {
  /** Session TTL in milliseconds (default: 15 minutes) */
  sessionTtlMs?: number;
  /** Maximum biometric authentication failures before fallback to passphrase */
  maxFailures?: number;
  /** Whether to require biometrics for transaction signing */
  requireForTransactions?: boolean;
}

const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 3;

class BiometricSessionManager {
  private lastActiveTimestamp: number = 0;
  private sessionTtlMs: number;
  private hasActiveSession: boolean = false;
  private failureCount: number = 0;
  private config: BiometricConfig;

  constructor(config?: BiometricConfig) {
    this.sessionTtlMs = config?.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
    this.maxFailures = config?.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.requireForTransactions = config?.requireForTransactions ?? false;
  }

  isSessionValid(): boolean {
    if (!this.hasActiveSession) return false;
    const now = Date.now();
    if (now - this.lastActiveTimestamp > this.sessionTtlMs) {
      this.invalidateSession();
      return false;
    }
    return true;
  }

  touchSession(): void {
    this.lastActiveTimestamp = Date.now();
    this.failureCount = 0; // Reset failures on successful touch
  }

  invalidateSession(): void {
    this.hasActiveSession = false;
    this.lastActiveTimestamp = 0;
  }

  async authenticateWithBiometrics(
    promptMessage = "Authorize transaction with Face ID / Touch ID"
  ): Promise<{ success: boolean; error?: string; fallbackToWalletConnect?: boolean }> {
    try {
      // Check if biometrics are available
      const biometricType = await LocalAuthentication.isAvailableAsync();
      if (!biometricType) {
        return {
          success: false,
          error: "Biometric hardware not available",
          fallbackToWalletConnect: true,
        };
      }

      // Attempt biometric authentication
      const result = await LocalAuthentication.authenticateAsync({
        promptTitle: "Biometric Authentication",
        promptSubtitle: promptMessage,
        biometricType: biometricType === "FACE_ID" ? "Face ID" : "Touch ID",
        cancelButtonTitle: "Use Passphrase",
      });

      if (result.success) {
        // Authentication succeeded - establish session and reset failures
        this.hasActiveSession = true;
        this.touchSession();
        this.failureCount = 0;
        return { success: true };
      } else {
        // Authentication failed - increment failure count
        this.failureCount++;
        if (this.failureCount >= this.maxFailures) {
          // Too many failures - force fallback to passphrase
          this.invalidateSession();
          return {
            success: false,
            error: "Too many failed biometric attempts. Falling back to passphrase.",
            fallbackToWalletConnect: true,
          };
        }
        return {
          success: false,
          error: "Biometric authentication failed",
          fallbackToWalletConnect: true,
        };
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Biometric authentication failed";
      return { success: false, error: errorMessage, fallbackToWalletConnect: true };
    }
  }

  async signWithBiometric(
    signFn: () => Promise<string>,
    promptMessage = "Authorize transaction with Face ID / Touch ID"
  ): Promise<{ success: boolean; error?: string; txHash?: string; fallbackToWalletConnect?: boolean }> {
    // Check if biometrics are required for transactions
    if (!this.requireForTransactions) {
      // If not required, just call the sign function directly
      try {
        const txHash = await signFn();
        return { success: true, txHash };
      }
    }

    // Attempt biometric authentication first
    const bioResult = await this.authenticateWithBiometrics(promptMessage);
    if (!bioResult.success) {
      return bioResult;
    }

    // Biometrics succeeded - perform the sign operation
    try {
      const txHash = await signFn();
      // On success, establish session and reset failures
      this.hasActiveSession = true;
      this.touchSession();
      this.failureCount = 0;
      return { success: true, txHash };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Transaction signing failed";
      // On failure, increment failure count and invalidate session
      this.failureCount++;
      if (this.failureCount >= this.maxFailures) {
        this.invalidateSession();
      }
      return { success: false, error: errorMessage, fallbackToWalletConnect: true };
    }
  }

  private get maxFailures(): number {
    return this.config?.maxFailures ?? DEFAULT_MAX_FAILURES;
  }

  private get requireForTransactions(): boolean {
    return this.config?.requireForTransactions ?? false;
  }
}

export const biometricSessionManager = new BiometricSessionManager();

// Secure storage wrapper for wallet keys
export async function storeWalletKey(address: string, key: string): Promise<void> {
  await SecureStore.setItemAsync(`linkora:wallet-key:${address}`, key);
}

export async function retrieveWalletKey(address: string): Promise<string | null> {
  const key = await SecureStore.getItemAsync(`linkora:wallet-key:${address}`);
  return key ?? null;
}

export async function deleteWalletKey(address: string): Promise<void> {
  await SecureStore.deleteItemAsync(`linkora:wallet-key:${address}`);
}