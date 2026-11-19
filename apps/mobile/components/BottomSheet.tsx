import React, { useCallback, useMemo, useRef } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import GorhomBottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { useTheme } from "../theme/useTheme";

/**
 * Snap points shared by every sheet in the app (#1790):
 * index 0 = peek (30%), 1 = default (60%), 2 = full screen (100%).
 */
export const SHEET_SNAP_POINTS = ["30%", "60%", "100%"] as const;
export const SHEET_DEFAULT_INDEX = 1;

export interface BottomSheetProps {
  /** Whether the sheet is mounted and open. */
  visible: boolean;
  /** Called once the sheet has been dismissed (swipe down, backdrop tap, hardware back). */
  onClose: () => void;
  /** Accessible name announced when the sheet opens. */
  accessibilityLabel: string;
  /** Optional visible title rendered above the content. */
  title?: string;
  /** Snap point index the sheet opens at. Defaults to 60%. */
  initialSnapIndex?: 0 | 1 | 2;
  /** Disable gesture/backdrop/back dismissal while a transaction is in flight. */
  dismissible?: boolean;
  testID?: string;
  children: React.ReactNode;
}

/**
 * Gesture-driven bottom sheet built on `@gorhom/bottom-sheet`.
 *
 * - Snap points at 30% / 60% / 100%, spring physics from the library.
 * - Swipe down to dismiss, swipe up to expand.
 * - Dimmed backdrop; tapping it dismisses the sheet.
 * - Keyboard-aware: the sheet lifts inputs above the keyboard. Use
 *   `SheetTextInput` for text fields inside the sheet.
 * - Rendered inside a transparent `Modal`, so screen-reader focus stays inside
 *   the open sheet and the Android hardware back button closes it.
 */
export function BottomSheet({
  visible,
  onClose,
  accessibilityLabel,
  title,
  initialSnapIndex = SHEET_DEFAULT_INDEX,
  dismissible = true,
  testID,
  children,
}: BottomSheetProps) {
  const { theme } = useTheme();
  const sheetRef = useRef<GorhomBottomSheet>(null);
  const snapPoints = useMemo(() => [...SHEET_SNAP_POINTS], []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.6}
        pressBehavior={dismissible ? "close" : "none"}
      />
    ),
    [dismissible]
  );

  // Hardware back (Android) / Escape: close the sheet unless a pending
  // action has locked it open.
  const handleRequestClose = useCallback(() => {
    if (!dismissible) return;
    onClose();
  }, [dismissible, onClose]);

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleRequestClose}
      testID={testID ? `${testID}-modal` : undefined}
    >
      <GestureHandlerRootView style={styles.root}>
        <GorhomBottomSheet
          ref={sheetRef}
          index={initialSnapIndex}
          snapPoints={snapPoints}
          enableDynamicSizing={false}
          enablePanDownToClose={dismissible}
          onClose={onClose}
          backdropComponent={renderBackdrop}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          backgroundStyle={{ backgroundColor: theme.colors.surface.surface1 }}
          handleIndicatorStyle={{ backgroundColor: theme.colors.surface.borderStrong }}
        >
          <BottomSheetScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <View accessibilityViewIsModal accessibilityLabel={accessibilityLabel} testID={testID}>
              {title ? (
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: theme.colors.text.primary }]}
                >
                  {title}
                </Text>
              ) : null}
              {children}
            </View>
          </BottomSheetScrollView>
        </GorhomBottomSheet>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Text input that cooperates with the sheet's keyboard handling. */
export const SheetTextInput = BottomSheetTextInput;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 16,
  },
});
