import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

import { useTheme } from "../theme/useTheme";

interface EmptyStateProps {
  title: string;
  description: string;
  actionText?: string;
  onActionPress?: () => void;
  isLoading?: boolean;
  testID?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionText,
  onActionPress,
  isLoading = false,
  testID = "empty-state",
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]} testID={`${testID}-loading`}>
        <View style={styles.iconPlaceholder} />
        <View style={[styles.loadingBar, styles.titleLoading]} />
        <View style={[styles.loadingBar, styles.descriptionLoading]} />
        {actionText && <View style={[styles.loadingBar, styles.buttonLoading]} />}
      </View>
    );
  }

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>📭</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {actionText && onActionPress && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onActionPress}
          testID={`${testID}-action`}
        >
          <Text style={styles.actionText}>{actionText}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 32,
      paddingVertical: 64,
    },
    loadingContainer: {
      backgroundColor: theme.colors.surface.surface1,
    },
    iconContainer: {
      marginBottom: 24,
    },
    icon: {
      fontSize: 64,
      textAlign: "center",
    },
    iconPlaceholder: {
      width: 64,
      height: 64,
      backgroundColor: theme.colors.surface.surface2,
      borderRadius: 32,
      marginBottom: 24,
    },
    title: {
      fontSize: 24,
      fontWeight: "bold",
      color: theme.colors.text.primary,
      textAlign: "center",
      marginBottom: 12,
    },
    description: {
      fontSize: 16,
      color: theme.colors.text.secondary,
      textAlign: "center",
      lineHeight: 24,
      marginBottom: 32,
    },
    actionButton: {
      backgroundColor: theme.colors.brand.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
      minWidth: 120,
    },
    actionText: {
      color: theme.colors.text.onBrand,
      fontSize: 16,
      fontWeight: "600",
      textAlign: "center",
    },
    loadingBar: {
      backgroundColor: theme.colors.surface.surface2,
      borderRadius: 4,
      marginBottom: 12,
    },
    titleLoading: {
      height: 24,
      width: 200,
    },
    descriptionLoading: {
      height: 16,
      width: 280,
    },
    buttonLoading: {
      height: 44,
      width: 120,
      borderRadius: 8,
      marginTop: 20,
    },
  });
}
