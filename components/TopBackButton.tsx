import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from "react-native";

import { colors, radius, spacing, typography } from "@/constants/theme";
import { triggerPressHapticAsync } from "@/lib/haptics";

type TopBackButtonProps = {
  onPress: () => void | Promise<void>;
  label?: string;
  disabled?: boolean;
  haptics?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function TopBackButton({ onPress, label = "Back", disabled = false, haptics = true, style }: TopBackButtonProps) {
  function handlePress() {
    if (disabled) {
      return;
    }

    if (haptics) {
      void triggerPressHapticAsync();
    }

    void onPress();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      android_ripple={{ color: "rgba(20,20,43,0.08)" }}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Text style={styles.arrow}>&lt;</Text>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.55,
  },
  arrow: {
    ...typography.semibold,
    fontSize: 16,
    color: colors.ink,
  },
  label: {
    ...typography.semibold,
    fontSize: 14,
    color: colors.ink,
  },
});
