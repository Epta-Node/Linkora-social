import React, { useMemo } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PoolCardSkeleton } from "./skeletons/PoolCardSkeleton";
import type { ThemeTokens } from "../theme/tokens";

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface.surface1,
      borderRadius: 12,
      padding: 20,
      marginVertical: 4,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    name: {
      fontSize: 18,
      fontWeight: "bold",
      color: theme.colors.text.primary,
      flex: 1,
    },
    apy: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.semantic.success,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    description: {
      fontSize: 14,
      color: theme.colors.text.secondary,
      lineHeight: 20,
      marginBottom: 16,
    },
    statsContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    stat: {
      flex: 1,
    },
    statLabel: {
      fontSize: 12,
      color: theme.colors.text.disabled,
      marginBottom: 4,
    },
    statValue: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.colors.text.secondary,
    },
  });
}

interface PoolCardProps {
  id: string;
  name: string;
  description: string;
  totalValue: string;
  participants: number;
  apy?: string;
  isLoading?: boolean;
  onPress?: () => void;
}

export const PoolCard: React.FC<PoolCardProps> = ({
  id,
  name,
  description,
  totalValue,
  participants,
  apy,
  isLoading = false,
  onPress,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (isLoading) {
    return <PoolCardSkeleton />;
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      testID={`pool-card-${id}`}
      accessibilityRole="button"
      accessibilityLabel={`Pool ${name} with balance ${totalValue}`}
    >
      <View style={styles.header}>
        <Text style={styles.name}>{name}</Text>
        {apy && <Text style={styles.apy}>{apy} APY</Text>}
      </View>
      <Text style={styles.description}>{description}</Text>
      <View style={styles.statsContainer}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Total Value</Text>
          <Text style={styles.statValue}>{totalValue}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Admins</Text>
          <Text style={styles.statValue}>{participants}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};
