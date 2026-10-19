import React, { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { StyleSheet, View } from "react-native";
import type { DimensionValue, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "../../theme/useTheme";

interface SkeletonBaseProps {
  children: React.ReactNode;
  style?: ViewStyle;
  testID?: string;
}

function ShimmerOverlay() {
  const { theme } = useTheme();
  const translateX = useSharedValue(-1);
  const opacity = useSharedValue(0.12);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!reduceMotion) {
      translateX.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, false);
      opacity.value = withRepeat(withTiming(0.28, { duration: 700 }), -1, true);
    } else {
      cancelAnimation(translateX);
      cancelAnimation(opacity);
      translateX.value = 0;
      opacity.value = 0.18;
    }

    return () => {
      cancelAnimation(translateX);
    };
  }, [opacity, reduceMotion, translateX]);

  const shimmerStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          translateX: interpolate(translateX.value, [-1, 1], [-120, 320]),
        },
      ],
      backgroundColor: theme.colors.surface.surface2,
      opacity: opacity.value,
    }),
    [theme.colors.surface.surface2]
  );

  return <Animated.View pointerEvents="none" accessibilityElementsHidden style={[styles.shimmer, shimmerStyle]} />;
}

export function SkeletonBase({ children, style, testID }: SkeletonBaseProps) {
  const { theme } = useTheme();

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface.surface1,
          borderColor: theme.colors.surface.border,
        },
        style,
      ]}
    >
      {children}
      <ShimmerOverlay />
    </View>
  );
}

export function SkeletonLine({
  width,
  height = 12,
  style,
}: {
  width: DimensionValue;
  height?: number;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.line,
        {
          width,
          height,
          backgroundColor: theme.colors.surface.surface2,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCircle({ size, style }: { size: number; style?: ViewStyle }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.surface.surface2,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    position: "relative",
  },
  shimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 120,
    opacity: 0.18,
    backgroundColor: "transparent",
  },
  line: {
    borderRadius: 9999,
  },
  circle: {},
});
