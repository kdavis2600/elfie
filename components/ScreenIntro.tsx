import { ReactNode } from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors, spacing, typography } from "@/constants/theme";

type ScreenIntroProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScreenIntro({ eyebrow, title, subtitle, children, style }: ScreenIntroProps) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  eyebrow: {
    ...typography.semibold,
    color: colors.accent,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  title: {
    ...typography.title,
    fontSize: 34,
    lineHeight: 40,
  },
  subtitle: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
});
