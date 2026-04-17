import { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius, shadow, spacing, typography } from "@/constants/theme";

type SectionCardProps = PropsWithChildren<{
  title?: string;
  eyebrow?: string;
}>;

export function SectionCard({ title, eyebrow, children }: SectionCardProps) {
  return (
    <View style={styles.card}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadow.card,
  },
  eyebrow: {
    ...typography.semibold,
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  title: {
    ...typography.title,
    fontSize: 20,
  },
});
