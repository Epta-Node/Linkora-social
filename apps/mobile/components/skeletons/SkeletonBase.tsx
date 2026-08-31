import React, { useEffect } from "react";
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

  useEffect(() => {
    translateX.value = withRepeat(
      withTiming(1, {
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false
    );

    return () => {
      cancelAnimation(translateX);
    };
  }, [translateX]);

  const shimmerStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          translateX: interpolate(translateX.value, [-1, 1], [-120, 320]),
        },
      ],
      backgroundColor: theme.colors.surface.surface2,
    }),
    [theme.colors.surface.surface2]
  );

  return <Animated.View pointerEvents="none" style={[styles.shimmer, shimmerStyle]} />;
}

export function SkeletonBase({ children, style, testID }: SkeletonBaseProps) {
  const { theme } = useTheme();

  return (
    <View
      testID={testID}
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
