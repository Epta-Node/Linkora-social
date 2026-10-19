import { AccessibilityInfo } from "react-native";
import * as Haptics from "expo-haptics";

let enabled: boolean | null = null;

async function hapticsEnabled(): Promise<boolean> {
  if (enabled !== null) return enabled;
  try {
    const [reduceMotion, boldText] = await Promise.all([
      AccessibilityInfo.isReduceMotionEnabled(),
      AccessibilityInfo.isBoldTextEnabled(),
    ]);
    // Accessibility settings are the only portable signal available to Expo.
    // Reduced motion and bold-text users commonly also disable system feedback.
    enabled = !reduceMotion && !boldText;
  } catch {
    enabled = true;
  }
  return enabled;
}

export async function impact(style: Haptics.ImpactFeedbackStyle | "light" | "medium" | "heavy"): Promise<void> {
  if (await hapticsEnabled()) await Haptics.impactAsync(style).catch(() => undefined);
}

export async function notification(type: Haptics.NotificationFeedbackType | "success" | "error"): Promise<void> {
  if (await hapticsEnabled()) await Haptics.notificationAsync(type).catch(() => undefined);
}

export function resetHapticsPreference(): void {
  enabled = null;
}
