/**
 * useHapticSettings.ts
 *
 * Persists the user's haptic-feedback preference via AsyncStorage.
 * Components should read `hapticsEnabled` before triggering any haptic call.
 *
 * Usage:
 *   const { hapticsEnabled, setHapticsEnabled } = useHapticSettings();
 */
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@linkora/hapticsEnabled";
/** Default: haptics on. */
const DEFAULT_ENABLED = true;

export function useHapticSettings(): {
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => Promise<void>;
  isLoaded: boolean;
} {
  const [hapticsEnabled, setLocalEnabled] = useState<boolean>(DEFAULT_ENABLED);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        if (val !== null) {
          setLocalEnabled(val === "true");
        }
      })
      .catch(() => undefined)
      .finally(() => setIsLoaded(true));
  }, []);

  const setHapticsEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    setLocalEnabled(enabled);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Non-critical — the in-memory value is still updated.
    }
  }, []);

  return { hapticsEnabled, setHapticsEnabled, isLoaded };
}
