import React, { useMemo } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { useTheme } from "../theme/useTheme";

interface SearchBarProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search profiles and pools",
}: SearchBarProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.container}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={styles.input}
        accessibilityLabel="Search profiles and pools"
      />
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      marginHorizontal: 16,
      marginTop: 16,
      marginBottom: 8,
    },
    input: {
      minHeight: 48,
      borderRadius: 10,
      paddingHorizontal: 14,
      backgroundColor: theme.colors.surface.surface1,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      color: theme.colors.text.primary,
      fontSize: 15,
    },
  });
}
